import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import {
  FLOW_STUDIO_IDS,
  applyFlowStudioEvent,
  createFlowStudioSurface,
  reconstructFlowStudioReceipt,
  type FlowStudioEventRequest
} from '@/app/flow-studio'
import { htmlBoardDocument } from '@/app/html-board/workspace'
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
  if (!workspace) throw new Error('flow studio workspace missing')
  return workspace
}

function currentSurface(store: EditorStore) {
  const object = currentWorkspace(store).objects[FLOW_STUDIO_IDS.surface]
  if (!object || object.type !== 'surface-run') throw new Error('flow studio surface missing')
  return object
}

function board(store: EditorStore) {
  const node = store.graph.getNode(currentSurface(store).artifact.boardId)
  if (!node) throw new Error('flow studio board missing')
  return node
}

function eventFor(
  store: EditorStore,
  eventId: string,
  input: Omit<FlowStudioEventRequest, 'eventId' | 'expected' | 'surfaceRunId'>
): FlowStudioEventRequest {
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

describe('Flow Studio reusable experience recipe', () => {
  test('creates one shared model with explicit form choice, modes, and truthful evidence', async () => {
    const store = createEditorStore()
    const result = await createFlowStudioSurface(store)
    const workspace = currentWorkspace(store)
    const surface = currentSurface(store)
    const source = htmlBoardDocument(board(store)).html

    expect(result.created).toBe(true)
    expect(surface.rendererId).toBe('flow-clarification-v1')
    expect(surface.jobKind).toBe('compare')
    expect(surface.form.kind).toBe('flow-studio')
    expect(surface.formChoice.rationale).toContain('Compare')
    expect(surface.modes.map((mode) => mode.kind)).toEqual([
      'overview',
      'focus',
      'compare',
      'review'
    ])
    expect(surface.bindings.objectRefs.length).toBeGreaterThan(8)
    expect(workspace.objects[FLOW_STUDIO_IDS.sourceBlock]?.type).toBe('live-app-block')
    expect(
      workspace.objects[FLOW_STUDIO_IDS.sourceBlock]?.type === 'live-app-block'
        ? workspace.objects[FLOW_STUDIO_IDS.sourceBlock].runtime.status
        : null
    ).toBe('illustrative-preview')
    expect(source).toContain('Reusable Experience Setup')
    expect(source).toContain('Overview')
    expect(source).toContain('Focus')
    expect(source).toContain('Compare')
    expect(source).toContain('Review')
    expect(source).toContain('Illustrative preview')
    expect(source).toContain('Source unchanged')
    expect(source).toContain("connect-src 'none'")
  })

  test('persists preference, approval, reload, and exact reconstruction', async () => {
    const store = createEditorStore()
    await createFlowStudioSurface(store)

    const prefer = eventFor(store, 'flow-prefer-a', {
      action: 'prefer',
      recommendationId: 'option-calm-guided-flow'
    })
    expect((await applyFlowStudioEvent(store, prefer)).status).toBe('applied')
    expect((await applyFlowStudioEvent(store, prefer)).status).toBe('replayed')
    expect(currentSurface(store).recommendations[0]?.status).toBe('preferred')

    const stale = eventFor(store, 'flow-stale-preference', {
      action: 'prefer',
      recommendationId: 'option-compact-expert-flow'
    })
    stale.expected.artifactRevision -= 1
    expect((await applyFlowStudioEvent(store, stale)).status).toBe('rejected')
    expect(currentSurface(store).recommendations[0]?.status).toBe('preferred')

    const approval = eventFor(store, 'flow-approve-a', { action: 'approve' })
    const approved = await applyFlowStudioEvent(store, approval)
    expect(approved.status).toBe('applied')
    expect(currentSurface(store).status).toBe('decided')
    expect(htmlBoardDocument(board(store)).workflow.status).toBe('approved')

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reconstruction = reconstructFlowStudioReceipt(store, approved.receiptId ?? '')
    expect(reconstruction.receipt?.outcome.selectedRecommendationIds).toEqual([
      'option-calm-guided-flow'
    ])
    expect(reconstruction.receipt?.artifact).toEqual(reconstruction.surface.artifact)
    expect(reconstruction.surface.interactions.map((interaction) => interaction.action)).toEqual([
      'prefer',
      'approve'
    ])
  })
})
