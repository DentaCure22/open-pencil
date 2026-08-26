import type { Canvas, Paint } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'

export function makeArcPath(r: SkiaRenderer, node: SceneNode) {
  const arc = node.arcData
  if (!arc) return null
  const cx = node.width / 2
  const cy = node.height / 2
  const rx = node.width / 2
  const ry = node.height / 2
  const innerRx = rx * arc.innerRadius
  const innerRy = ry * arc.innerRadius

  const startDeg = arc.startingAngle * (180 / Math.PI)
  const endDeg = arc.endingAngle * (180 / Math.PI)
  const sweepDeg = endDeg - startDeg

  const path = new r.ck.Path()
  const oval = r.ck.LTRBRect(0, 0, node.width, node.height)

  if (arc.innerRadius > 0) {
    path.addArc(oval, startDeg, sweepDeg)
    const innerOval = r.ck.LTRBRect(cx - innerRx, cy - innerRy, cx + innerRx, cy + innerRy)
    const innerPath = new r.ck.Path()
    innerPath.addArc(innerOval, startDeg + sweepDeg, -sweepDeg)
    path.addPath(innerPath)
    path.close()
    innerPath.delete()
    return path
  }

  if (Math.abs(sweepDeg) >= 359.99) {
    path.addOval(oval)
  } else {
    path.moveTo(cx, cy)
    path.addArc(oval, startDeg, sweepDeg)
    path.close()
  }
  return path
}

export function drawArc(r: SkiaRenderer, canvas: Canvas, node: SceneNode, paint: Paint): void {
  const path = makeArcPath(r, node)
  if (!path) return
  canvas.drawPath(path, paint)
  path.delete()
}
