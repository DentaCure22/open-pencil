import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode, SceneGraph, Fill } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type { SkiaRenderer } from './renderer'
import { makeSmoothRRectPath, nodeHasSmoothCorners } from './shapes'

export { drawArc, makeArcPath } from './fills/arcs'
export { applyGradientFill, linearGradientEndpoints } from './fills/gradients'
export { applyImageFill, makeImageFillLocalMatrix } from './fills/images'

export function drawNodeFill(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  rect: Float32Array,
  hasRadius: boolean,
  fill?: Fill
): void {
  switch (node.type) {
    case 'VECTOR': {
      const fg = r.getFillGeometry(node)
      if (fg) {
        for (const p of fg) canvas.drawPath(p, r.fillPaint)
      } else {
        const vps = r.getVectorPaths(node)
        if (vps) {
          for (const vp of vps) canvas.drawPath(vp, r.fillPaint)
        }
      }
      break
    }
    case 'ELLIPSE': {
      const fg = r.getFillGeometry(node)
      if (fg) {
        for (const p of fg) canvas.drawPath(p, r.fillPaint)
      } else if (node.arcData) {
        r.drawArc(canvas, node, r.fillPaint)
      } else {
        canvas.drawOval(rect, r.fillPaint)
      }
      break
    }
    case 'TEXT':
      r.renderText(canvas, node, fill)
      break
    case 'LINE':
      canvas.drawLine(0, 0, node.width, node.height, r.fillPaint)
      break
    case 'POLYGON':
    case 'STAR': {
      const path = r.makePolygonPath(node)
      canvas.drawPath(path, r.fillPaint)
      path.delete()
      break
    }
    default:
      if (nodeHasSmoothCorners(node)) {
        const path = makeSmoothRRectPath(r, node)
        canvas.drawPath(path, r.fillPaint)
        path.delete()
      } else if (hasRadius) {
        canvas.drawRRect(r.makeRRect(node), r.fillPaint)
      } else {
        canvas.drawRect(rect, r.fillPaint)
      }
  }
}

export function applyFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  fillIndex = 0,
  patternStack = new Set<string>()
): boolean {
  r.fillPaint.setShader(null)

  if (fill.type === 'SOLID') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
    return true
  }

  if (fill.type.startsWith('GRADIENT') && fill.gradientStops && fill.gradientTransform) {
    r.applyGradientFill(fill, node, graph)
    return true
  }

  if (fill.type === 'IMAGE' && fill.imageHash) {
    return r.applyImageFill(fill, node, graph)
  }

  if (fill.type === 'PATTERN' && applyPatternFill(r, fill, node, graph, patternStack)) return true

  if (fill.type === 'PATTERN' || fill.type === 'NOISE' || fill.type === 'CUSTOM') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
    return true
  }

  return false
}

interface PatternTileLayout {
  rect: Rect
  scale: number
  positions: Vector[]
}

function patternAlignmentOffset(
  alignment: Fill['horizontalAlignment'],
  gap: number,
  sourceSize: number,
  axis: 'x' | 'y'
): number {
  if (alignment === 'CENTER') return axis === 'x' ? -gap / 2 : -sourceSize / 2
  if (alignment === 'END') return -gap
  return 0
}

export function patternTileLayout(source: SceneNode, fill: Fill): PatternTileLayout {
  const scale = fill.scale && fill.scale > 0 ? fill.scale : 1
  const spacing = fill.patternSpacing ?? { x: 0, y: 0 }
  const scaledWidth = source.width * scale
  const scaledHeight = source.height * scale
  const gapX = scaledWidth * spacing.x
  const gapY = scaledHeight * spacing.y
  const width = scaledWidth + gapX
  const height = scaledHeight + gapY
  const x = patternAlignmentOffset(fill.horizontalAlignment, gapX, scaledWidth, 'x')
  const y = patternAlignmentOffset(fill.verticalAlignment, gapY, scaledHeight, 'y')
  const positions = [{ x, y }]

  if (fill.patternTileType === 'HORIZONTAL_HEXAGONAL') {
    positions.push({ x: x + width / 2, y: y + height / 2 })
  } else if (fill.patternTileType === 'VERTICAL_HEXAGONAL') {
    positions.push({ x: x + width / 2, y: y - height / 2 })
  }

  return { rect: { x: 0, y: 0, width, height }, scale, positions }
}

function recordPatternSource(
  r: SkiaRenderer,
  source: SceneNode,
  graph: SceneGraph,
  layout: PatternTileLayout,
  patternStack: Set<string>
) {
  const bounds = r.ck.LTRBRect(0, 0, layout.rect.width, layout.rect.height)
  const recorder = new r.ck.PictureRecorder()
  const canvas = recorder.beginRecording(bounds)
  const rect = r.ck.LTRBRect(0, 0, source.width, source.height)
  const hasRadius = nodeHasSmoothCorners(source) || source.cornerRadius > 0

  for (const position of layout.positions) {
    canvas.save()
    canvas.translate(position.x, position.y)
    canvas.scale(layout.scale, layout.scale)
    for (const sourceFill of source.fills.filter((item) => item.visible)) {
      if (sourceFill.type === 'PATTERN' && sourceFill.sourceNodeId === source.id) continue
      if (!applyFill(r, sourceFill, source, graph, 0, patternStack)) continue
      drawNodeFill(r, canvas, source, rect, hasRadius, sourceFill)
    }
    canvas.restore()
  }

  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  return picture
}

function resolvePatternSource(graph: SceneGraph, sourceId: string): SceneNode | null {
  const direct = graph.getNode(sourceId)
  if (direct) return direct
  for (const node of graph.getAllNodes()) {
    if (node.source.id === sourceId) return node
  }
  return null
}

function applyPatternFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  patternStack: Set<string>
): boolean {
  const sourceId = fill.sourceNodeId
  if (!sourceId || sourceId === node.id || sourceId === node.source.id) return false
  const source = resolvePatternSource(graph, sourceId)
  if (!source || source.width <= 0 || source.height <= 0) return false
  if (patternStack.has(source.id)) return false

  patternStack.add(source.id)
  const layout = patternTileLayout(source, fill)
  let picture
  try {
    picture = recordPatternSource(r, source, graph, layout, patternStack)
  } finally {
    patternStack.delete(source.id)
  }
  const tile = layout.rect
  const tileRect = r.ck.LTRBRect(tile.x, tile.y, tile.x + tile.width, tile.y + tile.height)
  const shader = picture.makeShader(
    r.ck.TileMode.Repeat,
    r.ck.TileMode.Repeat,
    r.ck.FilterMode.Linear,
    undefined,
    tileRect
  )
  r.fillPaint.setShader(shader)
  picture.delete()
  return true
}
