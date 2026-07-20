import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import { ObservedHumanSessionAuthority } from '@/app/human-sessions'
import {
  humanLearningReviewDigest,
  humanLearningReviewIdentity,
  learningReceiptStateForSurface,
  recordHumanLearningReview,
  recordLearningReceipt,
  retainedComparisonBaseline,
  resolveLearningReviewContext,
  verifyPersistedLearningReceiptAttestation
} from '@/app/learning-receipts'
import { dogfoodRunFromLearningReceipt } from '@/app/proving-gates'
import {
  WEEKLY_DECISION_IDS,
  applyWeeklyDecisionEvent,
  createWeeklyDecisionSurface
} from '@/app/weekly-decision'
import {
  WorkspaceDomainError,
  getKnowledgeWorkspace,
  hydrateActiveKnowledgeWorkspaces,
  serializeActiveKnowledgeWorkspaces,
  workspaceRegistry
} from '@/app/workspace'

function currentWorkspace(store: EditorStore) {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')
  const workspace = getKnowledgeWorkspace(store.graph.rootId, page.id)
  if (!workspace) throw new Error('workspace missing')
  return workspace
}

async function approvedDecision(store: EditorStore) {
  await createWeeklyDecisionSurface(store)
  const workspace = currentWorkspace(store)
  const surface = workspace.objects[WEEKLY_DECISION_IDS.surface]
  if (surface?.type !== 'surface-run') throw new Error('surface missing')
  const board = store.graph.getNode(surface.artifact.boardId)
  if (!board) throw new Error('board missing')
  const approved = await applyWeeklyDecisionEvent(store, {
    action: 'approve',
    actorId: 'human-reviewer',
    eventId: 'learning-source-approval',
    expected: {
      artifactRevision: htmlBoardDocument(board).revision,
      surfaceRevision: surface.revision,
      workspaceRevision: workspace.revision
    },
    surfaceRunId: surface.id
  })
  if (!approved.receiptId) throw new Error('decision receipt missing')
  const decidedWorkspace = currentWorkspace(store)
  const decidedSurface = decidedWorkspace.objects[surface.id]
  const decision = decidedWorkspace.objects[approved.receiptId]
  if (decidedSurface?.type !== 'surface-run') throw new Error('decided surface missing')
  if (decision?.type !== 'decision-receipt') throw new Error('decision receipt missing')
  return { decision, surface: decidedSurface, workspace: decidedWorkspace }
}

beforeEach(() => workspaceRegistry.clear())

