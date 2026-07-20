import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import {
  WEEKLY_DECISION_EVIDENCE,
  WEEKLY_DECISION_IDS,
  applyWeeklyDecisionEvent,
  createWeeklyDecisionSurface,
  reconstructWeeklyDecisionReceipt,
  weeklyDecisionStateForBoard
} from '@/app/weekly-decision'
import type { OptionWorkbenchSpec, WeeklyDecisionEventRequest } from '@/app/weekly-decision'
import {
  WorkspaceDomainError,
  applyWorkspaceMutation,
  createKnowledgeWorkspace,
  createSurfaceRun,
  createWorkspaceContext,
  getKnowledgeWorkspace,
  hydrateActiveKnowledgeWorkspaces,
  serializeActiveKnowledgeWorkspaces,
  workspaceRegistry
} from '@/app/workspace'

function currentWorkspace(store: EditorStore) {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')
  const workspace = getKnowledgeWorkspace(store.graph.rootId, page.id)
  if (!workspace) throw new Error('weekly decision workspace missing')
  return workspace
}

function currentSurface(store: EditorStore) {
  const object = currentWorkspace(store).objects[WEEKLY_DECISION_IDS.surface]
  if (!object || object.type !== 'surface-run') throw new Error('weekly decision surface missing')
  return object
}

function board(store: EditorStore) {
  const node = store.graph.getNode(currentSurface(store).artifact.boardId)
  if (!node) throw new Error('weekly decision board missing')
  return node
}

function eventFor(
  store: EditorStore,
  eventId: string,
  input: Omit<WeeklyDecisionEventRequest, 'eventId' | 'expected' | 'surfaceRunId'>
): WeeklyDecisionEventRequest {
  const workspace = currentWorkspace(store)
  const surface = currentSurface(store)
  return {
    ...input,
    eventId,
    expected: {
      artifactRevision: htmlBoardDocument(board(store)).revision,
      surfaceRevision: surface.revision,
      workspaceRevision: workspace.revision
    },
    surfaceRunId: surface.id
  }
}

beforeEach(() => workspaceRegistry.clear())

