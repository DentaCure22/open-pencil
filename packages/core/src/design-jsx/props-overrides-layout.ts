import type { GridTrack, LayoutMode, SceneNode } from '@open-pencil/scene-graph'

const ALIGN_MAP: Record<string, SceneNode['primaryAxisAlign']> = {
  start: 'MIN',
  end: 'MAX',
  center: 'CENTER',
  between: 'SPACE_BETWEEN'
}

const COUNTER_ALIGN_MAP: Record<string, 'MIN' | 'MAX' | 'CENTER' | 'STRETCH'> = {
  start: 'MIN',
  end: 'MAX',
  center: 'CENTER',
  stretch: 'STRETCH'
}

const DIRECTION_MAP: Record<string, SceneNode['textDirection']> = {
  auto: 'AUTO',
  ltr: 'LTR',
  rtl: 'RTL'
}

const PADDING_KEYS = ['p', 'padding', 'px', 'py', 'pt', 'pr', 'pb', 'pl'] as const
const AUTO_LAYOUT_TRIGGER_KEYS = [
  ...PADDING_KEYS,
  'justify',
  'justifyContent',
  'items',
  'align',
  'alignItems'
] as const

export function parseFlowDirection(value: unknown): SceneNode['textDirection'] | undefined {
  if (typeof value !== 'string') return undefined
  return DIRECTION_MAP[value.toLowerCase()] ?? 'AUTO'
}

function applyFillSizing(
  dim: unknown,
  axis: 'width' | 'height',
  isGrid: boolean,
  isRow: boolean,
  isCol: boolean,
  overrides: Partial<SceneNode>
): void {
  if (dim !== 'fill') return
  const isPrimary = axis === 'width' ? isRow : isCol
  const isCross = axis === 'width' ? isCol : isRow
  if (isGrid || isCross) overrides.layoutAlignSelf = 'STRETCH'
  else if (isPrimary) overrides.layoutGrow = 1
  else {
    overrides.layoutGrow = 1
    overrides.layoutAlignSelf = 'STRETCH'
  }
}

export function applySizeOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  parentLayout: SceneNode['layoutMode']
): { w: unknown; h: unknown } {
  const w = props.w ?? props.width
  const h = props.h ?? props.height
  if (typeof w === 'number') overrides.width = w
  if (typeof h === 'number') overrides.height = h

  const isParentRow = parentLayout === 'HORIZONTAL'
  const isParentCol = parentLayout === 'VERTICAL'
  const isParentGrid = parentLayout === 'GRID'

  applyFillSizing(w, 'width', isParentGrid, isParentRow, isParentCol, overrides)
  applyFillSizing(h, 'height', isParentGrid, isParentRow, isParentCol, overrides)

  if (props.x !== undefined) overrides.x = props.x as number
  if (props.y !== undefined) overrides.y = props.y as number
  if (props.top !== undefined) overrides.y = props.top as number
  if (props.left !== undefined) overrides.x = props.left as number

  if (props.position === 'absolute') overrides.layoutPositioning = 'ABSOLUTE'
  const hasExplicitPosition =
    props.x !== undefined ||
    props.y !== undefined ||
    props.top !== undefined ||
    props.left !== undefined
  if (hasExplicitPosition && parentLayout !== 'NONE') {
    overrides.layoutPositioning = 'ABSOLUTE'
  }

  return { w, h }
}

function applyPaddingOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  const padding = props.p ?? props.padding
  if (typeof padding === 'number') {
    overrides.paddingTop = padding
    overrides.paddingRight = padding
    overrides.paddingBottom = padding
    overrides.paddingLeft = padding
  }
  const px = props.px as number | undefined
  const py = props.py as number | undefined
  if (px !== undefined) {
    overrides.paddingLeft = px
    overrides.paddingRight = px
  }
  if (py !== undefined) {
    overrides.paddingTop = py
    overrides.paddingBottom = py
  }
  if (props.pt !== undefined) overrides.paddingTop = props.pt as number
  if (props.pr !== undefined) overrides.paddingRight = props.pr as number
  if (props.pb !== undefined) overrides.paddingBottom = props.pb as number
  if (props.pl !== undefined) overrides.paddingLeft = props.pl as number
}

function hasAutoLayoutTriggerProps(props: Record<string, unknown>): boolean {
  return AUTO_LAYOUT_TRIGGER_KEYS.some((key) => props[key] !== undefined)
}

function parseTrack(token: string): GridTrack {
  if (token.endsWith('fr')) {
    return { sizing: 'FR', value: Number.parseFloat(token) || 1 }
  }
  if (token === 'auto') {
    return { sizing: 'AUTO', value: 0 }
  }
  return { sizing: 'FIXED', value: Number.parseFloat(token) || 0 }
}

function parseTrackList(value: string): GridTrack[] {
  return value.trim().split(/\s+/).map(parseTrack)
}

function applyGridOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  w: unknown,
  h: unknown
): void {
  overrides.layoutMode = 'GRID'

  if (typeof w === 'number') overrides.width = w
  if (typeof h === 'number') overrides.height = h

  if (typeof props.columns === 'string') {
    overrides.gridTemplateColumns = parseTrackList(props.columns)
  } else if (typeof props.columns === 'number') {
    overrides.gridTemplateColumns = Array.from({ length: props.columns }, () => ({
      sizing: 'FR' as const,
      value: 1
    }))
  }

  if (typeof props.rows === 'string') {
    overrides.gridTemplateRows = parseTrackList(props.rows)
  } else if (typeof props.rows === 'number') {
    overrides.gridTemplateRows = Array.from({ length: props.rows }, () => ({
      sizing: 'FR' as const,
      value: 1
    }))
  }

  if (typeof props.columnGap === 'number') overrides.gridColumnGap = props.columnGap
  if (typeof props.rowGap === 'number') overrides.gridRowGap = props.rowGap
  if (typeof props.gap === 'number') {
    overrides.gridColumnGap = props.gap
    overrides.gridRowGap = props.gap
  }

  if (props.rows === undefined && typeof h !== 'number') {
    overrides.height = 0
  }
}

function applyGridChildOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  const col = props.colStart ?? props.col
  const row = props.rowStart ?? props.row
  const colSpan = (props.colSpan as number | undefined) ?? 1
  const rowSpan = (props.rowSpan as number | undefined) ?? 1

  if (col !== undefined || row !== undefined) {
    overrides.gridPosition = {
      column: (col as number | undefined) ?? 0,
      row: (row as number | undefined) ?? 0,
      columnSpan: colSpan,
      rowSpan: rowSpan
    }
  }
}

function applyAutoLayoutSizing(
  overrides: Partial<SceneNode>,
  props: Record<string, unknown>,
  w: unknown,
  h: unknown
): void {
  const direction = (props.flex as string | undefined) ?? 'col'
  const isVertical = direction === 'col' || direction === 'column'
  overrides.layoutMode = (isVertical ? 'VERTICAL' : 'HORIZONTAL') as LayoutMode

  overrides.primaryAxisSizing = 'HUG'
  overrides.counterAxisSizing = 'HUG'

  const primaryDim = isVertical ? h : w
  const counterDim = isVertical ? w : h

  if (typeof primaryDim === 'number') overrides.primaryAxisSizing = 'FIXED'
  if (typeof counterDim === 'number') overrides.counterAxisSizing = 'FIXED'
  if (primaryDim === 'hug') overrides.primaryAxisSizing = 'HUG'
  if (counterDim === 'hug') overrides.counterAxisSizing = 'HUG'
}

function applyLayoutAlignmentOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  const justify = props.justify ?? props.justifyContent
  if (justify) {
    overrides.primaryAxisAlign = ALIGN_MAP[justify as string] ?? 'MIN'
  }
  const items = props.items ?? props.align ?? props.alignItems
  if (items) {
    overrides.counterAxisAlign = COUNTER_ALIGN_MAP[items as string] ?? 'MIN'
  }
}

function shouldEnableAutoLayout(props: Record<string, unknown>, isText: boolean): boolean {
  if (props.flex !== undefined) return true
  if (!isText && hasAutoLayoutTriggerProps(props)) return true
  return false
}

export function applyLayoutOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  w: unknown,
  h: unknown,
  isText: boolean,
  parentLayout: SceneNode['layoutMode']
): void {
  if (props.grid) {
    applyGridOverrides(props, overrides, w, h)
    applyPaddingOverrides(props, overrides)
    if (props.grow !== undefined) overrides.layoutGrow = props.grow as number
    return
  }

  if (parentLayout === 'GRID') {
    applyGridChildOverrides(props, overrides)
  }

  if (shouldEnableAutoLayout(props, isText)) {
    applyAutoLayoutSizing(overrides, props, w, h)
  }

  overrides.layoutDirection =
    parseFlowDirection(props.flow ?? (!isText ? props.dir : undefined)) ?? overrides.layoutDirection

  if (props.gap !== undefined) overrides.itemSpacing = props.gap as number

  if (props.wrap) {
    overrides.layoutWrap = 'WRAP'
    if (props.rowGap !== undefined) overrides.counterAxisSpacing = props.rowGap as number
  }

  applyLayoutAlignmentOverrides(props, overrides)
  applyPaddingOverrides(props, overrides)

  if (props.grow !== undefined) overrides.layoutGrow = props.grow as number

  if (props.minW !== undefined) {
    overrides.width = Math.max(overrides.width ?? 0, props.minW as number)
  }
  if (props.maxW !== undefined) {
    overrides.width = Math.min(overrides.width ?? Infinity, props.maxW as number)
  }
}
