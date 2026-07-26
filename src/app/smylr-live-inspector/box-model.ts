import type { DesignStyleDeclaration } from '@open-pencil/dom-css'

import type {
  SmylrLiveContainerNode,
  SmylrLiveContainerRect
} from '@/app/smylr-live-container/types'

export type BoxModelEdge = 'top' | 'right' | 'bottom' | 'left'
export type BoxModelEdges = Record<BoxModelEdge, number | null>
export type BoxModelMetrics = {
  border: BoxModelEdges
  contentHeight: number
  contentWidth: number
  margin: BoxModelEdges
  padding: BoxModelEdges
}
export type GapMeasurement = {
  axis: 'horizontal' | 'vertical'
  height: number
  value: number
  width: number
  x: number
  y: number
}

const BOX_MODEL_EDGES: BoxModelEdge[] = ['top', 'right', 'bottom', 'left']
const LAYOUT_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid'])
const MAX_GAP_CHILDREN = 96
const MAX_GAP_MEASUREMENTS = 32
const GAP_TOLERANCE = 1.5

function parsePixelLength(value: string | undefined, allowNegative = false) {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === '0' || normalized === '+0' || normalized === '-0') return 0
  if (!normalized.endsWith('px')) return null
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || (!allowNegative && parsed < 0)) return null
  return parsed
}

function expandShorthand(value: string | undefined, allowNegative: boolean): BoxModelEdges | null {
  if (!value) return null
  const parts = value.trim().split(/\s+/)
  if (parts.length < 1 || parts.length > 4) return null
  const values = parts.map((part) => parsePixelLength(part, allowNegative))
  if (values.some((part) => part === null)) return null
  const [top = null, second = top, third = top, fourth = second] = values
  return {
    top,
    right: second,
    bottom: third,
    left: fourth
  }
}

function resolveEdges(
  computedStyle: DesignStyleDeclaration | undefined,
  previewStyle: DesignStyleDeclaration | undefined,
  shorthand: string,
  longhand: (edge: BoxModelEdge) => string,
  allowNegative = false
): BoxModelEdges {
  const previewShorthand = expandShorthand(previewStyle?.[shorthand], allowNegative)
  const computedShorthand = expandShorthand(computedStyle?.[shorthand], allowNegative)
  return Object.fromEntries(
    BOX_MODEL_EDGES.map((edge) => {
      const property = longhand(edge)
      const previewLonghand = parsePixelLength(previewStyle?.[property], allowNegative)
      const computedLonghand = parsePixelLength(computedStyle?.[property], allowNegative)
      return [
        edge,
        previewLonghand ??
          previewShorthand?.[edge] ??
          computedLonghand ??
          computedShorthand?.[edge] ??
          null
      ]
    })
  ) as BoxModelEdges
}

function finiteEdge(edges: BoxModelEdges, edge: BoxModelEdge) {
  return Math.max(0, edges[edge] ?? 0)
}

export function getBoxModelMetrics(
  rect: SmylrLiveContainerRect,
  computedStyle?: DesignStyleDeclaration,
  previewStyle?: DesignStyleDeclaration
): BoxModelMetrics {
  const margin = resolveEdges(
    computedStyle,
    previewStyle,
    'margin',
    (edge) => `margin-${edge}`,
    true
  )
  const border = resolveEdges(
    computedStyle,
    previewStyle,
    'border-width',
    (edge) => `border-${edge}-width`
  )
  const padding = resolveEdges(computedStyle, previewStyle, 'padding', (edge) => `padding-${edge}`)
  const horizontalInset =
    finiteEdge(border, 'left') +
    finiteEdge(border, 'right') +
    finiteEdge(padding, 'left') +
    finiteEdge(padding, 'right')
  const verticalInset =
    finiteEdge(border, 'top') +
    finiteEdge(border, 'bottom') +
    finiteEdge(padding, 'top') +
    finiteEdge(padding, 'bottom')

  return {
    border,
    contentHeight: Math.max(0, rect.height - verticalInset),
    contentWidth: Math.max(0, rect.width - horizontalInset),
    margin,
    padding
  }
}

