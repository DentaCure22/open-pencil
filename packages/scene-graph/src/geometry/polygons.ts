import type { Vector } from '../primitives'
import type { VisualBounds } from './visual-bounds'

export function polygonVertices(node: {
  width: number
  height: number
  pointCount: number
  type: string
  starInnerRadius: number
}): Vector[] {
  const centerX = node.width / 2
  const centerY = node.height / 2
  const radiusX = node.width / 2
  const radiusY = node.height / 2
  const pointCount = Math.max(3, node.pointCount)
  const isStar = node.type === 'STAR'
  const innerRatio = isStar ? node.starInnerRadius : 1
  const totalPoints = isStar ? pointCount * 2 : pointCount
  const angleOffset = -Math.PI / 2

  return Array.from({ length: totalPoints }, (_, index) => {
    const angle = angleOffset + (2 * Math.PI * index) / totalPoints
    const radius = isStar && index % 2 === 1 ? innerRatio : 1
    return {
      x: centerX + radiusX * radius * Math.cos(angle),
      y: centerY + radiusY * radius * Math.sin(angle)
    }
  })
}

function crossProduct(a: Vector, b: Vector, point: Vector): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
}

function lineSegmentIntersect(p1: Vector, p2: Vector, p3: Vector, p4: Vector): Vector {
  const dx1 = p2.x - p1.x
  const dy1 = p2.y - p1.y
  const dx2 = p4.x - p3.x
  const dy2 = p4.y - p3.y
  const denominator = dx1 * dy2 - dy1 * dx2
  if (denominator === 0) return p1
  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denominator
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 }
}

function clipHalfPlane(polygon: Vector[], a: Vector, b: Vector, wantPositive: boolean): Vector[] {
  const output: Vector[] = []
  const isInside = (point: Vector): boolean => {
    const cross = crossProduct(a, b, point)
    return wantPositive ? cross >= 0 : cross <= 0
  }
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index]
    const previous = polygon[index === 0 ? polygon.length - 1 : index - 1]
    const currentInside = isInside(current)
    const previousInside = isInside(previous)
    if (currentInside) {
      if (!previousInside) output.push(lineSegmentIntersect(previous, current, a, b))
      output.push(current)
    } else if (previousInside) {
      output.push(lineSegmentIntersect(previous, current, a, b))
    }
  }
  return output
}

/** Clip a subject polygon against a convex polygon using Sutherland-Hodgman clipping. */
export function clipPolygon(subject: Vector[], clipCorners: Vector[]): Vector[] | null {
  if (clipCorners.length < 3) return subject

  let centerX = 0
  let centerY = 0
  for (const corner of clipCorners) {
    centerX += corner.x
    centerY += corner.y
  }
  centerX /= clipCorners.length
  centerY /= clipCorners.length

  let polygon: Vector[] = subject
  for (let index = 0; index < clipCorners.length; index++) {
    if (polygon.length === 0) return null
    const a = clipCorners[index]
    const b = clipCorners[(index + 1) % clipCorners.length]
    const centroidCross = crossProduct(a, b, { x: centerX, y: centerY })
    polygon = clipHalfPlane(polygon, a, b, centroidCross >= 0)
  }
  return polygon.length === 0 ? null : polygon
}

/** Clip axis-aligned visual bounds against a convex polygon and return the intersection AABB. */
export function clipBoundsToPolygon(
  bounds: VisualBounds,
  clipCorners: Vector[]
): VisualBounds | null {
  if (clipCorners.length < 3) return bounds

  const polygon = clipPolygon(
    [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY }
    ],
    clipCorners
  )
  if (!polygon) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of polygon) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return minX < maxX && minY < maxY ? { minX, minY, maxX, maxY } : null
}
