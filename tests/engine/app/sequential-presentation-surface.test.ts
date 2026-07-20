import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import {
  SEQUENTIAL_PRESENTATION_IDS,
  applySequentialPresentationEvent,
  createSequentialPresentation,
  parseSequentialPresentationEvent,
  reconstructSequentialPresentationReceipt,
  sequentialPresentationStateForBoard,
  type SequentialPresentationEventRequest
} from '@/app/sequential-presentation'
import {
  getKnowledgeWorkspace,
  hydrateActiveKnowledgeWorkspaces,
  serializeActiveKnowledgeWorkspaces,
  workspaceRegistry
} from '@/app/workspace'

function currentWorkspace(store: EditorStore) {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')
  const workspace = getKnowledgeWorkspace(store.graph.rootId, page.id)
  if (!workspace) throw new Error('sequential presentation workspace missing')
  return workspace
}

function currentSurface(store: EditorStore) {
  const object = currentWorkspace(store).objects[SEQUENTIAL_PRESENTATION_IDS.surface]
  if (!object || object.type !== 'surface-run') {
    throw new Error('sequential presentation surface missing')
  }
  return object
}

function board(store: EditorStore) {
  const node = store.graph.getNode(currentSurface(store).artifact.boardId)
  if (!node) throw new Error('sequential presentation board missing')
  return node
}

