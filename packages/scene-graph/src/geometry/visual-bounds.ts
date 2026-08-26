import type { Rect, Vector } from '../primitives'
import type { Effect, Stroke } from '../types'
import { degToRad, rotatePoint, rotatedBBox } from './transforms'

export interface VisualBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type BoundsAccumulator = VisualBounds

function createBoundsAccumulator(): BoundsAccumulator {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
}

function includePoint(bounds: BoundsAccumulator, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x)
  bounds.minY = Math.min(bounds.minY, y)
  bounds.maxX = Math.max(bounds.maxX, x)
  bounds.maxY = Math.max(bounds.maxY, y)
}

function includeRect(bounds: BoundsAccumulator, rect: Rect): void {
  includePoint(bounds, rect.x, rect.y)
  includePoint(bounds, rect.x + rect.width, rect.y + rect.height)
}

function boundsToRect(bounds: BoundsAccumulator): Rect {
  return bounds.minX === Infinity
    ? { x: 0, y: 0, width: 0, height: 0 }
    : {
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY
      }
}

export function computeBounds(items: Iterable<Rect>): Rect {
  const bounds = createBoundsAccumulator()
  for (const item of items) includeRect(bounds, item)
  return boundsToRect(bounds)
}

export function mapAxisAlignedRect(rect: Rect, mapPoint: (x: number, y: number) => Vector): Rect {
  const first = mapPoint(rect.x, rect.y)
  const second = mapPoint(rect.x + rect.width, rect.y + rect.height)
  return {
    height: Math.abs(second.y - first.y),
    width: Math.abs(second.x - first.x),
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y)
  }
}

