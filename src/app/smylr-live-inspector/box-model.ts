import type { DesignStyleDeclaration } from '@open-pencil/dom-css'

import type { SmylrLiveContainerNode, SmylrLiveContainerRect } from '../smylr-live-container/types'

export type BoxModelEdge = 'top' | 'right' | 'bottom' | 'left'
export type BoxModelLayer = 'margin' | 'border' | 'padding' | 'content'
export type GapAxis = 'horizontal' | 'vertical'

export type BoxModelEdges = Record<BoxModelEdge, number>

export type BoxModelMetrics = {
  border: BoxModelEdges
  margin: BoxModelEdges
  padding: BoxModelEdges
}

export type BoxModelBand = {
  edge?: BoxModelEdge
  layer: BoxModelLayer
  rect: SmylrLiveContainerRect
  showLabel: boolean
  value?: number
}

export type GapMeasurement = {
  axis: GapAxis
  rect: SmylrLiveContainerRect
  showLabel: boolean
  value: number
}

const BOX_MODEL_EDGES: BoxModelEdge[] = ['top', 'right', 'bottom', 'left']
const MAX_GAP_CHILDREN = 96
const MAX_GAP_MEASUREMENTS = 32
const MIN_VISIBLE_GAP = 0.5

function cssNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function shorthandEdges(value: unknown): BoxModelEdges | null {
  if (typeof value !== 'string') return null
  const values = value.trim().split(/\s+/).map(cssNumber)
  if (values.length === 0 || values.length > 4) return null
  const [top = 0, right = top, bottom = top, left = right] = values
  return { bottom, left, right, top }
}

function edgeProperty(layer: Exclude<BoxModelLayer, 'content'>, edge: BoxModelEdge) {
  return layer === 'border' ? `border-${edge}-width` : `${layer}-${edge}`
}

function shorthandProperty(layer: Exclude<BoxModelLayer, 'content'>) {
  return layer === 'border' ? 'border-width' : layer
}

function edgesFromStyle(
  computedStyle: DesignStyleDeclaration | undefined,
  previewStyle: DesignStyleDeclaration | undefined,
  layer: Exclude<BoxModelLayer, 'content'>
): BoxModelEdges {
  const base = shorthandEdges(computedStyle?.[shorthandProperty(layer)]) ?? {
    bottom: 0,
    left: 0,
    right: 0,
    top: 0
  }

  for (const edge of BOX_MODEL_EDGES) {
    const value = computedStyle?.[edgeProperty(layer, edge)]
    if (value !== undefined) base[edge] = cssNumber(value)
  }

  const previewShorthand = shorthandEdges(previewStyle?.[shorthandProperty(layer)])
  const resolved = previewShorthand ?? { ...base }
  for (const edge of BOX_MODEL_EDGES) {
    const value = previewStyle?.[edgeProperty(layer, edge)]
    if (value !== undefined) resolved[edge] = cssNumber(value)
  }
  return resolved
}

export function resolveBoxModelMetrics(
  computedStyle: DesignStyleDeclaration | undefined,
  previewStyle?: DesignStyleDeclaration
): BoxModelMetrics {
  return {
    border: edgesFromStyle(computedStyle, previewStyle, 'border'),
    margin: edgesFromStyle(computedStyle, previewStyle, 'margin'),
    padding: edgesFromStyle(computedStyle, previewStyle, 'padding')
  }
}

function edgeBand(
  layer: Exclude<BoxModelLayer, 'content'>,
  edge: BoxModelEdge,
  value: number,
  rect: SmylrLiveContainerRect
): BoxModelBand | null {
  const extent = Math.abs(value)
  if (extent < MIN_VISIBLE_GAP) return null

  if (edge === 'top') {
    return {
      edge,
      layer,
      rect: { height: extent, width: rect.width, x: rect.x, y: rect.y },
      showLabel: false,
      value
    }
  }
  if (edge === 'right') {
    return {
      edge,
      layer,
      rect: { height: rect.height, width: extent, x: rect.x + rect.width - extent, y: rect.y },
      showLabel: false,
      value
    }
  }
  if (edge === 'bottom') {
    return {
      edge,
      layer,
      rect: { height: extent, width: rect.width, x: rect.x, y: rect.y + rect.height - extent },
      showLabel: false,
      value
    }
  }
  return {
    edge,
    layer,
    rect: { height: rect.height, width: extent, x: rect.x, y: rect.y },
    showLabel: false,
    value
  }
}

function insetRect(rect: SmylrLiveContainerRect, edges: BoxModelEdges): SmylrLiveContainerRect {
  const top = Math.max(0, edges.top)
  const right = Math.max(0, edges.right)
  const bottom = Math.max(0, edges.bottom)
  const left = Math.max(0, edges.left)
  return {
    height: Math.max(0, rect.height - top - bottom),
    width: Math.max(0, rect.width - left - right),
    x: rect.x + left,
    y: rect.y + top
  }
}

