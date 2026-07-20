import { beforeEach, describe, expect, test } from 'bun:test'

import {
  authorizeAction,
  proposeAction,
  recordActionExecution,
  recordActionRollback,
  recordActionVerification
} from '@/app/action-lifecycle'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import {
  WEEKLY_DECISION_IDS,
  applyWeeklyDecisionEvent,
  createWeeklyDecisionSurface
} from '@/app/weekly-decision'
import {
  WORKSPACE_SCHEMA_VERSION,
  WorkspaceDomainError,
  deserializeWorkspace,
  getKnowledgeWorkspace,
  queryWorkspaceItems,
  serializeWorkspace,
  workspaceRegistry
} from '@/app/workspace'
import type { ActionProposalStep, KnowledgeWorkspace } from '@/app/workspace'

const NOW = '2026-07-14T18:00:00.000Z'

function currentWorkspace(store: EditorStore): KnowledgeWorkspace {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')
  const workspace = getKnowledgeWorkspace(store.graph.rootId, page.id)
  if (!workspace) throw new Error('weekly decision workspace missing')
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
  const approved = await applyWeeklyDecisionEvent(store, {
    action: 'approve',
    actorId: 'test-owner',
    eventId: 'action-lifecycle-decision-approval',
    expected: {
      artifactRevision: htmlBoardDocument(board).revision,
      surfaceRevision: surface.revision,
      workspaceRevision: workspace.revision
    },
    surfaceRunId: surface.id
  })
  if (!approved.receiptId) throw new Error(approved.error ?? 'decision receipt missing')
  return {
    decisionReceiptId: approved.receiptId,
    store,
    workspace: currentWorkspace(store)
  }
}

const SOURCE_STEP: ActionProposalStep = {
  description: 'Update the approved intake flow implementation',
  id: 'step-source-update',
  operation: 'update',
  payloadDigest: 'sha256:source-change-v1',
  target: {
    kind: 'source',
    label: 'Patient intake source',
    ref: 'source://src/features/intake/PatientIntake.tsx',
    revision: 'git:before-source-change'
  }
}

beforeEach(() => workspaceRegistry.clear())