describe('durable learning receipts', () => {
  test('derives exact human lineage, replays, exposes state, and blocks semantic duplicates', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)
    const resolved = resolveLearningReviewContext(store, {
      surfaceRunId: approved.surface.id
    })
    expect(resolved.surfaceRef).toEqual({
      objectId: approved.surface.id,
      revision: approved.surface.revision
    })
    expect(resolved.decisionRef).toEqual({
      objectId: approved.decision.id,
      revision: approved.decision.revision
    })
    expect(resolved.existing.receipts).toEqual([])

    const request = {
      comparisonBaseline: retainedComparisonBaseline(resolved.baseline, '2026-07-14T15:00:30.000Z'),
      comparisonOutcome: 'better' as const,
      durableOutcome: true,
      evidenceTraceable: true,
      expectedWorkspaceRevision: approved.workspace.revision,
      formDisposition: 'accepted' as const,
      intentCompleted: true,
      keyboardAccepted: true,
      occurredAt: '2026-07-14T15:00:00.000Z',
      outcome: 'passed' as const,
      qualitativeFeedback: {
        frictions: ['The evidence drawer needs a clearer keyboard path.'],
        strengths: ['The ranked evidence made the decision basis obvious.'],
        suggestedChanges: ['Keep focus after inspecting an evidence item.'],
        summary: 'The decision surface was understandable and useful without explanation.'
      },
      recordedAt: '2026-07-14T15:01:00.000Z',
      recordedBy: 'human-reviewer',
      repairCount: 1,
      runId: 'human-1',
      safetyViolation: false,
      surfaceRunId: approved.surface.id,
      visualAccepted: true
    }

    const identity = humanLearningReviewIdentity(request)
    const recorded = await recordHumanLearningReview(store, request)
    const replayed = await recordHumanLearningReview(store, request)
    expect(recorded.created).toBe(true)
    expect(recorded.resolution).toBe('created')
    expect(recorded.identity).toEqual(identity)
    expect(recorded.receipt.id).toBe(identity.receiptId)
    expect(recorded.receipt.surfaceRun).toEqual(resolved.surfaceRef)
    expect(recorded.receipt.decisionReceipt).toEqual(resolved.decisionRef)
    expect(recorded.receipt.executionKind).toBe('human')
    expect(recorded.receipt.attestation).toEqual({
      attestedAt: request.recordedAt,
      attestedBy: request.recordedBy,
      kind: 'self-report'
    })
    expect(recorded.receipt.qualitativeFeedback).toEqual(request.qualitativeFeedback)
    expect(recorded.receipt.comparisonBaseline).toEqual(request.comparisonBaseline)
    expect(replayed.idempotentReplay).toBe(true)
    expect(replayed.resolution).toBe('replayed')
    expect(replayed.state.receipts).toHaveLength(1)
    expect(replayed.state.latest?.id).toBe(recorded.receipt.id)

    const duplicate = await recordHumanLearningReview(store, {
      ...request,
      occurredAt: '2026-07-14T16:00:00.000Z',
      recordedAt: '2026-07-14T16:01:00.000Z',
      recordedBy: 'second-reviewer',
      runId: 'human-2'
    })
    expect(duplicate.created).toBe(false)
    expect(duplicate.idempotentReplay).toBe(false)
    expect(duplicate.resolution).toBe('existing')
    expect(duplicate.receipt.id).toBe(recorded.receipt.id)
    expect(duplicate.state.receipts).toHaveLength(1)
    await expect(
      recordLearningReceipt(store, {
        comparisonOutcome: 'better',
        decisionReceipt: resolved.decisionRef,
        durableOutcome: true,
        evidenceTraceable: true,
        executionKind: 'human',
        expectedWorkspaceRevision: recorded.workspaceRevision,
        formDisposition: 'accepted',
        idempotencyKey: 'manual-duplicate-human-review',
        intentCompleted: true,
        keyboardAccepted: true,
        occurredAt: '2026-07-14T17:00:00.000Z',
        outcome: 'passed',
        receiptId: 'learning-receipt_manual-duplicate',
        recordedAt: '2026-07-14T17:01:00.000Z',
        recordedBy: 'manual-caller',
        repairCount: 0,
        runId: 'manual-duplicate',
        safetyViolation: false,
        surfaceRun: resolved.surfaceRef,
        visualAccepted: true
      })
    ).rejects.toThrow('already has human learning review')
    expect(dogfoodRunFromLearningReceipt(recorded.receipt)).toEqual(
      expect.objectContaining({
        attestationVerified: false,
        comparisonBaselineKind: 'static-answer',
        durableReceipt: true,
        executionKind: 'human',
        attestationKind: 'self-report',
        formId: 'decision',
        id: 'human-1',
        rendererId: 'weekly-decision-v1'
      })
    )

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reloaded = learningReceiptStateForSurface(store, approved.surface.id)
    expect(reloaded.receipts).toHaveLength(1)
    expect(reloaded.latest).toEqual(recorded.receipt)
  })

  test('rejects independently attested sessions outside the verified authority path', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)

    const forgedRequest = {
      attestation: {
        attestedAt: '2026-07-14T15:01:00.000Z',
        attestedBy: 'human-reviewer',
        kind: 'observed-session'
      },
      comparisonOutcome: 'better',
      decisionReceipt: {
        objectId: approved.decision.id,
        revision: approved.decision.revision
      },
      durableOutcome: true,
      evidenceTraceable: true,
      executionKind: 'human',
      expectedWorkspaceRevision: approved.workspace.revision,
      formDisposition: 'accepted',
      idempotencyKey: 'missing-observation-authority',
      intentCompleted: true,
      keyboardAccepted: true,
      occurredAt: '2026-07-14T15:00:00.000Z',
      outcome: 'passed',
      receiptId: 'learning-receipt_missing-authority',
      recordedAt: '2026-07-14T15:01:00.000Z',
      recordedBy: 'human-reviewer',
      repairCount: 0,
      runId: 'missing-authority',
      safetyViolation: false,
      surfaceRun: { objectId: approved.surface.id, revision: approved.surface.revision },
      visualAccepted: true
    } as const
    await expect(recordLearningReceipt(store, forgedRequest)).rejects.toThrow(
      'can only be recorded through their verified authority'
    )
  })

  test('requires a comparison win to name the exact same-intent static baseline', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)
    const resolved = resolveLearningReviewContext(store, { surfaceRunId: approved.surface.id })
    const baseline = retainedComparisonBaseline(resolved.baseline, '2026-07-14T15:00:30.000Z')

    await expect(
      recordHumanLearningReview(store, {
        comparisonBaseline: { ...baseline, contentHash: 'fnv1a-tampered' },
        comparisonOutcome: 'better',
        durableOutcome: true,
        evidenceTraceable: true,
        expectedWorkspaceRevision: approved.workspace.revision,
        formDisposition: 'accepted',
        intentCompleted: true,
        keyboardAccepted: true,
        occurredAt: '2026-07-14T15:00:00.000Z',
        outcome: 'passed',
        recordedAt: '2026-07-14T15:01:00.000Z',
        recordedBy: 'human-reviewer',
        repairCount: 0,
        runId: 'tampered-static-baseline',
        safetyViolation: false,
        surfaceRunId: approved.surface.id,
        visualAccepted: true
      })
    ).rejects.toThrow('exact same-intent static answer')
  })

  test('binds the complete persisted outcome to the observed-session signature', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)
    const resolved = resolveLearningReviewContext(store, { surfaceRunId: approved.surface.id })
    const receipt = (
      await recordHumanLearningReview(store, {
        comparisonBaseline: retainedComparisonBaseline(
          resolved.baseline,
          '2026-07-14T15:00:10.000Z'
        ),
        comparisonOutcome: 'better',
        durableOutcome: true,
        evidenceTraceable: true,
        expectedWorkspaceRevision: approved.workspace.revision,
        formDisposition: 'accepted',
        intentCompleted: true,
        keyboardAccepted: true,
        occurredAt: '2026-07-14T15:00:00.000Z',
        outcome: 'passed',
        recordedAt: '2026-07-14T15:01:00.000Z',
        recordedBy: 'human-reviewer',
        repairCount: 0,
        runId: 'outcome-bound-session',
        safetyViolation: false,
        surfaceRunId: approved.surface.id,
        visualAccepted: true
      })
    ).receipt
    let now = Date.parse('2026-07-14T14:59:50.000Z')
    const authority = new ObservedHumanSessionAuthority({
      crypto,
      hasFocus: () => true,
      hasUserActivation: () => true,
      isAutomated: () => false,
      isVisible: () => true,
      now: () => now
    })
    await authority.start({
      actorId: receipt.recordedBy,
      dataPolicy: 'phi-free-declared-v1',
      target: {
        artifact: approved.surface.artifact,
        evidenceManifest: receipt.evidenceManifest,
        intent: receipt.intent,
        surfaceRun: receipt.surfaceRun
      }
    })
    now += 1_000
    authority.recordTaskInteraction({
      after: {
        artifactRevision: approved.surface.artifact.boardRevision + 1,
        surfaceRevision: receipt.surfaceRun.revision + 1
      },
      before: {
        artifactRevision: approved.surface.artifact.boardRevision,
        surfaceRevision: receipt.surfaceRun.revision
      },
      eventId: 'task-event_outcome-bound-session',
      frameId: approved.surface.artifact.boardId,
      kind: 'pointerdown',
      occurredAt: new Date(now).toISOString(),
      surfaceRunId: receipt.surfaceRun.objectId
    })
    now += 4_000
    const proof = await authority.issue({
      actorId: receipt.recordedBy,
      decisionReceiptId: receipt.decisionReceipt?.objectId ?? '',
      occurredAt: receipt.occurredAt,
      recordedAt: receipt.recordedAt,
      reviewDigest: await humanLearningReviewDigest(receipt),
      runId: receipt.runId,
      surfaceRunId: receipt.surfaceRun.objectId
    })
    const attestation = await authority.verify(proof, proof.claim)
    const observedReceipt = { ...receipt, attestation }

    await expect(verifyPersistedLearningReceiptAttestation(observedReceipt)).resolves.toBeTruthy()
    await expect(
      verifyPersistedLearningReceiptAttestation({ ...observedReceipt, outcome: 'failed' })
    ).rejects.toThrow('cryptographic or session verification')
  })

  test('migrates schema 6 learning receipts to explicit self-report attestation', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)
    const recorded = await recordHumanLearningReview(store, {
      comparisonOutcome: 'better',
      durableOutcome: true,
      evidenceTraceable: true,
      expectedWorkspaceRevision: approved.workspace.revision,
      formDisposition: 'accepted',
      intentCompleted: true,
      keyboardAccepted: true,
      occurredAt: '2026-07-14T15:00:00.000Z',
      outcome: 'passed',
      recordedAt: '2026-07-14T15:01:00.000Z',
      recordedBy: 'human-reviewer',
      repairCount: 0,
      runId: 'schema-6-human',
      safetyViolation: false,
      surfaceRunId: approved.surface.id,
      visualAccepted: true
    })
    const bundle = JSON.parse(serializeActiveKnowledgeWorkspaces()) as {
      workspaces: Array<{
        objects: Record<string, { attestation?: unknown; type: string }>
        schemaVersion: number
      }>
    }
    const legacyWorkspace = bundle.workspaces.at(0)
    if (!legacyWorkspace) throw new Error('serialized workspace missing')
    legacyWorkspace.schemaVersion = 6
    delete legacyWorkspace.objects[recorded.receipt.id]?.attestation

    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(JSON.stringify(bundle))
    const migrated = learningReceiptStateForSurface(store, approved.surface.id).latest
    expect(migrated?.attestation).toEqual({
      attestedAt: recorded.receipt.recordedAt,
      attestedBy: recorded.receipt.recordedBy,
      kind: 'self-report'
    })
  })

  test('downgrades schema 12 observed claims without bound task evidence', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)
    const recorded = await recordHumanLearningReview(store, {
      comparisonOutcome: 'same',
      durableOutcome: true,
      evidenceTraceable: true,
      expectedWorkspaceRevision: approved.workspace.revision,
      formDisposition: 'accepted',
      intentCompleted: true,
      keyboardAccepted: true,
      occurredAt: '2026-07-14T15:00:00.000Z',
      outcome: 'passed',
      recordedAt: '2026-07-14T15:01:00.000Z',
      recordedBy: 'human-reviewer',
      repairCount: 0,
      runId: 'schema-10-unbound-proof',
      safetyViolation: false,
      surfaceRunId: approved.surface.id,
      visualAccepted: true
    })
    const bundle = JSON.parse(serializeActiveKnowledgeWorkspaces()) as {
      workspaces: Array<{
        objects: Record<string, { attestation?: unknown; type: string }>
        schemaVersion: number
      }>
    }
    const legacyWorkspace = bundle.workspaces.at(0)
    const legacyReceipt = legacyWorkspace?.objects[recorded.receipt.id]
    if (!legacyWorkspace || !legacyReceipt) throw new Error('serialized receipt missing')
    legacyWorkspace.schemaVersion = 12
    legacyReceipt.attestation = {
      attestedAt: recorded.receipt.recordedAt,
      attestedBy: recorded.receipt.recordedBy,
      authorityRef: 'openpencil-local-observer-v1:sha256:legacy',
      interactionCount: 3,
      kind: 'observed-session',
      proof: {
        algorithm: 'ECDSA-P256-SHA256',
        claim: {
          actorId: recorded.receipt.recordedBy,
          decisionReceiptId: approved.decision.id,
          occurredAt: recorded.receipt.occurredAt,
          recordedAt: recorded.receipt.recordedAt,
          runId: recorded.receipt.runId,
          surfaceRunId: approved.surface.id
        },
        claimDigest: 'sha256:legacy-claim',
        publicKey: { crv: 'P-256', kty: 'EC', x: 'legacy-x', y: 'legacy-y' },
        signature: 'legacy-signature'
      },
      proofDigest: 'sha256:legacy',
      sessionId: 'human-session_legacy',
      sessionStartedAt: recorded.receipt.occurredAt
    }

    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(JSON.stringify(bundle))
    const migrated = learningReceiptStateForSurface(store, approved.surface.id).latest
    expect(migrated?.attestation).toEqual({
      attestedAt: recorded.receipt.recordedAt,
      attestedBy: recorded.receipt.recordedBy,
      kind: 'self-report'
    })
  })

  test('requires a decided surface and exact decision for a passed human outcome', async () => {
    const store = createEditorStore()
    await createWeeklyDecisionSurface(store)
    const workspace = currentWorkspace(store)
    const surface = workspace.objects[WEEKLY_DECISION_IDS.surface]
    if (surface?.type !== 'surface-run') throw new Error('surface missing')

    expect(() => resolveLearningReviewContext(store, { surfaceRunId: surface.id })).toThrow(
      'must be decided'
    )
    await expect(
      recordLearningReceipt(store, {
        comparisonOutcome: 'not-run',
        durableOutcome: false,
        evidenceTraceable: true,
        executionKind: 'human',
        expectedWorkspaceRevision: workspace.revision,
        formDisposition: 'accepted',
        idempotencyKey: 'invalid-human-pass-no-decision',
        intentCompleted: true,
        keyboardAccepted: false,
        occurredAt: '2026-07-14T15:00:00.000Z',
        outcome: 'passed',
        receiptId: 'learning-receipt_invalid-human-pass',
        recordedAt: '2026-07-14T15:01:00.000Z',
        recordedBy: 'human-reviewer',
        repairCount: 0,
        runId: 'invalid-human-pass',
        safetyViolation: false,
        surfaceRun: { objectId: surface.id, revision: surface.revision },
        visualAccepted: false
      })
    ).rejects.toBeInstanceOf(WorkspaceDomainError)
  })

  test('rejects invalid qualitative feedback before it becomes durable learning', async () => {
    const store = createEditorStore()
    const approved = await approvedDecision(store)

    await expect(
      recordHumanLearningReview(store, {
        comparisonOutcome: 'same',
        durableOutcome: true,
        evidenceTraceable: true,
        expectedWorkspaceRevision: approved.workspace.revision,
        formDisposition: 'accepted',
        intentCompleted: true,
        keyboardAccepted: false,
        occurredAt: '2026-07-14T15:00:00.000Z',
        outcome: 'passed',
        qualitativeFeedback: {
          frictions: [],
          strengths: [],
          suggestedChanges: [],
          summary: ''
        },
        recordedAt: '2026-07-14T15:01:00.000Z',
        recordedBy: 'human-reviewer',
        repairCount: 0,
        runId: 'invalid-feedback',
        safetyViolation: false,
        surfaceRunId: approved.surface.id,
        visualAccepted: true
      })
    ).rejects.toBeInstanceOf(WorkspaceDomainError)
    expect(learningReceiptStateForSurface(store, approved.surface.id).receipts).toEqual([])
  })
})