function eventFor(
  store: EditorStore,
  eventId: string,
  input: Omit<SequentialPresentationEventRequest, 'eventId' | 'expected' | 'surfaceRunId'>
): SequentialPresentationEventRequest {
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

describe('Sequential Presentation reusable experience recipe', () => {
  test('creates a bounded story form over canonical identity and restrictive capabilities', async () => {
    const store = createEditorStore()
    const result = await createSequentialPresentation(store)
    const workspace = currentWorkspace(store)
    const surface = currentSurface(store)
    const document = htmlBoardDocument(board(store))
    const source = document.html

    expect(result.created).toBe(true)
    expect(surface.rendererId).toBe('sequential-presentation-v1')
    expect(surface.form.kind).toBe('sequential-presentation')
    expect(surface.jobKind).toBe('explain')
    expect(surface.formChoice.rationale).toContain('Presentation')
    expect(surface.intent).toEqual({ objectId: SEQUENTIAL_PRESENTATION_IDS.intent, revision: 1 })
    expect(surface.evidenceManifest).toEqual({
      objectId: SEQUENTIAL_PRESENTATION_IDS.evidenceManifest,
      revision: 1
    })
    expect(surface.capabilities).toEqual({
      externalWrites: false,
      networkAccess: false,
      sourceWrites: false
    })
    expect(document.artifact?.kind).toBe('sequential-presentation-surface')
    expect(source).toContain('An answer can be an experience.')
    expect(source).toContain('Evidence for this step')
    expect(source).toContain("connect-src 'none'")
    expect(source.match(/class="slide [^"]*is-active"/g)).toHaveLength(1)
    expect(sequentialPresentationStateForBoard(store, board(store))?.activeSlideId).toBe('thesis')
    expect(Object.values(workspace.relations).map((relation) => relation.relationType)).toEqual([
      'fulfills-intent',
      'uses-evidence'
    ])
  })

  test('parses only bounded navigation and approval events', () => {
    expect(
      parseSequentialPresentationEvent({
        action: 'navigate',
        eventId: 'navigate-1',
        expected: { artifactRevision: 1, surfaceRevision: 1, workspaceRevision: 1 },
        surfaceRunId: 'surface-1',
        targetSlideId: 'shared-model'
      })
    ).toEqual({
      action: 'navigate',
      actorId: undefined,
      eventId: 'navigate-1',
      expected: { artifactRevision: 1, surfaceRevision: 1, workspaceRevision: 1 },
      note: undefined,
      surfaceRunId: 'surface-1',
      targetSlideId: 'shared-model'
    })
    expect(
      parseSequentialPresentationEvent({
        action: 'navigate',
        eventId: 'missing-target',
        expected: { artifactRevision: 1, surfaceRevision: 1, workspaceRevision: 1 },
        surfaceRunId: 'surface-1'
      })
    ).toBeNull()
    expect(
      parseSequentialPresentationEvent({
        action: 'execute-source',
        eventId: 'forbidden',
        expected: { artifactRevision: 1, surfaceRevision: 1, workspaceRevision: 1 },
        surfaceRunId: 'surface-1'
      })
    ).toBeNull()
  })

  test('persists navigation with exact revisions, idempotency, and stale-basis rejection', async () => {
    const store = createEditorStore()
    await createSequentialPresentation(store)
    const beforeSurfaceRevision = currentSurface(store).revision
    const beforeArtifactRevision = htmlBoardDocument(board(store)).revision

    const navigation = eventFor(store, 'presentation-navigate-1', {
      action: 'navigate',
      targetSlideId: 'shared-model'
    })
    const applied = await applySequentialPresentationEvent(store, navigation)
    expect(applied.status).toBe('applied')
    expect(applied.state?.activeSlideId).toBe('shared-model')
    expect(currentSurface(store).revision).toBe(beforeSurfaceRevision + 1)
    expect(htmlBoardDocument(board(store)).revision).toBe(beforeArtifactRevision + 1)
    expect(currentSurface(store).interactions).toEqual([
      expect.objectContaining({
        action: 'adjust',
        id: 'presentation-navigate-1',
        inputId: 'active-slide',
        value: 'shared-model'
      })
    ])

    expect((await applySequentialPresentationEvent(store, navigation)).status).toBe('replayed')
    expect(currentSurface(store).interactions).toHaveLength(1)

    const stale = eventFor(store, 'presentation-stale-1', {
      action: 'navigate',
      targetSlideId: 'why-sequence'
    })
    stale.expected.workspaceRevision -= 1
    const rejected = await applySequentialPresentationEvent(store, stale)
    expect(rejected.status).toBe('rejected')
    expect(rejected.error).toContain('revision_conflict')
    expect(currentSurface(store).interactions).toHaveLength(1)
    expect(sequentialPresentationStateForBoard(store, board(store))?.activeSlideId).toBe(
      'shared-model'
    )
  })

  test('approves only from the closing slide and reconstructs the exact sequence after reload', async () => {
    const store = createEditorStore()
    await createSequentialPresentation(store)

    const premature = eventFor(store, 'presentation-premature-approval', { action: 'approve' })
    const denied = await applySequentialPresentationEvent(store, premature)
    expect(denied.status).toBe('rejected')
    expect(denied.error).toContain('closing review slide')

    const navigate = eventFor(store, 'presentation-navigate-review', {
      action: 'navigate',
      targetSlideId: 'review'
    })
    expect((await applySequentialPresentationEvent(store, navigate)).status).toBe('applied')

    const approval = eventFor(store, 'presentation-approve', {
      action: 'approve',
      actorId: 'reviewer-1',
      note: 'Accept the sequence as the current explanation.'
    })
    const approved = await applySequentialPresentationEvent(store, approval)
    expect(approved.error).toBeUndefined()
    expect(approved.status).toBe('applied')
    expect((await applySequentialPresentationEvent(store, approval)).status).toBe('replayed')
    expect(currentSurface(store).status).toBe('decided')
    expect(htmlBoardDocument(board(store)).workflow.status).toBe('approved')

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reconstruction = reconstructSequentialPresentationReceipt(store, approved.receiptId ?? '')

    expect(reconstruction.activeSlideId).toBe('review')
    expect(reconstruction.receipt?.artifact).toEqual(reconstruction.surface.artifact)
    expect(reconstruction.receipt?.corrections).toEqual(reconstruction.surface.interactions)
    expect(reconstruction.receipt?.outcome.selectedRecommendationIds).toEqual([
      'approve-sequential-presentation'
    ])
    expect(reconstruction.surface.interactions.map((interaction) => interaction.action)).toEqual([
      'adjust',
      'approve'
    ])
  })
})
