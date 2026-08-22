import type { SceneNode } from '@open-pencil/scene-graph'
import { mapAxisAlignedRect, rectIntersectionArea } from '@open-pencil/scene-graph/geometry'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'

import { isNarratedTraceCanvasInkNode } from './canvas-ink'
import type {
  NarratedTraceGestureCandidate,
  NarratedTraceSpatialAnchor,
  NarratedTraceTarget,
  NarratedTraceViewport
} from './types'

type NarratedTraceCoordinateStore = {
  screenToCanvas: (x: number, y: number) => Vector
  state: NarratedTraceViewport
}

type SceneTargetCandidate = {
  bounds: Rect
  depth: number
  node: SceneNode
  overlapArea: number
  owner: SceneNode
}

export type NarratedTraceSceneTargetResolution = {
  candidateCount: number
  candidates: NarratedTraceGestureCandidate[]
  candidatesTruncated: boolean
  target: NarratedTraceTarget | null
}

const MAX_GESTURE_CANDIDATES = 64

function screenRegionToCanvas(store: EditorStore, region: Rect): Rect {
  return mapAxisAlignedRect(region, store.screenToCanvas)
}

function viewportForStore(store: NarratedTraceCoordinateStore): NarratedTraceViewport {
  return {
    panX: store.state.panX,
    panY: store.state.panY,
    zoom: store.state.zoom
  }
}

function regionForPoints(points: Vector[], minimumSize: number): Rect {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  const width = Math.max(minimumSize, maxX - minX)
  const height = Math.max(minimumSize, maxY - minY)
  return {
    height,
    width,
    x: (minX + maxX) / 2 - width / 2,
    y: (minY + maxY) / 2 - height / 2
  }
}

function centerOfRegion(region: Rect): Vector {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2
  }
}

function relativePoint(point: Vector, bounds: Rect | undefined): Vector | undefined {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return undefined
  return {
    x: (point.x - bounds.x) / bounds.width,
    y: (point.y - bounds.y) / bounds.height
  }
}

export function narratedTraceAnchorForScreenPoints(
  store: NarratedTraceCoordinateStore,
  screenPoints: Vector[],
  targetScreenBounds?: Rect
): NarratedTraceSpatialAnchor | undefined {
  if (screenPoints.length === 0) return undefined
  const pagePoints = screenPoints.map((point) => store.screenToCanvas(point.x, point.y))
  const pageRegion = regionForPoints(pagePoints, 1 / Math.max(store.state.zoom, 0.01))
  const screenRegion = regionForPoints(screenPoints, 1)
  const targetRelativePoint = relativePoint(centerOfRegion(screenRegion), targetScreenBounds)
  return {
    pagePoint: centerOfRegion(pageRegion),
    pageRegion,
    ...(targetRelativePoint ? { targetRelativePoint } : {}),
    viewport: viewportForStore(store)
  }
}

export function narratedTraceAnchorForCanvasPoint(
  store: NarratedTraceCoordinateStore,
  pagePoint: Vector,
  targetPageBounds?: Rect
): NarratedTraceSpatialAnchor {
  const size = 1 / Math.max(store.state.zoom, 0.01)
  const targetRelativePoint = relativePoint(pagePoint, targetPageBounds)
  return {
    pagePoint: { ...pagePoint },
    pageRegion: {
      height: size,
      width: size,
      x: pagePoint.x - size / 2,
      y: pagePoint.y - size / 2
    },
    ...(targetRelativePoint ? { targetRelativePoint } : {}),
    viewport: viewportForStore(store)
  }
}

function canvasBoundsToScreen(store: EditorStore, bounds: Rect): Rect {
  return {
    height: bounds.height * store.state.zoom,
    width: bounds.width * store.state.zoom,
    x: bounds.x * store.state.zoom + store.state.panX,
    y: bounds.y * store.state.zoom + store.state.panY
  }
}

function sceneNodePath(store: EditorStore, node: SceneNode) {
  const path: string[] = []
  let current: SceneNode | undefined = node
  let depth = 0
  while (current && depth < 32) {
    path.unshift(current.name || current.type)
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
    depth += 1
  }
  return path
}

