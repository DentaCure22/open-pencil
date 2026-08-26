import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { getWorldMatrix, TransformMatrix } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { codeObjectDocument } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { resolveNarratedTraceSceneTargets } from '@/app/narrated-trace'
import { spatialMediaSource } from '@/app/spatial-media/source'

import type { ContextCommentAnnotationSelector, ContextCommentDraft } from '../types'

export type SceneTargetResolution = ReturnType<typeof resolveNarratedTraceSceneTargets>

export type ContextCommentSceneTarget = {
  boardSelector: ContextCommentAnnotationSelector | null
  clientPoint: Vector
  hit: SceneNode | null
  owner: SceneNode | null
  pagePoint: Vector
  relativeSelector: ContextCommentAnnotationSelector | null
  resolution: SceneTargetResolution
}

function containsPoint(bounds: Rect | undefined, point: Vector) {
  return Boolean(
    bounds &&
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x <= bounds.x + bounds.width &&
    point.y <= bounds.y + bounds.height
  )
}

function pluginValue(node: SceneNode, key: string) {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

function nodeAncestry(store: EditorStore, node: SceneNode) {
  const ancestry: SceneNode[] = []
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && ancestry.length < 32 && !visited.has(current.id)) {
    visited.add(current.id)
    ancestry.push(current)
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return ancestry
}

function localPointForNode(store: EditorStore, node: SceneNode, pagePoint: Vector) {
  const inverse = TransformMatrix.invert(getWorldMatrix(node, store.graph))
  return inverse ? TransformMatrix.mapPoint(inverse, pagePoint) : null
}

function pointIsInsideNode(store: EditorStore, node: SceneNode, pagePoint: Vector) {
  const localPoint = localPointForNode(store, node, pagePoint)
  return Boolean(
    localPoint &&
    node.width > 0 &&
    node.height > 0 &&
    localPoint.x >= 0 &&
    localPoint.y >= 0 &&
    localPoint.x <= node.width &&
    localPoint.y <= node.height
  )
}

function annotationOwner(store: EditorStore, hit: SceneNode) {
  return (
    nodeAncestry(store, hit).find(
      (node) =>
        codeObjectDocument(node) !== null ||
        mediaEvidenceSource(node) !== null ||
        spatialMediaSource(node) !== null ||
        pluginValue(node, 'mermaid/diagram-id') !== null ||
        readContentSource(node) !== null
    ) ?? hit
  )
}

function selectedHit(store: EditorStore, pagePoint: Vector) {
  for (const id of store.state.selectedIds) {
    const node = store.graph.getNode(id)
    if (node && pointIsInsideNode(store, node, pagePoint)) return node
  }
  return null
}

function boardSelector(
  draft: ContextCommentDraft,
  pagePoint: Vector
): ContextCommentAnnotationSelector | null {
  const captureContext = draft.captureContext
  if (!captureContext) return null
  const size = 1 / Math.max(captureContext.viewport.zoom, 0.01)
  return {
    kind: 'board-position',
    point: pagePoint,
    region: {
      height: size,
      width: size,
      x: pagePoint.x - size / 2,
      y: pagePoint.y - size / 2
    },
    viewport: { ...captureContext.viewport }
  }
}

function nodeRelativeSelector(
  store: EditorStore,
  node: SceneNode,
  pagePoint: Vector
): ContextCommentAnnotationSelector | null {
  const localPoint = localPointForNode(store, node, pagePoint)
  if (!localPoint || node.width <= 0 || node.height <= 0) return null
  return {
    bounds: store.graph.getAbsoluteBounds(node.id),
    kind: 'node-relative',
    localPoint,
    nodeId: node.id,
    normalizedPoint: {
      x: localPoint.x / node.width,
      y: localPoint.y / node.height
    }
  }
}

function liveFrameAtPoint(store: EditorStore, draft: ContextCommentDraft, pagePoint: Vector) {
  if (draft.target?.kind !== 'live-container') return null
  if (!containsPoint(draft.target.bounds, pagePoint) || !draft.target.frameId) return null
  return store.graph.getNode(draft.target.frameId) ?? null
}

export function resolveContextCommentSceneTarget(
  store: EditorStore,
  draft: ContextCommentDraft,
  normalizedPoint: Vector
): ContextCommentSceneTarget {
  const captureContext = draft.captureContext
  if (!captureContext) throw new Error('context_comment_capture_context_required')

  const pagePoint = {
    x: captureContext.boardBounds.x + normalizedPoint.x * captureContext.boardBounds.width,
    y: captureContext.boardBounds.y + normalizedPoint.y * captureContext.boardBounds.height
  }
  const screenPoint = {
    x: captureContext.screenBounds.x + normalizedPoint.x * captureContext.screenBounds.width,
    y: captureContext.screenBounds.y + normalizedPoint.y * captureContext.screenBounds.height
  }
  const clientPoint = {
    x: (draft.captureSource?.canvasBounds.x ?? 0) + screenPoint.x,
    y: (draft.captureSource?.canvasBounds.y ?? 0) + screenPoint.y
  }
  const resolution = resolveNarratedTraceSceneTargets(store, {
    height: 1,
    width: 1,
    x: screenPoint.x - 0.5,
    y: screenPoint.y - 0.5
  })
  const liveFrame = liveFrameAtPoint(store, draft, pagePoint)
  const selected = selectedHit(store, pagePoint)
  const resolved = resolution.target
    ? (store.graph.getNode(resolution.target.stableId) ?? null)
    : null
  const hit = liveFrame ?? selected ?? resolved
  const owner = hit ? annotationOwner(store, hit) : null

  return {
    boardSelector: boardSelector(draft, pagePoint),
    clientPoint,
    hit,
    owner,
    pagePoint,
    relativeSelector: owner ? nodeRelativeSelector(store, owner, pagePoint) : null,
    resolution
  }
}
