import { beforeEach, describe, expect, test } from 'bun:test'

import { authorizeAction, proposeAction } from '@/app/action-lifecycle'
import {
  ConnectorRegistry,
  executeAuthorizedActionWithConnectors,
  verifyAppliedActionWithConnectors
} from '@/app/connectors'
import type { OpenPencilConnector } from '@/app/connectors'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { collectEvidenceWithConnectors } from '@/app/evidence-intake'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import {
  WEEKLY_DECISION_IDS,
  applyWeeklyDecisionEvent,
  createWeeklyDecisionSurface
} from '@/app/weekly-decision'
import { getKnowledgeWorkspace, workspaceRegistry } from '@/app/workspace'
import type { KnowledgeWorkspace } from '@/app/workspace'

const NOW = '2026-07-14T19:00:00.000Z'

function currentWorkspace(store: EditorStore): KnowledgeWorkspace {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')
  const workspace = getKnowledgeWorkspace(store.graph.rootId, page.id)
  if (!workspace) throw new Error('workspace missing')
  return workspace
}

async function approvedDecision(): Promise<{
  decisionReceiptId: string
  store: EditorStore
  workspace: KnowledgeWorkspace
}> {
  const store = createEditorStore()
  await createWeeklyDecisionSurface(store)
  const workspace = currentWorkspace(store)
  if (!Object.hasOwn(workspace.objects, WEEKLY_DECISION_IDS.surface)) {
    throw new Error('decision surface missing')
  }
  const surface = workspace.objects[WEEKLY_DECISION_IDS.surface]
  if (surface.type !== 'surface-run') throw new Error('decision surface missing')
  const board = store.graph.getNode(surface.artifact.boardId)
  if (!board) throw new Error('decision board missing')
  const result = await applyWeeklyDecisionEvent(store, {
    action: 'approve',
    actorId: 'test-owner',
    eventId: 'connector-boundary-decision-approval',
    expected: {
      artifactRevision: htmlBoardDocument(board).revision,
      surfaceRevision: surface.revision,
      workspaceRevision: workspace.revision
    },
    surfaceRunId: surface.id
  })
  if (!result.receiptId) throw new Error(result.error ?? 'decision receipt missing')
  return {
    decisionReceiptId: result.receiptId,
    store,
    workspace: currentWorkspace(store)
  }
}

function testConnector(calls: {
  execute: number
  read: number
  verify: number
}): OpenPencilConnector {
  return {
    descriptor: {
      actionReadbackScopes: ['linear:issue:read'],
      actionWriteScopes: ['linear:issue:write'],
      capabilities: {
        actionReadback: true,
        actionWrite: true,
        evidenceRead: true,
        networkAccess: true
      },
      evidenceReadScopes: ['linear:issue:read'],
      id: 'linear',
      name: 'Linear test connector'
    },
    async executeAction({ steps }) {
      calls.execute += 1
      return steps.map((step) => ({
        afterHash: 'linear:INTAKE-42@updated',
        beforeHash: 'linear:INTAKE-42@before',
        status: 'applied' as const,
        stepId: step.id,
        targetRef: step.target.ref
      }))
    },
    async readEvidence({ now, request }) {
      calls.read += 1
      return {
        facts: { identifier: 'INTAKE-42', status: 'In Review' },
        freshness: 'current',
        observedAt: now,
        sourceRef: request.resourceRef,
        summary: 'The linked roadmap issue is currently in review.',
        title: 'Linear issue INTAKE-42',
        truthScope: 'live'
      }
    },
    async verifyAction({ observedAt, steps }) {
      calls.verify += 1
      return steps.map((step) => ({
        evidenceRef: 'linear-readback://issue/INTAKE-42@updated',
        id: `check-${step.id}`,
        kind: 'external-readback' as const,
        observedAt,
        passed: true,
        resultDigest: 'sha256:linear-readback-matched',
        targetRef: step.target.ref
      }))
    }
  }
}

beforeEach(() => workspaceRegistry.clear())

