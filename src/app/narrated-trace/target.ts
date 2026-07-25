import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'

import { isNarratedTraceCanvasInkNode } from './canvas-ink'
import type {
  NarratedTraceSpatialAnchor,
  NarratedTraceTarget,
  NarratedTraceViewport
} from './types'

export type NarratedTraceLiveTargetHit = {
  node: SmylrLiveContainerNode
  path: string[]
  rect: Rect
}

type NarratedTraceCoordinateStore = {
  screenToCanvas: (x: number, y: number) => Vector
  state: NarratedTraceViewport
}

function containsPoint(rect: Rect, x: number, y: number) {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height
}

function containsRect(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function liveTargetAtRegion(
  node: SmylrLiveContainerNode,
  region: Rect,
  requireFullContainment: boolean,
  path: string[] = [],
  offsetX = 0,
  offsetY = 0
): NarratedTraceLiveTargetHit | null {
  const rect = {
    height: node.rect.height,
    width: node.rect.width,
    x: offsetX + node.rect.x,
    y: offsetY + node.rect.y
  }
  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2
  const matches = requireFullContainment
    ? containsRect(rect, region)
    : containsPoint(rect, centerX, centerY)
  if (!matches) return null

  const nextPath = [...path, node.label]
  for (const child of [...(node.children ?? [])].reverse()) {
    const hit = liveTargetAtRegion(child, region, requireFullContainment, nextPath, rect.x, rect.y)
    if (hit) return hit
  }
  return { node, path: nextPath, rect }
}

/** Prefer the smallest live container enclosing the focus area, then the deepest point hit. */
export function findNarratedTraceLiveTarget(
  tree: SmylrLiveContainerNode | undefined,
  region: Rect
): NarratedTraceLiveTargetHit | null {
  if (!tree) return null
  return liveTargetAtRegion(tree, region, true) ?? liveTargetAtRegion(tree, region, false)
}

type SceneTargetCandidate = {
  bounds: Rect
  depth: number
  node: SceneNode
  overlapArea: number
}

function intersectionArea(first: Rect, second: Rect) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  )
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  )
  return width * height
}

function screenRegionToCanvas(store: EditorStore, region: Rect): Rect {
  const topLeft = store.screenToCanvas(region.x, region.y)
  const bottomRight = store.screenToCanvas(region.x + region.width, region.y + region.height)
  return {
    height: Math.abs(bottomRight.y - topLeft.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y)
  }
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

function candidateScore(candidate: SceneTargetCandidate, regionArea: number) {
  const nodeArea = Math.max(1, candidate.bounds.width * candidate.bounds.height)
  const sizeDistance = Math.abs(Math.log(nodeArea / Math.max(1, regionArea)))
  return sizeDistance - candidate.depth * 0.015
}

/**
 * Resolve a focus gesture to the native node whose visible bounds best match the
 * highlighted region. This keeps "this/here" grounded in a stable scene node ID.
 */
export function findNarratedTraceSceneTarget(
  store: EditorStore,
  screenRegion: Rect
): NarratedTraceTarget | null {
  const canvasRegion = screenRegionToCanvas(store, screenRegion)
  const regionArea = Math.max(1, canvasRegion.width * canvasRegion.height)
  const center = {
    x: canvasRegion.x + canvasRegion.width / 2,
    y: canvasRegion.y + canvasRegion.height / 2
  }
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
      const bounds = store.graph.getAbsoluteBounds(node.id)
      const overlapArea = intersectionArea(bounds, canvasRegion)
      return overlapArea > 0 ? [{ bounds, depth, node, overlapArea }] : []
    })
  if (candidates.length === 0) return null

  const regionMatches = candidates.filter((candidate) => {
    const bounds = candidate.bounds
    const containsCenter =
      center.x >= bounds.x &&
      center.y >= bounds.y &&
      center.x <= bounds.x + bounds.width &&
      center.y <= bounds.y + bounds.height
    return containsCenter && candidate.overlapArea / regionArea >= 0.55
  })
  const target =
    regionMatches.sort(
      (left, right) => candidateScore(left, regionArea) - candidateScore(right, regionArea)
    )[0] ??
    candidates.sort(
      (left, right) =>
        right.overlapArea / regionArea - left.overlapArea / regionArea || right.depth - left.depth
    )[0]
  return {
    bounds: canvasBoundsToScreen(store, target.bounds),
    name: target.node.name || target.node.type,
    path: sceneNodePath(store, target.node),
    route: target.node.pluginData.find((entry) => entry.key === 'route')?.value,
    stableId: target.node.id
  }
}
