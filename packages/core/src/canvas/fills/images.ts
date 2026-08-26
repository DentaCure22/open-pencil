import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'

export function makeImageFillLocalMatrix(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  imgW: number,
  imgH: number
) {
  const scaleMode = fill.imageScaleMode ?? 'FILL'
  if (scaleMode === 'TILE' && !fill.imageTransform) return r.ck.Matrix.identity()

  if ((scaleMode === 'CROP' || scaleMode === 'TILE') && fill.imageTransform) {
    const t = fill.imageTransform
    const transform = [t.m00, t.m01, t.m02, t.m10, t.m11, t.m12, 0, 0, 1]
    const inverse = r.ck.Matrix.invert(transform)
    if (inverse) {
      return r.ck.Matrix.multiply(
        r.ck.Matrix.scaled(node.width, node.height),
        inverse,
        r.ck.Matrix.scaled(1 / imgW, 1 / imgH)
      )
    }
  }

  let sx: number, sy: number, sw: number, sh: number
  if (scaleMode === 'FIT') {
    const scale = Math.min(node.width / imgW, node.height / imgH)
    sw = imgW
    sh = imgH
    sx = -(node.width / scale - imgW) / 2
    sy = -(node.height / scale - imgH) / 2
  } else {
    const scale = Math.max(node.width / imgW, node.height / imgH)
    sw = node.width / scale
    sh = node.height / scale
    sx = (imgW - sw) / 2
    sy = (imgH - sh) / 2
  }

  return r.ck.Matrix.multiply(
    r.ck.Matrix.scaled(node.width / sw, node.height / sh),
    r.ck.Matrix.translated(-sx, -sy)
  )
}

export function applyImageFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph
): boolean {
  const hash = fill.imageHash
  if (!hash) return false
  let image = r.imageCache.get(hash)
  if (!image) {
    const data = graph.images.get(hash)
    if (!data) return false
    const decoded = r.ck.MakeImageFromEncoded(data) ?? undefined
    if (!decoded) return false
    image = decoded.makeCopyWithDefaultMipmaps()
    decoded.delete()
    r.imageCache.set(hash, image)
  }

  const localMatrix = makeImageFillLocalMatrix(r, fill, node, image.width(), image.height())
  if ((fill.imageScaleMode ?? 'FILL') === 'TILE') {
    const shader = image.makeShaderCubic(
      r.ck.TileMode.Repeat,
      r.ck.TileMode.Repeat,
      1 / 3,
      1 / 3,
      localMatrix
    )
    r.fillPaint.setShader(shader)
    return true
  }

  const shader = image.makeShaderOptions(
    r.ck.TileMode.Clamp,
    r.ck.TileMode.Clamp,
    r.ck.FilterMode.Linear,
    r.ck.MipmapMode.Linear,
    localMatrix
  )
  r.fillPaint.setShader(shader)
  return true
}
