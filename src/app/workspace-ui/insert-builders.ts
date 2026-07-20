import type { SceneNode } from '@open-pencil/scene-graph'

import { liveInspectorDocument } from '@/app/smylr-live-inspector/session'
import { smylrLiveAppFrameRoute } from '@/app/smylr-production/workspace'
import {
  createCollection,
  createDesignArtifact,
  createDocumentBlock,
  createGraphNode,
  createLiveAppBlock,
  createSavedView,
  createWorkspaceId,
  type KnowledgeWorkspace,
  type WorkspaceObject,
  type WorkspaceOperation,
  type WorkspaceProjection,
  type WorkspaceView
} from '@/app/workspace'
import { IS_BROWSER } from '@/constants'

import { runtimeStatusForFrame, selectedDesignNode, smylrPluginValue } from './helpers'
import type { WorkspaceInsertKind, WorkspaceInsertOptions, WorkspaceUiState } from './types'

export type InsertBuildInput = {
  context: Parameters<typeof createDocumentBlock>[0]
  kind: WorkspaceInsertKind
  options: WorkspaceInsertOptions
  ordinal: number
  projections: Record<string, WorkspaceProjection>
  state: WorkspaceUiState
  view: WorkspaceView
  workspace: KnowledgeWorkspace
}

export type InsertBuildResult = {
  extraOperations: WorkspaceOperation[]
  object: WorkspaceObject
}

function documentBlockKind(kind: WorkspaceInsertKind): 'heading' | 'paragraph' | 'task' {
  if (kind === 'heading') return 'heading'
  if (kind === 'task') return 'task'
  return 'paragraph'
}

function documentBlockText(kind: WorkspaceInsertKind): string {
  if (kind === 'heading') return 'New heading'
  if (kind === 'task') return 'New task'
  return 'Start writing…'
}

function buildDocumentBlock(input: InsertBuildInput): InsertBuildResult {
  const blockKind = documentBlockKind(input.kind)
  return {
    extraOperations: [],
    object: createDocumentBlock(input.context, {
      blockKind,
      checked: blockKind === 'task' ? false : undefined,
      order: input.ordinal,
      projections: input.projections,
      text: documentBlockText(input.kind)
    })
  }
}

function buildCollection(input: InsertBuildInput): InsertBuildResult {
  const collection = createCollection(input.context, {
    name: 'New collection',
    projections: input.projections,
    properties: [
      { id: createWorkspaceId('collection'), label: 'Name', required: true, type: 'text' },
      { id: createWorkspaceId('collection'), label: 'Status', type: 'status' }
    ]
  })
  const savedView = createSavedView(input.context, {
    collectionId: collection.id,
    name: 'All records',
    viewKind: 'table',
    visiblePropertyIds: collection.properties.map((property) => property.id)
  })
  return {
    extraOperations: [{ object: savedView, type: 'create-object' }],
    object: collection
  }
}

function buildGraphNode(input: InsertBuildInput): InsertBuildResult {
  return {
    extraOperations: [],
    object: createGraphNode(input.context, {
      graphId: `${input.workspace.id}:primary-graph`,
      graphKind: 'mind-map',
      label: 'New idea',
      projections: input.projections
    })
  }
}

function buildDesignArtifact(input: InsertBuildInput): InsertBuildResult | null {
  const selected = selectedDesignNode(input.state.store)
  if (!selected) return null
  return {
    extraOperations: [],
    object: createDesignArtifact(input.context, {
      artifactKind: selected.type === 'INSTANCE' ? 'instance' : 'mockup',
      label: selected.name || 'Design artifact',
      ownership: 'workspace',
      projections: input.projections,
      sourceRef: `scene:${selected.id}`
    })
  }
}

function sourceRevisionForFrame(frame: SceneNode): string {
  const sourceRevision = smylrPluginValue(frame, 'sourceRevision')
  if (sourceRevision) return sourceRevision
  if (liveInspectorDocument.value) {
    return `runtime:${liveInspectorDocument.value.capturedAt}`
  }
  return 'production'
}

function liveProjections(
  input: InsertBuildInput,
  frame: SceneNode,
  canvasView: WorkspaceView
): Record<string, WorkspaceProjection> {
  const frameGeometry = {
    height: frame.height,
    rotation: frame.rotation,
    width: frame.width,
    x: frame.x,
    y: frame.y
  }
  const projections: Record<string, WorkspaceProjection> = {
    [canvasView.id]: { geometry: frameGeometry }
  }
  if (input.view.id !== canvasView.id) Object.assign(projections, input.projections)
  return projections
}

function buildLiveAppBlock(
  input: InsertBuildInput,
  canvasView: WorkspaceView
): InsertBuildResult | null {
  const frame = input.options.liveFrame
  if (!frame) return null
  const runtime = runtimeStatusForFrame(frame)
  const object = createLiveAppBlock(input.context, {
    applicationId: 'smylr-production',
    environment: IS_BROWSER ? window.location.origin : 'local-runtime',
    liveContainerRootId: liveInspectorDocument.value?.tree.id,
    projections: liveProjections(input, frame, canvasView),
    route: smylrLiveAppFrameRoute(frame),
    runtime,
    sourceRevision: sourceRevisionForFrame(frame),
    viewport: { height: frame.height, width: frame.width }
  })
  const extraOperations: WorkspaceOperation[] = []
  if (runtime.status === 'live' && runtime.lastHandshakeAt) {
    extraOperations.push({
      blockId: object.id,
      handshakeAt: runtime.lastHandshakeAt,
      type: 'set-runtime-owner'
    })
  }
  return { extraOperations, object }
}

export function buildInsertCandidate(
  input: InsertBuildInput,
  canvasView: WorkspaceView
): InsertBuildResult | null {
  switch (input.kind) {
    case 'heading':
    case 'paragraph':
    case 'task':
      return buildDocumentBlock(input)
    case 'collection':
      return buildCollection(input)
    case 'graph-node':
      return buildGraphNode(input)
    case 'design-artifact':
      return buildDesignArtifact(input)
    case 'live-app-block':
      return buildLiveAppBlock(input, canvasView)
  }
  return null
}