function gapValues(
  computedStyle: DesignStyleDeclaration | undefined,
  previewStyle: DesignStyleDeclaration | undefined
) {
  const previewGap = previewStyle?.gap ? previewStyle.gap.trim().split(/\s+/) : []
  const computedGap = computedStyle?.gap ? computedStyle.gap.trim().split(/\s+/) : []
  const rowGap = firstPixelLength(
    previewStyle?.['row-gap'],
    previewGap[0],
    computedStyle?.['row-gap'],
    computedGap[0]
  )
  const columnGap = firstPixelLength(
    previewStyle?.['column-gap'],
    previewGap[1] ?? previewGap[0],
    computedStyle?.['column-gap'],
    computedGap[1] ?? computedGap[0]
  )
  return { columnGap, rowGap }
}

function firstPixelLength(...values: Array<string | undefined>) {
  for (const value of values) {
    const parsed = parsePixelLength(value)
    if (parsed !== null) return parsed
  }
  return null
}

function overlap(startA: number, sizeA: number, startB: number, sizeB: number) {
  const start = Math.max(startA, startB)
  const end = Math.min(startA + sizeA, startB + sizeB)
  return { size: end - start, start }
}

function measurementKey(measurement: GapMeasurement) {
  return [
    measurement.axis,
    Math.round(measurement.x * 10),
    Math.round(measurement.y * 10),
    Math.round(measurement.width * 10),
    Math.round(measurement.height * 10)
  ].join(':')
}

function horizontalGapMeasurement(
  first: SmylrLiveContainerRect,
  second: SmylrLiveContainerRect,
  gap: number
): GapMeasurement | null {
  const [left, right] = first.x <= second.x ? [first, second] : [second, first]
  const separation = right.x - (left.x + left.width)
  const verticalOverlap = overlap(left.y, left.height, right.y, right.height)
  if (verticalOverlap.size <= 0 || Math.abs(separation - gap) > GAP_TOLERANCE) return null
  return {
    axis: 'horizontal',
    height: verticalOverlap.size,
    value: gap,
    width: separation,
    x: left.x + left.width,
    y: verticalOverlap.start
  }
}

function verticalGapMeasurement(
  first: SmylrLiveContainerRect,
  second: SmylrLiveContainerRect,
  gap: number
): GapMeasurement | null {
  const [top, bottom] = first.y <= second.y ? [first, second] : [second, first]
  const separation = bottom.y - (top.y + top.height)
  const horizontalOverlap = overlap(top.x, top.width, bottom.x, bottom.width)
  if (horizontalOverlap.size <= 0 || Math.abs(separation - gap) > GAP_TOLERANCE) return null
  return {
    axis: 'vertical',
    height: separation,
    value: gap,
    width: horizontalOverlap.size,
    x: horizontalOverlap.start,
    y: top.y + top.height
  }
}

function addMeasurement(
  measurements: Map<string, GapMeasurement>,
  measurement: GapMeasurement | null
) {
  if (measurement) measurements.set(measurementKey(measurement), measurement)
}

export function getGapMeasurements(
  node: SmylrLiveContainerNode,
  selectedRect: SmylrLiveContainerRect,
  previewStyle?: DesignStyleDeclaration
): GapMeasurement[] {
  const display = previewStyle?.display ?? node.computedStyle?.display
  if (!display || !LAYOUT_DISPLAYS.has(display)) return []

  const { columnGap, rowGap } = gapValues(node.computedStyle, previewStyle)
  const horizontalGap = columnGap && columnGap > 0 ? columnGap : null
  const verticalGap = rowGap && rowGap > 0 ? rowGap : null
  if (!horizontalGap && !verticalGap) return []

  const children = (node.children ?? [])
    .filter((child) => child.rect.width > 0 && child.rect.height > 0)
    .slice(0, MAX_GAP_CHILDREN)
    .map((child) => ({
      height: child.rect.height,
      width: child.rect.width,
      x: child.rect.x - selectedRect.x,
      y: child.rect.y - selectedRect.y
    }))
  const measurements = new Map<string, GapMeasurement>()

  for (let index = 0; index < children.length; index += 1) {
    const first = children[index] as SmylrLiveContainerRect
    for (let siblingIndex = index + 1; siblingIndex < children.length; siblingIndex += 1) {
      const second = children[siblingIndex] as SmylrLiveContainerRect
      if (horizontalGap) {
        addMeasurement(measurements, horizontalGapMeasurement(first, second, horizontalGap))
      }
      if (verticalGap) {
        addMeasurement(measurements, verticalGapMeasurement(first, second, verticalGap))
      }

      if (measurements.size >= MAX_GAP_MEASUREMENTS) return [...measurements.values()]
    }
  }

  return [...measurements.values()]
}