export function rectIntersectionArea(first: Rect, second: Rect): number {
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

export function rectsIntersect(first: Rect, second: Rect): boolean {
  return rectIntersectionArea(first, second) > 0
}

export function rectIntersectionRatio(first: Rect, second: Rect): number {
  const intersectionArea = rectIntersectionArea(first, second)
  if (intersectionArea === 0) return 0
  const smallerArea = Math.min(first.width * first.height, second.width * second.height)
  return smallerArea > 0 ? intersectionArea / smallerArea : 0
}

export function strokeOverflow(strokes?: Stroke[]): number {
  let overflow = 0
  for (const stroke of strokes ?? []) {
    if (!stroke.visible) continue
    let extra = 0
    if (stroke.align === 'OUTSIDE') extra = stroke.weight
    else if (stroke.align === 'CENTER') extra = stroke.weight / 2
    overflow = Math.max(overflow, extra)
  }
  return overflow
}

export function effectOverflow(effects?: Effect[]) {
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0

  for (const effect of effects ?? []) {
    if (!effect.visible) continue
    if (
      effect.type !== 'DROP_SHADOW' &&
      effect.type !== 'LAYER_BLUR' &&
      effect.type !== 'FOREGROUND_BLUR'
    ) {
      continue
    }
    const blurSpread = effect.radius + effect.spread
    left = Math.max(left, blurSpread + Math.max(0, -effect.offset.x))
    right = Math.max(right, blurSpread + Math.max(0, effect.offset.x))
    top = Math.max(top, blurSpread + Math.max(0, -effect.offset.y))
    bottom = Math.max(bottom, blurSpread + Math.max(0, effect.offset.y))
  }

  return { left, right, top, bottom }
}

export function computeAbsoluteBounds(
  nodes: Iterable<{ id: string; width: number; height: number }>,
  getAbsolutePosition: (id: string) => Vector
): Rect {
  const bounds = createBoundsAccumulator()
  for (const node of nodes) {
    const absolutePosition = getAbsolutePosition(node.id)
    includeRect(bounds, {
      x: absolutePosition.x,
      y: absolutePosition.y,
      width: node.width,
      height: node.height
    })
  }
  return boundsToRect(bounds)
}

export function computeVisualBounds(
  nodes: Iterable<{
    id: string
    width: number
    height: number
    rotation?: number
    strokes?: Stroke[]
    effects?: Effect[]
  }>,
  getAbsolutePosition: (id: string) => Vector
): Rect {
  const bounds = createBoundsAccumulator()

  for (const node of nodes) {
    const absolutePosition = getAbsolutePosition(node.id)
    const bbox = rotatedBBox(
      absolutePosition.x,
      absolutePosition.y,
      node.width,
      node.height,
      node.rotation ?? 0
    )
    const stroke = strokeOverflow(node.strokes)
    const effects = effectOverflow(node.effects)
    includePoint(bounds, bbox.left - stroke - effects.left, bbox.top - stroke - effects.top)
    includePoint(bounds, bbox.right + stroke + effects.right, bbox.bottom + stroke + effects.bottom)
  }

  return boundsToRect(bounds)
}

export interface VisualBoundsNode {
  id: string
  width: number
  height: number
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  strokes?: Stroke[]
  effects?: Effect[]
  fillGeometry?: Array<{ commandsBlob: Uint8Array }>
  strokeGeometry?: Array<{ commandsBlob: Uint8Array }>
  childIds?: string[]
  visible?: boolean
  type?: string
  clipsContent?: boolean
  fontSize?: number
  textDecoration?: string
  textUnderlineOffset?: number | null
  textDecorationThickness?: number | null
}

export function unionVisualBounds(
  first: VisualBounds | null,
  second: VisualBounds | null
): VisualBounds | null {
  if (!first) return second
  if (!second) return first
  return {
    minX: Math.min(first.minX, second.minX),
    minY: Math.min(first.minY, second.minY),
    maxX: Math.max(first.maxX, second.maxX),
    maxY: Math.max(first.maxY, second.maxY)
  }
}

export function intersectVisualBounds(
  first: VisualBounds,
  second: VisualBounds
): VisualBounds | null {
  const minX = Math.max(first.minX, second.minX)
  const minY = Math.max(first.minY, second.minY)
  const maxX = Math.min(first.maxX, second.maxX)
  const maxY = Math.min(first.maxY, second.maxY)
  return minX < maxX && minY < maxY ? { minX, minY, maxX, maxY } : null
}

function geometryCommandCoordCount(command: number): number | null {
  if (command === 0) return 0
  if (command === 1 || command === 2) return 1
  if (command === 4) return 3
  return null
}

export function geometryBlobBounds(paths: Array<{ commandsBlob: Uint8Array }>): Rect | null {
  const bounds = createBoundsAccumulator()

  for (const path of paths) {
    const blob = path.commandsBlob
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
    let offset = 0
    while (offset < blob.length) {
      const command = blob[offset++]
      const coordinates = geometryCommandCoordCount(command)
      if (coordinates == null) break
      for (let index = 0; index < coordinates; index++) {
        if (offset + 8 > blob.length) break
        includePoint(bounds, view.getFloat32(offset, true), view.getFloat32(offset + 4, true))
        offset += 8
      }
    }
  }

  return bounds.minX === Infinity ? null : boundsToRect(bounds)
}

function transformLocalPoint(node: VisualBoundsNode, point: Vector): Vector {
  let x = node.flipX ? node.width - point.x : point.x
  let y = node.flipY ? node.height - point.y : point.y
  const rotation = node.rotation ?? 0
  if (rotation !== 0) {
    const rotated = rotatePoint(x, y, node.width / 2, node.height / 2, degToRad(rotation))
    x = rotated.x
    y = rotated.y
  }
  return { x, y }
}

function transformedLocalBounds(
  node: VisualBoundsNode,
  local: Rect,
  absolutePosition: Vector
): VisualBounds {
  const points = [
    { x: local.x, y: local.y },
    { x: local.x + local.width, y: local.y },
    { x: local.x + local.width, y: local.y + local.height },
    { x: local.x, y: local.y + local.height }
  ].map((point) => transformLocalPoint(node, point))

  return {
    minX: absolutePosition.x + Math.min(...points.map((point) => point.x)),
    minY: absolutePosition.y + Math.min(...points.map((point) => point.y)),
    maxX: absolutePosition.x + Math.max(...points.map((point) => point.x)),
    maxY: absolutePosition.y + Math.max(...points.map((point) => point.y))
  }
}

export function nodeVisualBounds(
  node: VisualBoundsNode,
  getAbsolutePosition: (id: string) => Vector
): VisualBounds {
  const absolutePosition = getAbsolutePosition(node.id)
  const base = computeVisualBounds([node], getAbsolutePosition)
  let bounds: VisualBounds = {
    minX: base.x,
    minY: base.y,
    maxX: base.x + base.width,
    maxY: base.y + base.height
  }

  const hasNonInsideStroke = node.strokes?.some(
    (stroke) => stroke.visible && stroke.align !== 'INSIDE'
  )
  const localGeometry = geometryBlobBounds([
    ...(node.fillGeometry ?? []),
    ...(hasNonInsideStroke ? (node.strokeGeometry ?? []) : [])
  ])
  if (localGeometry) {
    bounds =
      unionVisualBounds(bounds, transformedLocalBounds(node, localGeometry, absolutePosition)) ??
      bounds
  }

  if (node.type === 'TEXT' && node.textDecoration && node.textDecoration !== 'NONE') {
    const fontSize = node.fontSize ?? 14
    const underlineOffset = node.textUnderlineOffset ?? fontSize * 0.18
    const thickness = node.textDecorationThickness ?? Math.max(1, fontSize / 16)
    bounds.maxY += underlineOffset + thickness + fontSize * 0.35
  }

  return bounds
}

function collectDescendantVisualBounds(
  nodeId: string,
  getNode: (id: string) => VisualBoundsNode | undefined,
  getAbsolutePosition: (id: string) => Vector,
  clip: VisualBounds | null = null
): VisualBounds | null {
  const node = getNode(nodeId)
  if (!node?.visible) return null

  const own = nodeVisualBounds(node, getAbsolutePosition)
  let bounds = clip ? intersectVisualBounds(own, clip) : own

  const isClippableContainer =
    node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE'
  let childClip = clip
  if (isClippableContainer && node.clipsContent) {
    const absolutePosition = getAbsolutePosition(node.id)
    const nodeClip = {
      minX: absolutePosition.x,
      minY: absolutePosition.y,
      maxX: absolutePosition.x + node.width,
      maxY: absolutePosition.y + node.height
    }
    childClip = childClip ? intersectVisualBounds(childClip, nodeClip) : nodeClip
    if (!childClip) return bounds
  }

  for (const childId of node.childIds ?? []) {
    bounds = unionVisualBounds(
      bounds,
      collectDescendantVisualBounds(childId, getNode, getAbsolutePosition, childClip)
    )
  }

  return bounds
}

export function computeDescendantVisualBounds(
  nodeIds: string[],
  getNode: (id: string) => VisualBoundsNode | undefined,
  getAbsolutePosition: (id: string) => Vector
): VisualBounds | null {
  let bounds: VisualBounds | null = null
  for (const nodeId of nodeIds) {
    bounds = unionVisualBounds(
      bounds,
      collectDescendantVisualBounds(nodeId, getNode, getAbsolutePosition)
    )
  }
  return bounds
}