describe('Connector boundary', () => {
  test('gates connector evidence by scope and records provider truth without write capability', async () => {
    const calls = { execute: 0, read: 0, verify: 0 }
    const registry = new ConnectorRegistry([testConnector(calls)])
    const store = createEditorStore()
    const base = {
      collectionId: 'connector-evidence',
      connectorRegistry: registry,
      connectorRequests: [
        {
          connectorId: 'linear',
          id: 'linear-issue',
          resourceRef: 'linear://issue/INTAKE-42'
        }
      ],
      now: NOW,
      requests: [],
      store
    }
    const denied = await collectEvidenceWithConnectors({
      ...base,
      grant: { actorId: 'test-owner', issuedAt: NOW, scopes: [] }
    })
    expect(denied.status).toBe('partial')
    expect(denied.items[0]?.access).toBe('redacted')
    expect(calls.read).toBe(0)

    const allowed = await collectEvidenceWithConnectors({
      ...base,
      grant: { actorId: 'test-owner', issuedAt: NOW, scopes: ['linear:issue:read'] }
    })
    expect(calls.read).toBe(1)
    expect(allowed.status).toBe('ready')
    expect(allowed.items[0]).toMatchObject({
      freshness: 'current',
      sourceRef: 'linear://issue/INTAKE-42',
      truthScope: 'live'
    })
    expect(allowed.receipt.providerRuns[0]).toMatchObject({
      capabilities: {
        externalWrites: false,
        networkAccess: true,
        sourceWrites: false
      },
      providerId: 'linear',
      providerKind: 'connector',
      status: 'collected'
    })
  })

  test('invokes connector write and readback only after exact authorization', async () => {
    const calls = { execute: 0, read: 0, verify: 0 }
    const registry = new ConnectorRegistry([testConnector(calls)])
    const approved = await approvedDecision()
    let proposalResult = proposeAction(approved.workspace, {
      actorId: 'planning-agent',
      decisionReceiptId: approved.decisionReceiptId,
      expectedWorkspaceRevision: approved.workspace.revision,
      id: 'action-proposal_connector-boundary',
      idempotencyKey: 'propose-connector-boundary',
      name: 'Update the approved roadmap issue',
      now: NOW,
      requiredScopes: ['linear:issue:read', 'linear:issue:write'],
      steps: [
        {
          description: 'Update roadmap issue from the approved decision',
          id: 'step-linear-update',
          operation: 'update',
          payloadDigest: 'sha256:linear-update-v1',
          target: {
            connectorId: 'linear',
            kind: 'external-system',
            label: 'Roadmap issue INTAKE-42',
            ref: 'linear://issue/INTAKE-42'
          }
        }
      ]
    })
    expect(calls.execute).toBe(0)
    proposalResult = authorizeAction(proposalResult.workspace, {
      actorId: 'test-owner',
      expectedProposalRevision: proposalResult.proposal.revision,
      expectedWorkspaceRevision: proposalResult.workspace.revision,
      grantedScopes: ['linear:issue:read', 'linear:issue:write'],
      idempotencyKey: 'authorize-connector-boundary',
      now: NOW,
      proposalId: proposalResult.proposal.id
    })
    const execution = await executeAuthorizedActionWithConnectors(proposalResult.workspace, {
      appliedAt: NOW,
      executionReceiptId: 'action-execution-receipt_connector-boundary',
      executorId: 'connector-orchestrator',
      expectedProposalRevision: proposalResult.proposal.revision,
      expectedWorkspaceRevision: proposalResult.workspace.revision,
      idempotencyKey: 'execute-connector-boundary',
      proposalId: proposalResult.proposal.id,
      registry
    })
    expect(calls.execute).toBe(1)
    expect(execution.execution.status).toBe('applied')

    const verification = await verifyAppliedActionWithConnectors(execution.workspace, {
      expectedProposalRevision: execution.proposal.revision,
      expectedWorkspaceRevision: execution.workspace.revision,
      idempotencyKey: 'verify-connector-boundary',
      proposalId: execution.proposal.id,
      registry,
      verificationReceiptId: 'action-verification-receipt_connector-boundary',
      verifiedAt: NOW,
      verifiedBy: 'verification-agent'
    })
    expect(calls.verify).toBe(1)
    expect(verification.proposal.status).toBe('verified')
    expect(verification.verification.outcome).toBe('verified')
    expect(verification.verification.checks[0]?.kind).toBe('external-readback')
  })
})