describe('Action lifecycle', () => {
  test('requires every exact authorization scope before execution', async () => {
    const approved = await approvedDecision()
    let result = proposeAction(approved.workspace, {
      actorId: 'planning-agent',
      decisionReceiptId: approved.decisionReceiptId,
      expectedWorkspaceRevision: approved.workspace.revision,
      id: 'action-proposal_authorization-test',
      idempotencyKey: 'propose-authorization-test',
      name: 'Apply intake decision',
      now: NOW,
      requiredScopes: ['source:write'],
      steps: [SOURCE_STEP]
    })

    expect(result.proposal.status).toBe('proposed')
    expect(result.proposal.requestedCapabilities).toMatchObject({
      externalWrites: false,
      sourceWrites: true,
      workspaceWrites: false
    })
    expect(() =>
      recordActionExecution(result.workspace, {
        appliedAt: NOW,
        executorId: 'source-connector',
        expectedProposalRevision: result.proposal.revision,
        expectedWorkspaceRevision: result.workspace.revision,
        idempotencyKey: 'execute-without-authorization',
        proposalId: result.proposal.id,
        results: [
          {
            afterHash: 'git:after-source-change',
            beforeHash: 'git:before-source-change',
            status: 'applied',
            stepId: SOURCE_STEP.id,
            targetRef: SOURCE_STEP.target.ref
          }
        ]
      })
    ).toThrow(WorkspaceDomainError)
    expect(() =>
      authorizeAction(result.workspace, {
        actorId: 'test-owner',
        expectedProposalRevision: result.proposal.revision,
        expectedWorkspaceRevision: result.workspace.revision,
        grantedScopes: ['workspace:write'],
        idempotencyKey: 'authorize-wrong-scope',
        now: NOW,
        proposalId: result.proposal.id
      })
    ).toThrow('missing required scopes: source:write')

    result = authorizeAction(result.workspace, {
      actorId: 'test-owner',
      expectedProposalRevision: result.proposal.revision,
      expectedWorkspaceRevision: result.workspace.revision,
      grantedScopes: ['source:write'],
      idempotencyKey: 'authorize-exact-scope',
      now: NOW,
      proposalId: result.proposal.id
    })
    expect(result.proposal.status).toBe('authorized')
    expect(result.proposal.authorization).toMatchObject({
      actorId: 'test-owner',
      grantedScopes: ['source:write'],
      status: 'granted'
    })
  })

  test('records failed verification instead of overstating incomplete source evidence', async () => {
    const approved = await approvedDecision()
    let proposalResult = proposeAction(approved.workspace, {
      decisionReceiptId: approved.decisionReceiptId,
      expectedWorkspaceRevision: approved.workspace.revision,
      id: 'action-proposal_incomplete-verification',
      idempotencyKey: 'propose-incomplete-verification',
      name: 'Source action with incomplete proof',
      now: NOW,
      requiredScopes: ['source:write'],
      steps: [SOURCE_STEP]
    })
    proposalResult = authorizeAction(proposalResult.workspace, {
      actorId: 'test-owner',
      expectedProposalRevision: proposalResult.proposal.revision,
      expectedWorkspaceRevision: proposalResult.workspace.revision,
      grantedScopes: ['source:write'],
      idempotencyKey: 'authorize-incomplete-verification',
      now: NOW,
      proposalId: proposalResult.proposal.id
    })
    const execution = recordActionExecution(proposalResult.workspace, {
      appliedAt: NOW,
      executionReceiptId: 'action-execution-receipt_incomplete-verification',
      executorId: 'source-connector',
      expectedProposalRevision: proposalResult.proposal.revision,
      expectedWorkspaceRevision: proposalResult.workspace.revision,
      idempotencyKey: 'execute-incomplete-verification',
      proposalId: proposalResult.proposal.id,
      results: [
        {
          afterHash: 'git:after-source-change',
          beforeHash: 'git:before-source-change',
          status: 'applied',
          stepId: SOURCE_STEP.id,
          targetRef: SOURCE_STEP.target.ref
        }
      ]
    })
    const verification = recordActionVerification(execution.workspace, {
      checks: [
        {
          command: 'bun test action-lifecycle',
          evidenceRef: 'test://action-lifecycle/source-check',
          id: 'check-source-test-only',
          kind: 'test',
          observedAt: NOW,
          passed: true,
          resultDigest: 'sha256:test-passed',
          targetRef: SOURCE_STEP.target.ref
        }
      ],
      expectedProposalRevision: execution.proposal.revision,
      expectedWorkspaceRevision: execution.workspace.revision,
      idempotencyKey: 'verify-incomplete-source-action',
      proposalId: execution.proposal.id,
      verificationReceiptId: 'action-verification-receipt_incomplete-verification',
      verifiedAt: NOW,
      verifiedBy: 'verification-agent'
    })

    expect(verification.verification.outcome).toBe('failed')
    expect(verification.proposal.status).toBe('failed')
    expect(verification.proposal.status).not.toBe('verified')
  })

  test('persists and reloads one verified chain across source, workspace, and connector targets', async () => {
    const approved = await approvedDecision()
    const steps: ActionProposalStep[] = [
      SOURCE_STEP,
      {
        description: 'Update the canonical workspace decision record',
        id: 'step-workspace-update',
        operation: 'update',
        payloadDigest: 'sha256:workspace-change-v1',
        target: {
          kind: 'workspace',
          label: 'Intake decision record',
          ref: 'workspace://intake/decision-record'
        }
      },
      {
        description: 'Update the linked roadmap issue',
        id: 'step-external-update',
        operation: 'update',
        payloadDigest: 'sha256:linear-change-v1',
        target: {
          connectorId: 'linear',
          kind: 'external-system',
          label: 'Roadmap issue INTAKE-42',
          ref: 'linear://issue/INTAKE-42'
        }
      }
    ]
    let proposalResult = proposeAction(approved.workspace, {
      actorId: 'planning-agent',
      decisionReceiptId: approved.decisionReceiptId,
      expectedWorkspaceRevision: approved.workspace.revision,
      id: 'action-proposal_full-chain',
      idempotencyKey: 'propose-full-action-chain',
      name: 'Apply approved intake flow everywhere',
      now: NOW,
      requiredScopes: ['source:write', 'workspace:write', 'linear:issue:write'],
      steps
    })
    proposalResult = authorizeAction(proposalResult.workspace, {
      actorId: 'test-owner',
      expectedProposalRevision: proposalResult.proposal.revision,
      expectedWorkspaceRevision: proposalResult.workspace.revision,
      grantedScopes: ['source:write', 'workspace:write', 'linear:issue:write'],
      idempotencyKey: 'authorize-full-action-chain',
      now: NOW,
      proposalId: proposalResult.proposal.id
    })
    const execution = recordActionExecution(proposalResult.workspace, {
      appliedAt: NOW,
      executionReceiptId: 'action-execution-receipt_full-chain',
      executorId: 'connector-orchestrator',
      expectedProposalRevision: proposalResult.proposal.revision,
      expectedWorkspaceRevision: proposalResult.workspace.revision,
      idempotencyKey: 'execute-full-action-chain',
      proposalId: proposalResult.proposal.id,
      results: steps.map((step) => ({
        afterHash: `after:${step.id}`,
        beforeHash: `before:${step.id}`,
        status: 'applied' as const,
        stepId: step.id,
        targetRef: step.target.ref
      }))
    })
    const checks = [
      ['check-source-test', 'test', SOURCE_STEP.target.ref],
      ['check-source-runtime', 'runtime', SOURCE_STEP.target.ref],
      ['check-workspace', 'workspace', 'workspace://intake/decision-record'],
      ['check-linear-readback', 'external-readback', 'linear://issue/INTAKE-42']
    ] as const
    const verification = recordActionVerification(execution.workspace, {
      checks: checks.map(([id, kind, targetRef]) => ({
        evidenceRef: `evidence://${id}`,
        id,
        kind,
        observedAt: NOW,
        passed: true,
        resultDigest: `sha256:${id}:passed`,
        targetRef
      })),
      expectedProposalRevision: execution.proposal.revision,
      expectedWorkspaceRevision: execution.workspace.revision,
      idempotencyKey: 'verify-full-action-chain',
      proposalId: execution.proposal.id,
      verificationReceiptId: 'action-verification-receipt_full-chain',
      verifiedAt: NOW,
      verifiedBy: 'verification-agent'
    })

    expect(verification.proposal.status).toBe('verified')
    expect(verification.execution.results).toHaveLength(3)
    expect(verification.verification.checks).toHaveLength(4)
    expect(verification.verification.outcome).toBe('verified')

    const reloaded = deserializeWorkspace(serializeWorkspace(verification.workspace))
    const reloadedProposal = reloaded.objects[verification.proposal.id]
    expect(reloaded.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION)
    expect(reloadedProposal).toEqual(verification.proposal)
    expect(
      reloadedProposal.type === 'action-proposal' && reloadedProposal.executionReceipt
    ).toEqual({ objectId: verification.execution.id, revision: verification.execution.revision })
    expect(
      reloadedProposal.type === 'action-proposal' && reloadedProposal.verificationReceipt
    ).toEqual({
      objectId: verification.verification.id,
      revision: verification.verification.revision
    })
    expect(
      queryWorkspaceItems(reloaded, { statuses: ['verified'] }).items.map((item) => item.id)
    ).toEqual(expect.arrayContaining([verification.proposal.id, verification.verification.id]))
    expect(
      queryWorkspaceItems(reloaded, { sourceTarget: 'linear://issue/INTAKE-42' }).items.map(
        (item) => item.id
      )
    ).toEqual(
      expect.arrayContaining([
        verification.proposal.id,
        verification.execution.id,
        verification.verification.id
      ])
    )

    const rollback = recordActionRollback(verification.workspace, {
      actorId: 'test-owner',
      expectedProposalRevision: verification.proposal.revision,
      expectedWorkspaceRevision: verification.workspace.revision,
      grantedScopes: ['source:write', 'workspace:write', 'linear:issue:write'],
      idempotencyKey: 'rollback-full-action-chain',
      now: NOW,
      proposalId: verification.proposal.id,
      reason: 'Return every target to the exact approved preimage',
      results: steps.map((step) => ({
        afterHash: `before:${step.id}`,
        beforeHash: `after:${step.id}`,
        status: 'restored' as const,
        stepId: step.id,
        targetRef: step.target.ref
      })),
      rollbackReceiptId: 'action-rollback-receipt_full-chain'
    })

    expect(rollback.proposal.status).toBe('rolled-back')
    expect(rollback.rollback.status).toBe('restored')
    expect(rollback.rollback.authorization).toMatchObject({
      actorId: 'test-owner',
      grantedScopes: ['source:write', 'workspace:write', 'linear:issue:write']
    })
    const reloadedRollback = deserializeWorkspace(serializeWorkspace(rollback.workspace))
    expect(reloadedRollback.objects[rollback.rollback.id]).toEqual(rollback.rollback)
    expect(
      queryWorkspaceItems(reloadedRollback, { statuses: ['rolled-back'] }).items.map(
        (item) => item.id
      )
    ).toContain(rollback.proposal.id)
  })
})