describe('Weekly Decision Surface proving build', () => {
  test('creates one canonical lineage and ranks the clearest blocker first', async () => {
    const store = createEditorStore()
    const result = await createWeeklyDecisionSurface(store)
    const workspace = currentWorkspace(store)
    const surface = currentSurface(store)
    const manifest = workspace.objects[surface.evidenceManifest.objectId]

    expect(result.created).toBe(true)
    expect(surface.intent).toEqual({ objectId: WEEKLY_DECISION_IDS.intent, revision: 1 })
    expect(surface.evidenceManifest).toEqual({
      objectId: WEEKLY_DECISION_IDS.evidenceManifest,
      revision: 1
    })
    expect(surface.recommendations[0]?.title).toBe('Trust the build you are looking at')
    expect(surface.artifact.artifactId).toBe(surface.id)
    expect(weeklyDecisionStateForBoard(store, board(store))?.surface.id).toBe(surface.id)
    expect(manifest?.type).toBe('evidence-manifest')
    expect(Object.values(workspace.relations).map((relation) => relation.relationType)).toEqual([
      'fulfills-intent',
      'uses-evidence'
    ])
  })

  test('exposes conflicting, stale, captured, and fixture evidence without overstating truth', async () => {
    const store = createEditorStore()
    await createWeeklyDecisionSurface(store)
    const workspace = currentWorkspace(store)
    const surface = currentSurface(store)
    const manifest = workspace.objects[surface.evidenceManifest.objectId]
    if (manifest?.type !== 'evidence-manifest') throw new Error('manifest missing')
    const source = htmlBoardDocument(board(store)).html

    expect(manifest.items).toHaveLength(8)
    expect(manifest.items.map((item) => item.truthScope)).toContain('captured')
    expect(manifest.items.map((item) => item.truthScope)).toContain('fixture')
    expect(manifest.items.map((item) => item.truthScope)).toContain('last-known')
    expect(manifest.items.map((item) => item.truthScope)).toContain('derived')
    expect(manifest.items.some((item) => item.freshness === 'stale')).toBe(true)
    expect(source).toContain('fixture · stale')
    expect(source).toContain('captured · current')
    expect(source).toContain('Browse all evidence')
    expect(source).toContain("connect-src 'none'")
    expect(currentSurface(store).capabilities).toEqual({
      externalWrites: false,
      networkAccess: false,
      sourceWrites: false
    })
  })

  test('denies mutation for a read-only surface object', () => {
    const workspace = createKnowledgeWorkspace({
      documentId: 'document-read-only',
      name: 'Read only',
      pageId: 'page-read-only'
    })
    const context = createWorkspaceContext(workspace)
    const surface = createSurfaceRun(context, {
      artifact: {
        artifactId: 'surface-read-only',
        boardId: 'board-read-only',
        boardRevision: 1,
        boardSchemaVersion: 6,
        kind: 'html-board',
        sourceHash: 'fixture-hash'
      },
      evidenceManifest: { objectId: 'manifest-read-only', revision: 1 },
      formRationale: 'Permission test',
      id: 'surface-read-only',
      intent: { objectId: 'intent-read-only', revision: 1 },
      name: 'Read-only decision',
      permissions: { canComment: true, canEdit: false, canView: true },
      recommendations: []
    })
    const source = {
      ...workspace,
      objects: { [surface.id]: { ...surface, revision: 1 } }
    }

    expect(() =>
      applyWorkspaceMutation(source, {
        dryRun: false,
        expectedRevision: 0,
        idempotencyKey: 'read-only-update',
        operations: [
          {
            expectedObjectRevision: 1,
            objectId: surface.id,
            objectType: 'surface-run',
            patch: { name: 'Forbidden' },
            type: 'update-object'
          }
        ]
      })
    ).toThrow(WorkspaceDomainError)
  })

  test('rejects stale interaction bases and leaves durable state unchanged', async () => {
    const store = createEditorStore()
    await createWeeklyDecisionSurface(store)
    const request = eventFor(store, 'stale-event', {
      action: 'reject',
      recommendationId: 'recommendation-close-loop'
    })
    request.expected.surfaceRevision -= 1
    const result = await applyWeeklyDecisionEvent(store, request)

    expect(result.status).toBe('rejected')
    expect(result.error).toContain('revision_conflict')
    expect(currentSurface(store).interactions).toHaveLength(0)
    expect(currentSurface(store).recommendations[2]?.status).toBe('active')
  })

  test('persists override, retry, approval, reload, and exact receipt reconstruction', async () => {
    const store = createEditorStore()
    await createWeeklyDecisionSurface(store)

    const reorder = eventFor(store, 'decision-reorder-1', {
      action: 'reorder',
      recommendationId: 'recommendation-close-loop',
      toIndex: 0
    })
    expect((await applyWeeklyDecisionEvent(store, reorder)).status).toBe('applied')
    expect((await applyWeeklyDecisionEvent(store, reorder)).status).toBe('replayed')

    const reject = eventFor(store, 'decision-reject-1', {
      action: 'reject',
      recommendationId: 'recommendation-unify-identity'
    })
    expect((await applyWeeklyDecisionEvent(store, reject)).status).toBe('applied')

    const revise = eventFor(store, 'decision-revise-1', {
      action: 'revise',
      note: 'Prove the live run and preserve its exact receipt',
      recommendationId: 'recommendation-trust-build'
    })
    expect((await applyWeeklyDecisionEvent(store, revise)).status).toBe('applied')

    const approval = eventFor(store, 'decision-approve-1', { action: 'approve' })
    const approved = await applyWeeklyDecisionEvent(store, approval)
    expect(approved.status).toBe('applied')
    expect(approved.receiptId).toBe('decision-receipt_decision-approve-1')
    expect(currentSurface(store).status).toBe('decided')
    expect(htmlBoardDocument(board(store)).workflow.status).toBe('approved')

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reconstruction = reconstructWeeklyDecisionReceipt(store, approved.receiptId ?? '')

    expect(reconstruction.receipt?.artifact).toEqual(reconstruction.surface.artifact)
    expect(reconstruction.receipt?.outcome.finalOrder[0]).toBe('recommendation-close-loop')
    expect(reconstruction.receipt?.outcome.rejectedRecommendationIds).toEqual([
      'recommendation-unify-identity'
    ])
    expect(reconstruction.surface.interactions.map((interaction) => interaction.action)).toEqual([
      'reorder',
      'reject',
      'revise',
      'approve'
    ])
  })

  test('requires a preference and receipts the selected option for a generic comparison', async () => {
    const store = createEditorStore()
    const spec: OptionWorkbenchSpec = {
      capturedAt: '2026-07-14T22:00:00.000Z',
      evidence: WEEKLY_DECISION_EVIDENCE.slice(0, 1),
      formRationale: 'Side-by-side preference is more useful than a ranked backlog for this job.',
      id: 'compare-workbench-v1',
      intent: {
        constraints: ['Keep source unchanged'],
        desiredOutcome: 'Choose one next proof',
        statement: 'Compare two next proofs using one evidence snapshot.'
      },
      mode: 'compare',
      recommendations: [
        {
          evidenceItemIds: ['evidence-runtime-baseline'],
          id: 'field-proof',
          rank: 1,
          rationale: 'Tests the engine with a person.',
          status: 'active',
          title: 'Run a field proof',
          tradeoff: 'Adds no new renderer.',
          uncertainty: 'Scheduling is unknown.'
        },
        {
          evidenceItemIds: ['evidence-runtime-baseline'],
          id: 'renderer-proof',
          rank: 2,
          rationale: 'Tests another form.',
          status: 'active',
          title: 'Build a renderer proof',
          tradeoff: 'Adds code before human evidence.',
          uncertainty: 'Usefulness is unknown.'
        }
      ],
      rendererId: 'option-workbench-v1',
      title: 'Next proof comparison'
    }
    const created = await createWeeklyDecisionSurface(store, spec)
    const surfaceId = created.surfaceRunId
    const dynamicEvent = (
      eventId: string,
      input: Omit<WeeklyDecisionEventRequest, 'eventId' | 'expected' | 'surfaceRunId'>
    ): WeeklyDecisionEventRequest => {
      const workspace = currentWorkspace(store)
      const surface = workspace.objects[surfaceId]
      if (surface?.type !== 'surface-run') throw new Error('comparison surface missing')
      const node = store.graph.getNode(surface.artifact.boardId)
      if (!node) throw new Error('comparison board missing')
      return {
        ...input,
        eventId,
        expected: {
          artifactRevision: htmlBoardDocument(node).revision,
          surfaceRevision: surface.revision,
          workspaceRevision: workspace.revision
        },
        surfaceRunId: surface.id
      }
    }

    const premature = await applyWeeklyDecisionEvent(
      store,
      dynamicEvent('compare-approve-too-soon', { action: 'approve' })
    )
    expect(premature.status).toBe('rejected')
    expect(premature.error).toContain('choose one preferred alternative')

    const preferred = await applyWeeklyDecisionEvent(
      store,
      dynamicEvent('compare-prefer-field-proof', {
        action: 'prefer',
        recommendationId: 'field-proof'
      })
    )
    expect(preferred.status).toBe('applied')
    const approved = await applyWeeklyDecisionEvent(
      store,
      dynamicEvent('compare-approve-field-proof', { action: 'approve' })
    )
    expect(approved.error).toBeUndefined()
    expect(approved.status).toBe('applied')
    const receipt = currentWorkspace(store).objects[approved.receiptId ?? '']
    expect(receipt?.type).toBe('decision-receipt')
    if (receipt?.type !== 'decision-receipt') throw new Error('comparison receipt missing')
    expect(receipt.outcome.selectedRecommendationIds).toEqual(['field-proof', 'renderer-proof'])
    const decidedSurface = currentWorkspace(store).objects[surfaceId]
    expect(decidedSurface?.type).toBe('surface-run')
    if (decidedSurface?.type !== 'surface-run') throw new Error('decided comparison missing')
    expect(
      decidedSurface.recommendations.find((recommendation) => recommendation.status === 'preferred')
        ?.id
    ).toBe('field-proof')
  })
})
