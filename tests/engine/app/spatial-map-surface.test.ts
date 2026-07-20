import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import { applyInteractiveSurfaceEvent } from '@/app/interactive-surface'
import {
  OPENPENCIL_SPATIAL_MAP,
  SPATIAL_MAP_IDS,
  applySpatialMapEvent,
  createSpatialMapSurface,
  deriveSpatialMapModel,
  reconstructSpatialMapReceipt,
  spatialMapStateForBoard,
  type SpatialMapEventRequest
} from '@/app/spatial-map'
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
  if (!workspace) throw new Error('spatial map workspace missing')
  return workspace
}

function currentSurface(store: EditorStore) {
  const object = currentWorkspace(store).objects[SPATIAL_MAP_IDS.surface]
  if (object?.type !== 'surface-run') throw new Error('spatial map surface missing')
  return object
}

function board(store: EditorStore) {
  const node = store.graph.getNode(currentSurface(store).artifact.boardId)
  if (!node) throw new Error('spatial map board missing')
  return node
}

function eventFor(
  store: EditorStore,
  eventId: string,
  input: Omit<SpatialMapEventRequest, 'eventId' | 'expected' | 'surfaceRunId'>
): SpatialMapEventRequest {
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

describe('Spatial Map relationship answer form', () => {
  test('creates typed dependency objects and one canonical read-only lineage', async () => {
    const store = createEditorStore()
    const result = await createSpatialMapSurface(store)
    const workspace = currentWorkspace(store)
    const surface = currentSurface(store)
    const state = spatialMapStateForBoard(store, board(store))
    const source = htmlBoardDocument(board(store)).html
    const graphNodes = Object.values(workspace.objects).filter(
      (object) => object.type === 'graph-node' && object.graphId === SPATIAL_MAP_IDS.graph
    )
    const graphEdges = Object.values(workspace.objects).filter(
      (object) => object.type === 'graph-edge' && object.graphId === SPATIAL_MAP_IDS.graph
    )

    expect(result.created).toBe(true)
    expect(result.formRationale).toContain('Map')
    expect(surface.rendererId).toBe('spatial-map-v1')
    expect(surface.form.kind).toBe('spatial-map')
    expect(surface.jobKind).toBe('explain')
    expect(surface.capabilities).toEqual({
      externalWrites: false,
      networkAccess: false,
      sourceWrites: false
    })
    expect(surface.intent).toEqual({ objectId: SPATIAL_MAP_IDS.intent, revision: 1 })
    expect(surface.evidenceManifest).toEqual({
      objectId: SPATIAL_MAP_IDS.evidenceManifest,
      revision: 1
    })
    expect(graphNodes).toHaveLength(OPENPENCIL_SPATIAL_MAP.nodes.length)
    expect(graphEdges).toHaveLength(OPENPENCIL_SPATIAL_MAP.edges.length)
    expect(graphNodes.every((node) => node.permissions.canEdit === false)).toBe(true)
    expect(graphEdges.every((edge) => edge.permissions.canEdit === false)).toBe(true)
    expect(surface.bindings.objectRefs).toHaveLength(2 + graphNodes.length + graphEdges.length)
    expect(state?.model.criticalPathNodeIds).toEqual([
      'canonical-model',
      'evidence-boundary',
      'form-selection',
      'interactive-answer',
      'outcome-receipt',
      'durable-learning'
    ])
    expect(source).toContain('Relationship answer · Dependency map')
    expect(source).toContain('data-map-node="form-selection"')
    expect(source).toContain('Source unchanged')
    expect(source).toContain("connect-src 'none'")
  })

  test('rejects stale or unknown focus events without changing durable state', async () => {
    const store = createEditorStore()
    await createSpatialMapSurface(store)

    const stale = eventFor(store, 'map-stale-focus', {
      action: 'focus-node',
      nodeId: 'outcome-receipt'
    })
    stale.expected.artifactRevision -= 1
    expect((await applySpatialMapEvent(store, stale)).status).toBe('rejected')
    expect(currentSurface(store).interactions).toHaveLength(0)

    const unknown = eventFor(store, 'map-unknown-focus', {
      action: 'focus-node',
      nodeId: 'unknown-node'
    })
    expect((await applySpatialMapEvent(store, unknown)).status).toBe('rejected')
    expect(currentSurface(store).interactions).toHaveLength(0)

    const cyclic = structuredClone(OPENPENCIL_SPATIAL_MAP)
    cyclic.edges.push({
      confidence: 1,
      id: 'learning-back-to-intent',
      label: 'would hide a cycle',
      relationshipType: 'enables',
      sourceId: 'durable-learning',
      targetId: 'human-intent'
    })
    expect(() => deriveSpatialMapModel(cyclic)).toThrow('dependency maps must expose cycles')
  })

  test('correlates a forbidden bridge action while leaving the workspace unchanged', async () => {
    const store = createEditorStore()
    await createSpatialMapSurface(store)
    const workspaceRevision = currentWorkspace(store).revision

    const rejected = await applyInteractiveSurfaceEvent(store, board(store), {
      action: 'source-write',
      eventId: 'forged-source-write-1',
      surfaceRunId: currentSurface(store).id
    })

    expect(rejected.status).toBe('rejected')
    expect(rejected.eventId).toBe('forged-source-write-1')
    expect(rejected.error).toBe('Invalid spatial map event')
    expect(currentWorkspace(store).revision).toBe(workspaceRevision)
    expect(currentSurface(store).interactions).toHaveLength(0)
  })

  test('replays focus, approves, reloads, and reconstructs the exact map receipt', async () => {
    const store = createEditorStore()
    await createSpatialMapSurface(store)

    const focus = eventFor(store, 'map-focus-receipt', {
      action: 'focus-node',
      nodeId: 'outcome-receipt'
    })
    const focused = await applySpatialMapEvent(store, focus)
    expect(focused.status).toBe('applied')
    expect(focused.state?.model.focusedNodeId).toBe('outcome-receipt')
    expect((await applySpatialMapEvent(store, focus)).status).toBe('replayed')

    const approval = eventFor(store, 'map-approve-knowledge', {
      action: 'approve',
      note: 'This dependency model is the current shared explanation.'
    })
    const approved = await applySpatialMapEvent(store, approval)
    expect(approved.status).toBe('applied')
    expect(approved.receiptId).toBe('decision-receipt_map-approve-knowledge')
    expect(currentSurface(store).status).toBe('decided')
    expect(htmlBoardDocument(board(store)).workflow.status).toBe('approved')

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reconstruction = reconstructSpatialMapReceipt(store, approved.receiptId ?? '')
    expect(reconstruction.model.focusedNodeId).toBe('outcome-receipt')
    expect(reconstruction.receipt?.artifact).toEqual(reconstruction.surface.artifact)
    expect(reconstruction.receipt?.outcome.selectedRecommendationIds).toEqual([
      'record-spatial-map'
    ])
    expect(reconstruction.receipt?.corrections.map((interaction) => interaction.action)).toEqual([
      'adjust',
      'approve'
    ])
    expect(reconstruction.graphNodes.map((node) => node.id)).toEqual(
      OPENPENCIL_SPATIAL_MAP.nodes.map((node) => SPATIAL_MAP_IDS.nodes[node.id])
    )
    expect(reconstruction.graphEdges.map((edge) => edge.id)).toEqual(
      OPENPENCIL_SPATIAL_MAP.edges.map((edge) => SPATIAL_MAP_IDS.edges[edge.id])
    )
  })
})