function pageOwnedOwner(store: EditorStore, node: SceneNode): SceneNode | undefined {
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  for (let depth = 0; current && depth < 32; depth++) {
    if (visited.has(current.id)) return undefined
    visited.add(current.id)
    if (current.parentId === store.state.currentPageId) return current
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return undefined
}

function candidateScore(candidate: SceneTargetCandidate, regionArea: number) {
  const nodeArea = Math.max(1, candidate.bounds.width * candidate.bounds.height)
  const sizeDistance = Math.abs(Math.log(nodeArea / Math.max(1, regionArea)))
  return sizeDistance - candidate.depth * 0.015
}

function containsRect(container: Rect, contained: Rect) {
  return (
    contained.x >= container.x &&
    contained.y >= container.y &&
    contained.x + contained.width <= container.x + container.width &&
    contained.y + contained.height <= container.y + container.height
  )
}

function candidateRelation(
  canvasRegion: Rect,
  candidateBounds: Rect
): NarratedTraceGestureCandidate['relation'] {
  if (containsRect(canvasRegion, candidateBounds)) return 'contained'
  if (containsRect(candidateBounds, canvasRegion)) return 'contains-region'
  return 'intersecting'
}

function gestureCandidate(
  candidate: SceneTargetCandidate,
  canvasRegion: Rect,
  regionArea: number
): NarratedTraceGestureCandidate {
  const objectArea = Math.max(1, candidate.bounds.width * candidate.bounds.height)
  return {
    bounds: structuredClone(candidate.bounds),
    depth: candidate.depth,
    name: candidate.node.name || candidate.node.type,
    nodeType: candidate.node.type,
    objectCoverageRatio: candidate.overlapArea / objectArea,
    ownerId: candidate.owner.id,
    path: [],
    regionCoverageRatio: candidate.overlapArea / regionArea,
    relation: candidateRelation(canvasRegion, candidate.bounds),
    route: candidate.node.pluginData.find((entry) => entry.key === 'route')?.value,
    stableId: candidate.node.id
  }
}

function primarySceneTarget(candidates: SceneTargetCandidate[], canvasRegion: Rect) {
  const regionArea = Math.max(1, canvasRegion.width * canvasRegion.height)
  const center = {
    x: canvasRegion.x + canvasRegion.width / 2,
    y: canvasRegion.y + canvasRegion.height / 2
  }
  const regionMatches = candidates.filter((candidate) => {
    const bounds = candidate.bounds
    const containsCenter =
      center.x >= bounds.x &&
      center.y >= bounds.y &&
      center.x <= bounds.x + bounds.width &&
      center.y <= bounds.y + bounds.height
    return containsCenter && candidate.overlapArea / regionArea >= 0.55
  })
  return (
    regionMatches.sort(
      (left, right) => candidateScore(left, regionArea) - candidateScore(right, regionArea)
    )[0] ??
    candidates.sort(
      (left, right) =>
        right.overlapArea / regionArea - left.overlapArea / regionArea || right.depth - left.depth
    )[0]
  )
}

function narratedTraceTargetForCandidate(
  store: EditorStore,
  candidate: SceneTargetCandidate
): NarratedTraceTarget {
  return {
    bounds: canvasBoundsToScreen(store, candidate.bounds),
    name: candidate.node.name || candidate.node.type,
    path: sceneNodePath(store, candidate.node),
    route: candidate.node.pluginData.find((entry) => entry.key === 'route')?.value,
    stableId: candidate.node.id
  }
}

/**
 * Resolve a focus gesture to the native node whose visible bounds best match the
 * highlighted region. This keeps "this/here" grounded in a stable scene node ID.
 */
export function resolveNarratedTraceSceneTargets(
  store: EditorStore,
  screenRegion: Rect
): NarratedTraceSceneTargetResolution {
  const canvasRegion = screenRegionToCanvas(store, screenRegion)
  const regionArea = Math.max(1, canvasRegion.width * canvasRegion.height)
  const candidates = store.graph
    .flattenTree(store.state.currentPageId)
    .flatMap<SceneTargetCandidate>(({ depth, node }) => {
      if (
        !node.visible ||
        node.width <= 0 ||
        node.height <= 0 ||
        isNarratedTraceCanvasInkNode(node)
      ) {
        return []
      }
      const owner = pageOwnedOwner(store, node)
      if (!owner) return []
      const bounds = store.graph.getAbsoluteBounds(node.id)
      const overlapArea = rectIntersectionArea(bounds, canvasRegion)
      return overlapArea > 0 ? [{ bounds, depth, node, overlapArea, owner }] : []
    })
  if (candidates.length === 0) {
    return { candidateCount: 0, candidates: [], candidatesTruncated: false, target: null }
  }
  const primary = primarySceneTarget(candidates, canvasRegion)
  const ordered = [
    primary,
    ...candidates
      .filter((candidate) => candidate.node.id !== primary.node.id)
      .sort(
        (left, right) =>
          right.overlapArea / regionArea - left.overlapArea / regionArea ||
          right.depth - left.depth ||
          left.node.id.localeCompare(right.node.id)
      )
  ]
  const bounded = ordered.slice(0, MAX_GESTURE_CANDIDATES).map((candidate) => ({
    ...gestureCandidate(candidate, canvasRegion, regionArea),
    path: sceneNodePath(store, candidate.node)
  }))
  return {
    candidateCount: ordered.length,
    candidates: bounded,
    candidatesTruncated: ordered.length > bounded.length,
    target: narratedTraceTargetForCandidate(store, primary)
  }
}

export function findNarratedTraceSceneTarget(
  store: EditorStore,
  screenRegion: Rect
): NarratedTraceTarget | null {
  return resolveNarratedTraceSceneTargets(store, screenRegion).target
}
