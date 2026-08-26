import type { Vector } from '../primitives'

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, rad: number): Vector {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: cx + (px - cx) * cos - (py - cy) * sin,
    y: cy + (px - cx) * sin + (py - cy) * cos
  }
}

export function rotatedCorners(
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  rotationDeg: number
): [Vector, Vector, Vector, Vector] {
  const rad = degToRad(rotationDeg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [
    {
      x: cx + -halfWidth * cos - -halfHeight * sin,
      y: cy + -halfWidth * sin + -halfHeight * cos
    },
    {
      x: cx + halfWidth * cos - -halfHeight * sin,
      y: cy + halfWidth * sin + -halfHeight * cos
    },
    {
      x: cx + halfWidth * cos - halfHeight * sin,
      y: cy + halfWidth * sin + halfHeight * cos
    },
    {
      x: cx + -halfWidth * cos - halfHeight * sin,
      y: cy + -halfWidth * sin + halfHeight * cos
    }
  ]
}

export function rotatedBBox(
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg: number
): { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number } {
  if (rotationDeg === 0) {
    return {
      left: x,
      right: x + width,
      top: y,
      bottom: y + height,
      centerX: x + width / 2,
      centerY: y + height / 2
    }
  }
  const corners = rotatedCorners(x + width / 2, y + height / 2, width / 2, height / 2, rotationDeg)
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (const corner of corners) {
    left = Math.min(left, corner.x)
    right = Math.max(right, corner.x)
    top = Math.min(top, corner.y)
    bottom = Math.max(bottom, corner.y)
  }
  return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 }
}
