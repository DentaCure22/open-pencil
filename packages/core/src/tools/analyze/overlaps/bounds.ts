import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { getAuthoritativeWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import {
  clipPolygon,
  effectOverflow,
  geometryBlobBounds,
  strokeOverflow,
  unionVisualBounds,
  type VisualBounds
} from '@open-pencil/scene-graph/geometry'
import Matrix from '@open-pencil/scene-graph/matrix'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

const EMPTY_BOUNDS: VisualBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 }

export function visualBoundsArea(bounds: VisualBounds): number {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  return width > 0 && height > 0 ? width * height : 0
}

export function boundsToRect(bounds: VisualBounds): Rect {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  }
}

function pointsToBounds(points: number[]): VisualBounds {
  return aabbFromCorners([
    { x: points[0], y: points[1] },
    { x: points[2], y: points[3] },
    { x: points[4], y: points[5] },
    { x: points[6], y: points[7] }
  ])
}

function nodeWorldCorners(node: SceneNode, graph: SceneGraph): Vector[] {
  const matrix = getAuthoritativeWorldMatrix(node, graph)
  const points = Matrix.mapPoints(matrix, [
    0,
    0,
    node.width,
    0,
    node.width,
    node.height,
    0,
    node.height
  ])
  return [
    { x: points[0], y: points[1] },
    { x: points[2], y: points[3] },
    { x: points[4], y: points[5] },
    { x: points[6], y: points[7] }
  ]
}

function aabbFromCorners(corners: Vector[]): VisualBounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x
    if (corner.y < minY) minY = corner.y
    if (corner.x > maxX) maxX = corner.x
    if (corner.y > maxY) maxY = corner.y
  }
  return { minX, minY, maxX, maxY }
}

function computeNodeVisualBounds(node: SceneNode, graph: SceneGraph): VisualBounds {
  const matrix = getAuthoritativeWorldMatrix(node, graph)
  const stroke = strokeOverflow(node.strokes)
  let bounds = pointsToBounds(
    Matrix.mapPoints(matrix, [
      -stroke,
      -stroke,
      node.width + stroke,
      -stroke,
      node.width + stroke,
      node.height + stroke,
      -stroke,
      node.height + stroke
    ])
  )

  const effects = effectOverflow(node.effects)
  bounds.minX -= effects.left
  bounds.minY -= effects.top
  bounds.maxX += effects.right
  bounds.maxY += effects.bottom

  const hasNonInsideStroke = node.strokes.some(
    (candidate) => candidate.visible && candidate.align !== 'INSIDE'
  )
  const localGeometry = geometryBlobBounds([
    ...node.fillGeometry,
    ...(hasNonInsideStroke ? node.strokeGeometry : [])
  ])
  if (localGeometry) {
    const geometryBounds = pointsToBounds(
      Matrix.mapPoints(matrix, [
        localGeometry.x,
        localGeometry.y,
        localGeometry.x + localGeometry.width,
        localGeometry.y,
        localGeometry.x + localGeometry.width,
        localGeometry.y + localGeometry.height,
        localGeometry.x,
        localGeometry.y + localGeometry.height
      ])
    )
    bounds = unionVisualBounds(bounds, geometryBounds) ?? bounds
  }

  if (node.type === 'TEXT' && node.textDecoration !== 'NONE') {
    const fontSize = node.fontSize
    const underlineOffset = node.textUnderlineOffset ?? fontSize * 0.18
    const thickness = node.textDecorationThickness ?? Math.max(1, fontSize / 16)
    bounds.maxY += underlineOffset + thickness + fontSize * 0.35
  }

  return bounds
}

function collectClipChain(graph: SceneGraph, node: SceneNode): Vector[][] {
  const clips: Vector[][] = []
  let currentId = node.parentId
  while (currentId) {
    const current = graph.getNode(currentId)
    if (!current || current.type === 'CANVAS') break
    if (
      current.clipsContent &&
      (current.type === 'FRAME' || current.type === 'COMPONENT' || current.type === 'INSTANCE')
    ) {
      clips.push(nodeWorldCorners(current, graph))
    }
    currentId = current.parentId
  }
  return clips
}

export function computeNodeBounds(
  node: SceneNode,
  graph: SceneGraph
): { bounds: VisualBounds; area: number } {
  const visual = computeNodeVisualBounds(node, graph)
  const clips = collectClipChain(graph, node)
  if (clips.length === 0) return { bounds: visual, area: visualBoundsArea(visual) }

  let polygon: Vector[] | null = [
    { x: visual.minX, y: visual.minY },
    { x: visual.maxX, y: visual.minY },
    { x: visual.maxX, y: visual.maxY },
    { x: visual.minX, y: visual.maxY }
  ]
  for (const clip of clips) {
    polygon = clipPolygon(polygon, clip)
    if (!polygon) return { bounds: EMPTY_BOUNDS, area: 0 }
  }
  const bounds = aabbFromCorners(polygon)
  return { bounds, area: visualBoundsArea(bounds) }
}

export type BoundsEntry = { node: SceneNode; bounds: VisualBounds; area: number }
