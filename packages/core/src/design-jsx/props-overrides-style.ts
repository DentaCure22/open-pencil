import type { Effect, Fill, SceneNode, Stroke } from '@open-pencil/scene-graph'
import type { Color, JsonObject } from '@open-pencil/scene-graph/primitives'

import { colorToFill, parseColor } from '#core/color'
import { TRANSPARENT } from '#core/constants'

import { parseFlowDirection } from './props-overrides-layout'

const WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  bold: 700
}

const TEXT_ALIGN_MAP: Record<string, SceneNode['textAlignHorizontal']> = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justified: 'JUSTIFIED'
}

const TEXT_VERTICAL_ALIGN_MAP: Record<string, SceneNode['textAlignVertical']> = {
  top: 'TOP',
  center: 'CENTER',
  bottom: 'BOTTOM'
}

const TEXT_ALIGN_ALIAS_MAP: Record<string, SceneNode['textAlignHorizontal']> = {
  ...TEXT_ALIGN_MAP,
  left_align: 'LEFT',
  center_align: 'CENTER',
  right_align: 'RIGHT'
}

const TEXT_AUTO_RESIZE_MAP: Record<string, SceneNode['textAutoResize']> = {
  none: 'NONE',
  width: 'WIDTH_AND_HEIGHT',
  height: 'HEIGHT'
}

function parseStroke(value: string | Color, width: number): Stroke {
  const color = typeof value === 'string' ? parseColor(value) : value
  return {
    color,
    opacity: color.a,
    visible: true,
    weight: width,
    align: 'INSIDE'
  }
}

function numberFromPx(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.endsWith('px')) return undefined
  const parsed = Number.parseFloat(trimmed.slice(0, -2))
  return Number.isFinite(parsed) ? parsed : undefined
}

export function normalizeStyleProps(props: Record<string, unknown>): Record<string, unknown> {
  const style = props.style
  if (style === null || typeof style !== 'object' || Array.isArray(style)) return props

  const source = style as JsonObject
  const normalized = { ...props }
  const copyIfUnset = (from: string, to: string, convert?: (value: unknown) => unknown): void => {
    if (normalized[to] !== undefined || source[from] === undefined) return
    normalized[to] = convert ? convert(source[from]) : source[from]
  }

  copyIfUnset('background', 'bg')
  copyIfUnset('backgroundColor', 'bg')
  copyIfUnset('color', 'color')
  copyIfUnset('borderColor', 'stroke')
  copyIfUnset('borderWidth', 'strokeWidth', numberFromPx)
  copyIfUnset('borderRadius', 'rounded', numberFromPx)
  copyIfUnset('fontSize', 'fontSize', numberFromPx)
  copyIfUnset('fontWeight', 'fontWeight')
  copyIfUnset('width', 'width', numberFromPx)
  copyIfUnset('height', 'height', numberFromPx)
  copyIfUnset('opacity', 'opacity')
  return normalized
}

function isColor(value: unknown): value is Color {
  return (
    value !== null &&
    typeof value === 'object' &&
    'r' in value &&
    'g' in value &&
    'b' in value &&
    'a' in value
  )
}

function isFill(value: unknown): value is Fill {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'color' in value &&
    'visible' in value
  )
}

function isFillValue(value: unknown): value is string | Color | Fill {
  return typeof value === 'string' || isColor(value) || isFill(value)
}

function fillFromValue(value: string | Color | Fill): Fill {
  return isFill(value) ? structuredClone(value) : colorToFill(value)
}

function applyFillOverride(props: Record<string, unknown>, overrides: Partial<SceneNode>): void {
  if (Array.isArray(props.fills)) {
    const fills = props.fills.filter(isFillValue).map(fillFromValue)
    if (fills.length > 0) overrides.fills = fills
    return
  }

  const background = props.bg ?? props.fill ?? props.background ?? props.backgroundColor
  if (isFillValue(background)) overrides.fills = [fillFromValue(background)]
}

function applyStrokeOverride(props: Record<string, unknown>, overrides: Partial<SceneNode>): void {
  const stroke = props.stroke ?? props.border ?? props.borderColor
  if (typeof stroke !== 'string' && !isColor(stroke)) return
  const strokeWidth =
    (props.strokeWidth as number | undefined) ?? (props.borderWidth as number | undefined) ?? 1
  overrides.strokes = [parseStroke(stroke, strokeWidth)]
}

function applyCornerOverrides(props: Record<string, unknown>, overrides: Partial<SceneNode>): void {
  const rounded = props.rounded ?? props.cornerRadius ?? props.borderRadius
  if (typeof rounded === 'number') overrides.cornerRadius = rounded

  if (
    props.roundedTL !== undefined ||
    props.roundedTR !== undefined ||
    props.roundedBL !== undefined ||
    props.roundedBR !== undefined
  ) {
    overrides.independentCorners = true
    if (props.roundedTL !== undefined) overrides.topLeftRadius = props.roundedTL as number
    if (props.roundedTR !== undefined) overrides.topRightRadius = props.roundedTR as number
    if (props.roundedBL !== undefined) overrides.bottomLeftRadius = props.roundedBL as number
    if (props.roundedBR !== undefined) overrides.bottomRightRadius = props.roundedBR as number
  }

  if (props.cornerSmoothing !== undefined) {
    overrides.cornerSmoothing = props.cornerSmoothing as number
  }
}