function marginBands(edges: BoxModelEdges, size: SmylrLiveContainerRect) {
  const top = Math.abs(edges.top)
  const right = Math.abs(edges.right)
  const bottom = Math.abs(edges.bottom)
  const left = Math.abs(edges.left)
  const outer = {
    height: size.height + (edges.top > 0 ? top : 0) + (edges.bottom > 0 ? bottom : 0),
    width: size.width + (edges.left > 0 ? left : 0) + (edges.right > 0 ? right : 0),
    x: edges.left > 0 ? -left : 0,
    y: edges.top > 0 ? -top : 0
  }
  const bands: BoxModelBand[] = []
  for (const edge of BOX_MODEL_EDGES) {
    const band = edgeBand('margin', edge, edges[edge], outer)
    if (band) bands.push(band)
  }
  return bands
}

export function createBoxModelBands(
  metrics: BoxModelMetrics,
  width: number,
  height: number
): BoxModelBand[] {
  const borderBox = { height: Math.max(0, height), width: Math.max(0, width), x: 0, y: 0 }
  const paddingBox = insetRect(borderBox, metrics.border)
  const contentBox = insetRect(paddingBox, metrics.padding)
  const bands = marginBands(metrics.margin, borderBox)

  for (const edge of BOX_MODEL_EDGES) {
    const borderBand = edgeBand('border', edge, metrics.border[edge], borderBox)
    if (borderBand) bands.push(borderBand)
    const paddingBand = edgeBand('padding', edge, metrics.padding[edge], paddingBox)
    if (paddingBand) bands.push(paddingBand)
  }

  if (contentBox.width > 0 && contentBox.height > 0) {
    bands.push({ layer: 'content', rect: contentBox, showLabel: true })
  }
  const labeledValues = new Set<string>()
  for (const band of bands) {
    if (band.layer === 'content') continue
    const labelKey = `${band.layer}:${Math.round((band.value ?? 0) * 10) / 10}`
    band.showLabel = !labeledValues.has(labelKey)
    labeledValues.add(labelKey)
  }
  return bands
}

function overlap(startA: number, lengthA: number, startB: number, lengthB: number) {
  const start = Math.max(startA, startB)
  const end = Math.min(startA + lengthA, startB + lengthB)
  return { length: Math.max(0, end - start), start }
}

function childRects(children: SmylrLiveContainerNode[] | undefined) {
  return (children ?? [])
    .map((child) => child.rect)
    .filter(
      (rect) =>
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0
    )
    .slice(0, MAX_GAP_CHILDREN)
}

function clampGapRect(rect: SmylrLiveContainerRect, width: number, height: number) {
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(width, rect.x + rect.width)
  const bottom = Math.min(height, rect.y + rect.height)
  if (right - x < MIN_VISIBLE_GAP || bottom - y < MIN_VISIBLE_GAP) return null
  return { height: bottom - y, width: right - x, x, y }
}

export function createGapMeasurements(
  children: SmylrLiveContainerNode[] | undefined,
  width: number,
  height: number
): GapMeasurement[] {
  const rects = childRects(children)
  const gaps: Array<Omit<GapMeasurement, 'showLabel'>> = []

  for (const current of rects) {
    const currentRight = current.x + current.width
    const currentBottom = current.y + current.height
    const right = rects
      .filter((candidate) => {
        const cross = overlap(current.y, current.height, candidate.y, candidate.height)
        return candidate.x >= currentRight + MIN_VISIBLE_GAP && cross.length > MIN_VISIBLE_GAP
      })
      .sort((left, rightCandidate) => left.x - rightCandidate.x)[0]
    if (right) {
      const cross = overlap(current.y, current.height, right.y, right.height)
      const rect = clampGapRect(
        {
          height: cross.length,
          width: right.x - currentRight,
          x: currentRight,
          y: cross.start
        },
        width,
        height
      )
      if (rect) gaps.push({ axis: 'horizontal', rect, value: rect.width })
    }

    const below = rects
      .filter((candidate) => {
        const cross = overlap(current.x, current.width, candidate.x, candidate.width)
        return candidate.y >= currentBottom + MIN_VISIBLE_GAP && cross.length > MIN_VISIBLE_GAP
      })
      .sort((top, bottomCandidate) => top.y - bottomCandidate.y)[0]
    if (below) {
      const cross = overlap(current.x, current.width, below.x, below.width)
      const rect = clampGapRect(
        {
          height: below.y - currentBottom,
          width: cross.length,
          x: cross.start,
          y: currentBottom
        },
        width,
        height
      )
      if (rect) gaps.push({ axis: 'vertical', rect, value: rect.height })
    }
  }

  const seenGeometry = new Set<string>()
  const labeledValues = new Set<string>()
  const result: GapMeasurement[] = []
  for (const gap of gaps) {
    const geometryKey = `${gap.axis}:${[gap.rect.x, gap.rect.y, gap.rect.width, gap.rect.height]
      .map((value) => Math.round(value * 10) / 10)
      .join(':')}`
    if (seenGeometry.has(geometryKey)) continue
    seenGeometry.add(geometryKey)
    const labelKey = `${gap.axis}:${Math.round(gap.value * 10) / 10}`
    result.push({ ...gap, showLabel: !labeledValues.has(labelKey) })
    labeledValues.add(labelKey)
    if (result.length >= MAX_GAP_MEASUREMENTS) break
  }
  return result
}
