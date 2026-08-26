import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'

function makeGradientLocalMatrix(
  r: SkiaRenderer,
  width: number,
  height: number,
  transform: NonNullable<Fill['gradientTransform']>
) {
  return r.ck.Matrix.multiply(r.ck.Matrix.scaled(width, height), [
    transform.m00,
    transform.m01,
    transform.m02,
    transform.m10,
    transform.m11,
    transform.m12,
    0,
    0,
    1
  ])
}

export function linearGradientEndpoints(
  width: number,
  height: number,
  transform: NonNullable<Fill['gradientTransform']>
) {
  return {
    start: {
      x: (transform.m00 + transform.m02) * width,
      y: (transform.m10 + transform.m12) * height
    },
    end: { x: transform.m02 * width, y: transform.m12 * height }
  }
}

export function applyGradientFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph
): void {
  const stops = fill.gradientStops
  const transform = fill.gradientTransform
  if (!stops || !transform) return
  const colors = stops.map((stop, index) => {
    const resolved = r.resolveFillColorInfo(
      {
        ...fill,
        type: 'SOLID',
        color: stop.color,
        opacity: stop.color.a,
        visible: true
      },
      index,
      node,
      graph
    )
    const color = resolved.color
    return r.ck.Color4f(color.r, color.g, color.b, color.a)
  })
  const positions = stops.map((stop) => stop.position)
  const width = node.width
  const height = node.height

  if (fill.type === 'GRADIENT_LINEAR') {
    const { start, end } = linearGradientEndpoints(width, height, transform)
    const shader = r.ck.Shader.MakeLinearGradient(
      [start.x, start.y],
      [end.x, end.y],
      colors,
      positions,
      r.ck.TileMode.Clamp
    )
    r.fillPaint.setShader(shader)
  } else if (fill.type === 'GRADIENT_RADIAL' || fill.type === 'GRADIENT_DIAMOND') {
    const localMatrix = makeGradientLocalMatrix(r, width, height, transform)
    const shader = r.ck.Shader.MakeRadialGradient(
      [0.5, 0.5],
      0.5,
      colors,
      positions,
      r.ck.TileMode.Clamp,
      localMatrix
    )
    r.fillPaint.setShader(shader)
  } else if (fill.type === 'GRADIENT_ANGULAR') {
    const localMatrix = makeGradientLocalMatrix(r, width, height, transform)
    const shader = r.ck.Shader.MakeSweepGradient(
      0.5,
      0.5,
      colors,
      positions,
      r.ck.TileMode.Clamp,
      localMatrix
    )
    r.fillPaint.setShader(shader)
  }
}