export function applyVisualOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  applyFillOverride(props, overrides)
  applyStrokeOverride(props, overrides)
  applyCornerOverrides(props, overrides)

  if (props.opacity !== undefined) overrides.opacity = props.opacity as number
  const rotation = props.rotate ?? props.rotation
  if (rotation !== undefined) overrides.rotation = rotation as number
  if (props.blendMode !== undefined) {
    overrides.blendMode = (props.blendMode as string).toUpperCase() as SceneNode['blendMode']
  }
  if (props.overflow === 'hidden') overrides.clipsContent = true
}

function applyTextAlignmentOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  const textAlign = props.textAlign ?? props.textAlignHorizontal ?? props.textHorizontalAlignment
  if (typeof textAlign === 'string') {
    overrides.textAlignHorizontal = TEXT_ALIGN_ALIAS_MAP[textAlign.toLowerCase()] ?? 'LEFT'
  }

  const textAlignVertical = props.textAlignVertical ?? props.textVerticalAlignment
  if (typeof textAlignVertical === 'string') {
    overrides.textAlignVertical = TEXT_VERTICAL_ALIGN_MAP[textAlignVertical.toLowerCase()] ?? 'TOP'
  }
}

function applyTextStyleOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  const fontSize = props.size ?? props.fontSize
  if (typeof fontSize === 'number') overrides.fontSize = fontSize

  const fontFamily = props.font ?? props.fontFamily
  if (typeof fontFamily === 'string') overrides.fontFamily = fontFamily

  const weight = props.weight ?? props.fontWeight
  if (typeof weight === 'number') {
    overrides.fontWeight = weight
  } else if (typeof weight === 'string') {
    overrides.fontWeight = WEIGHT_MAP[weight] ?? 400
  }

  if (typeof props.color === 'string' || isColor(props.color)) {
    overrides.fills = [colorToFill(props.color)]
  }

  if (props.lineHeight !== undefined) overrides.lineHeight = props.lineHeight as number
  if (props.letterSpacing !== undefined) overrides.letterSpacing = props.letterSpacing as number
  if (props.textDecoration !== undefined) {
    overrides.textDecoration = (
      props.textDecoration as string
    ).toUpperCase() as SceneNode['textDecoration']
  }
  if (props.textCase !== undefined) {
    overrides.textCase = (props.textCase as string).toUpperCase() as SceneNode['textCase']
  }
  if (props.maxLines !== undefined) {
    overrides.maxLines = props.maxLines as number
    overrides.textTruncation = 'ENDING'
  }
  if (props.truncate) overrides.textTruncation = 'ENDING'

  applyTextAlignmentOverrides(props, overrides)
}

function applyTextAutoResize(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  parentLayout: SceneNode['layoutMode']
): void {
  const width = props.w ?? props.width
  const hasExplicitWidth = width !== undefined
  const fillsParent = width === 'fill' || (props.grow as number) > 0
  const isInsideAutoLayout = parentLayout !== 'NONE'

  // WIDTH_AND_HEIGHT relies on MeasureFunc; without it, text retains its
  // default 100x100 size and expands HUG containers in headless layout.
  if (props.textAutoResize) {
    overrides.textAutoResize = TEXT_AUTO_RESIZE_MAP[props.textAutoResize as string] ?? 'NONE'
  } else if (hasExplicitWidth || (isInsideAutoLayout && fillsParent)) {
    overrides.textAutoResize = 'HEIGHT'
  } else {
    overrides.textAutoResize = 'WIDTH_AND_HEIGHT'
  }
}

export function applyTextOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>,
  parentLayout: SceneNode['layoutMode']
): void {
  applyTextStyleOverrides(props, overrides)
  overrides.textDirection = parseFlowDirection(props.dir) ?? overrides.textDirection
  applyTextAutoResize(props, overrides, parentLayout)
}

function isEffect(value: unknown): value is Effect {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    'radius' in value &&
    'visible' in value
  )
}

export function applyShapeAndEffectOverrides(
  props: Record<string, unknown>,
  overrides: Partial<SceneNode>
): void {
  if (Array.isArray(props.effects)) {
    const effects = props.effects.filter(isEffect).map((effect) => structuredClone(effect))
    if (effects.length > 0) overrides.effects = effects
  }

  if (props.points !== undefined) overrides.pointCount = props.points as number
  if (props.innerRadius !== undefined) overrides.starInnerRadius = props.innerRadius as number
  if (props.pointCount !== undefined) overrides.pointCount = props.pointCount as number

  if (typeof props.shadow === 'string') {
    const parts = props.shadow.split(/\s+/)
    if (parts.length >= 4) {
      const color = parseColor(parts.slice(3).join(' '))
      overrides.effects = [
        ...(overrides.effects ?? []),
        {
          type: 'DROP_SHADOW',
          color,
          offset: { x: Number.parseFloat(parts[0]), y: Number.parseFloat(parts[1]) },
          radius: Number.parseFloat(parts[2]),
          spread: 0,
          visible: true
        }
      ]
    }
  }

  if (typeof props.blur === 'number') {
    overrides.effects = [
      ...(overrides.effects ?? []),
      {
        type: 'LAYER_BLUR',
        radius: props.blur,
        visible: true,
        color: { ...TRANSPARENT },
        offset: { x: 0, y: 0 },
        spread: 0
      }
    ]
  }
}
