import type { Path } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'

type SmoothCornerKey = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'

type SmoothCorner = {
  radius: number
  budget: number
}

type SmoothCornerPathParams = {
  a: number
  b: number
  c: number
  d: number
  p: number
  radius: number
  arcSectionLength: number
}

export function nodeHasSmoothCorners(node: SceneNode): boolean {
  if (!(node.cornerSmoothing > 0)) return false
  if (node.independentCorners) {
    return (
      node.topLeftRadius > 0 ||
      node.topRightRadius > 0 ||
      node.bottomRightRadius > 0 ||
      node.bottomLeftRadius > 0
    )
  }
  return node.cornerRadius > 0
}

function smoothCornerRadii(
  node: SceneNode,
  width: number,
  height: number,
  spread: number
): Record<SmoothCornerKey, SmoothCorner> {
  const radius = (value: number) => Math.max(0, value + spread)
  const radii: Record<SmoothCornerKey, number> = node.independentCorners
    ? {
        topLeft: radius(node.topLeftRadius),
        topRight: radius(node.topRightRadius),
        bottomRight: radius(node.bottomRightRadius),
        bottomLeft: radius(node.bottomLeftRadius)
      }
    : {
        topLeft: radius(node.cornerRadius),
        topRight: radius(node.cornerRadius),
        bottomRight: radius(node.cornerRadius),
        bottomLeft: radius(node.cornerRadius)
      }

  if (
    radii.topLeft === radii.topRight &&
    radii.topRight === radii.bottomRight &&
    radii.bottomRight === radii.bottomLeft
  ) {
    const budget = Math.min(width, height) / 2
    const clampedRadius = Math.min(radii.topLeft, budget)
    return {
      topLeft: { radius: clampedRadius, budget },
      topRight: { radius: clampedRadius, budget },
      bottomRight: { radius: clampedRadius, budget },
      bottomLeft: { radius: clampedRadius, budget }
    }
  }

  const budgets: Record<SmoothCornerKey, number> = {
    topLeft: -1,
    topRight: -1,
    bottomRight: -1,
    bottomLeft: -1
  }
  const adjacentByCorner: Record<
    SmoothCornerKey,
    Array<{ corner: SmoothCornerKey; sideLength: number }>
  > = {
    topLeft: [
      { corner: 'topRight', sideLength: width },
      { corner: 'bottomLeft', sideLength: height }
    ],
    topRight: [
      { corner: 'topLeft', sideLength: width },
      { corner: 'bottomRight', sideLength: height }
    ],
    bottomRight: [
      { corner: 'bottomLeft', sideLength: width },
      { corner: 'topRight', sideLength: height }
    ],
    bottomLeft: [
      { corner: 'bottomRight', sideLength: width },
      { corner: 'topLeft', sideLength: height }
    ]
  }

  for (const corner of (Object.keys(radii) as SmoothCornerKey[]).sort(
    (a, b) => radii[b] - radii[a]
  )) {
    const cornerRadius = radii[corner]
    const budget = Math.min(
      ...adjacentByCorner[corner].map((adjacent) => {
        const adjacentRadius = radii[adjacent.corner]
        if (cornerRadius === 0 && adjacentRadius === 0) return 0
        if (budgets[adjacent.corner] >= 0) return adjacent.sideLength - budgets[adjacent.corner]
        return (cornerRadius / (cornerRadius + adjacentRadius)) * adjacent.sideLength
      })
    )
    budgets[corner] = budget
    radii[corner] = Math.min(cornerRadius, budget)
  }

  return {
    topLeft: { radius: radii.topLeft, budget: budgets.topLeft },
    topRight: { radius: radii.topRight, budget: budgets.topRight },
    bottomRight: { radius: radii.bottomRight, budget: budgets.bottomRight },
    bottomLeft: { radius: radii.bottomLeft, budget: budgets.bottomLeft }
  }
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function smoothCornerPathParams(corner: SmoothCorner, smoothing: number): SmoothCornerPathParams {
  let cornerSmoothing = smoothing
  let p = (1 + cornerSmoothing) * corner.radius
  if (corner.radius > 0) {
    const maxSmoothing = corner.budget / corner.radius - 1
    cornerSmoothing = Math.min(cornerSmoothing, maxSmoothing)
    p = Math.min(p, corner.budget)
  }

  const arcMeasure = 90 * (1 - cornerSmoothing)
  const arcSectionLength = Math.sin(degreesToRadians(arcMeasure / 2)) * corner.radius * Math.sqrt(2)
  const angleAlpha = (90 - arcMeasure) / 2
  const p3ToP4Distance = corner.radius * Math.tan(degreesToRadians(angleAlpha / 2))
  const angleBeta = 45 * cornerSmoothing
  const c = p3ToP4Distance * Math.cos(degreesToRadians(angleBeta))
  const d = c * Math.tan(degreesToRadians(angleBeta))
  const b = (p - arcSectionLength - c - d) / 3

  return {
    a: 2 * b,
    b,
    c,
    d,
    p,
    radius: corner.radius,
    arcSectionLength
  }
}

function drawTopRightSmoothCorner(
  path: Path,
  corner: SmoothCornerPathParams,
  x: number,
  y: number
) {
  if (corner.radius === 0) {
    path.lineTo(x + corner.p, y)
    return
  }
  path.cubicTo(
    x + corner.a,
    y,
    x + corner.a + corner.b,
    y,
    x + corner.a + corner.b + corner.c,
    y + corner.d
  )
  path.arcToRotated(
    corner.radius,
    corner.radius,
    0,
    true,
    false,
    x + corner.p - corner.d,
    y + corner.p - corner.a - corner.b - corner.c
  )
  path.cubicTo(
    x + corner.p,
    y + corner.p - corner.a - corner.b,
    x + corner.p,
    y + corner.p - corner.a,
    x + corner.p,
    y + corner.p
  )
}

function drawBottomRightSmoothCorner(
  path: Path,
  corner: SmoothCornerPathParams,
  x: number,
  y: number
) {
  if (corner.radius === 0) {
    path.lineTo(x, y + corner.p)
    return
  }
  path.cubicTo(
    x,
    y + corner.a,
    x,
    y + corner.a + corner.b,
    x - corner.d,
    y + corner.a + corner.b + corner.c
  )
  path.arcToRotated(
    corner.radius,
    corner.radius,
    0,
    true,
    false,
    x - corner.p + corner.a + corner.b + corner.c,
    y + corner.p - corner.d
  )
  path.cubicTo(
    x - corner.p + corner.a + corner.b,
    y + corner.p,
    x - corner.p + corner.a,
    y + corner.p,
    x - corner.p,
    y + corner.p
  )
}

function drawBottomLeftSmoothCorner(
  path: Path,
  corner: SmoothCornerPathParams,
  x: number,
  y: number
) {
  if (corner.radius === 0) {
    path.lineTo(x - corner.p, y)
    return
  }
  path.cubicTo(
    x - corner.a,
    y,
    x - corner.a - corner.b,
    y,
    x - corner.a - corner.b - corner.c,
    y - corner.d
  )
  path.arcToRotated(
    corner.radius,
    corner.radius,
    0,
    true,
    false,
    x - corner.p + corner.d,
    y - corner.p + corner.a + corner.b + corner.c
  )
  path.cubicTo(
    x - corner.p,
    y - corner.p + corner.a + corner.b,
    x - corner.p,
    y - corner.p + corner.a,
    x - corner.p,
    y - corner.p
  )
}

function drawTopLeftSmoothCorner(path: Path, corner: SmoothCornerPathParams, x: number, y: number) {
  if (corner.radius === 0) {
    path.lineTo(x, y - corner.p)
    return
  }
  path.cubicTo(
    x,
    y - corner.a,
    x,
    y - corner.a - corner.b,
    x + corner.d,
    y - corner.a - corner.b - corner.c
  )
  path.arcToRotated(
    corner.radius,
    corner.radius,
    0,
    true,
    false,
    x + corner.p - corner.a - corner.b - corner.c,
    y - corner.p + corner.d
  )
  path.cubicTo(
    x + corner.p - corner.a - corner.b,
    y - corner.p,
    x + corner.p - corner.a,
    y - corner.p,
    x + corner.p,
    y - corner.p
  )
}

export function makeSmoothRRectPath(
  r: SkiaRenderer,
  node: SceneNode,
  spread = 0,
  offsetX = 0,
  offsetY = 0
): Path {
  const path = new r.ck.Path()
  const left = offsetX - spread
  const top = offsetY - spread
  const right = offsetX + node.width + spread
  const bottom = offsetY + node.height + spread
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) {
    path.addRect(r.ck.LTRBRect(left, top, Math.max(left, right), Math.max(top, bottom)))
    return path
  }

  const smoothing = Math.max(0, Math.min(node.cornerSmoothing, 1))
  const corners = smoothCornerRadii(node, width, height, spread)
  const topLeftCorner = smoothCornerPathParams(corners.topLeft, smoothing)
  const topRightCorner = smoothCornerPathParams(corners.topRight, smoothing)
  const bottomRightCorner = smoothCornerPathParams(corners.bottomRight, smoothing)
  const bottomLeftCorner = smoothCornerPathParams(corners.bottomLeft, smoothing)

  if (
    topLeftCorner.radius === 0 &&
    topRightCorner.radius === 0 &&
    bottomRightCorner.radius === 0 &&
    bottomLeftCorner.radius === 0
  ) {
    path.addRect(r.ck.LTRBRect(left, top, right, bottom))
    return path
  }

  path.moveTo(right - topRightCorner.p, top)
  drawTopRightSmoothCorner(path, topRightCorner, right - topRightCorner.p, top)
  path.lineTo(right, bottom - bottomRightCorner.p)
  drawBottomRightSmoothCorner(path, bottomRightCorner, right, bottom - bottomRightCorner.p)
  path.lineTo(left + bottomLeftCorner.p, bottom)
  drawBottomLeftSmoothCorner(path, bottomLeftCorner, left + bottomLeftCorner.p, bottom)
  path.lineTo(left, top + topLeftCorner.p)
  drawTopLeftSmoothCorner(path, topLeftCorner, left, top + topLeftCorner.p)
  path.close()
  return path
}
