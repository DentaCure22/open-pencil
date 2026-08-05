import { wcagContrast } from 'culori'

import { parseColor } from '@open-pencil/core/color'
import { estimateTextSize } from '@open-pencil/core/layout'
import type { Fill, Rect, SceneNode, Stroke } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'

import { boundedNumber, requiredString, trimmedString } from '../input'
import { boardViewportFocusBounds } from '../neighborhood'
import {
  parsePlacementDirections,
  resolveCenteredFreePlacement,
  type BoardPlacementDirection,
  type BoardPlacementResult,
  type BoardPlacementTarget,
  type BoardRelativePlacementOffset
} from '../placement'
import { nodeBounds, nodeSummary } from '../readback'
import { resolveNativePlacement } from './placement'
import { CARD_RECEIPT_PLUGIN_KEY, RECEIPT_PLUGIN_ID, type AgentCardReceipt } from './receipts'

export const LOCAL_LEGIBLE_CARD_PROFILE = 'local-legible-card-v1' as const

const CARD_PADDING = 24
const CARD_GAP = 12
const DEFAULT_CARD_WIDTH = 320
const DEFAULT_CLEARANCE = 48
const MAX_CARD_HEIGHT = 720
const TITLE_FONT_SIZE = 20
const BODY_FONT_SIZE = 14
const TITLE_LINE_HEIGHT = Math.ceil(TITLE_FONT_SIZE * 1.4)
const BODY_LINE_HEIGHT = Math.ceil(BODY_FONT_SIZE * 1.4)
const NON_ASCII_CHARACTER = /\P{ASCII}/u
const WIDE_ASCII_CHARACTER = /[MW@#%&mw]/u

type NativeCardPalette = {
  appearance: 'dark' | 'light'
  body: Fill
  fill: Fill
  stroke: Stroke
  title: Fill
}

type NativeCardTextFit = { body: boolean; title: boolean }

type NativeCardFreePlacementTarget = Exclude<
  BoardPlacementTarget,
  { kind: 'anchor' } | { kind: 'relative' }
>

export type NativeCardOperation = {
  body: string
  clearance: number
  height?: number
  name: string
  placementTarget: BoardPlacementTarget
  preferredDirections: BoardPlacementDirection[]
  relativeOffset?: BoardRelativePlacementOffset
  title: string
  width: number
}

export type NativeCardPlan = {
  bodyHeight: number
  palette: NativeCardPalette
  placement: BoardPlacementResult
  titleHeight: number
}

export type NativeCardReadback = {
  body: ReturnType<typeof nodeSummary> | { id: string; missing: true }
  owner: ReturnType<typeof nodeSummary>
  reconciliation: {
    reasons: string[]
    status: 'current' | 'diverged'
  }
  title: ReturnType<typeof nodeSummary> | { id: string; missing: true }
  visual: {
    body_contrast_ratio: number
    status: 'failed' | 'passed'
    title_contrast_ratio: number
  }
}

function textWithin(value: string, field: string, maximum: number): string {
  if (value.length > maximum) {
    throw new Error(`native_card ${field} must contain at most ${maximum} characters.`)
  }
  return value
}

function optionalTextWithin(value: unknown, field: string, maximum: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`native_card ${field} must be a string.`)
  return textWithin(value.trim(), field, maximum)
}

export function isNativeCardChange(value: unknown): boolean {
  if (!isUnknownRecord(value) || !isUnknownRecord(value.operation)) return false
  const artifact = value.operation.artifact
  return isUnknownRecord(artifact) && artifact.kind === 'native_card'
}

export function parseNativeCardOperation(value: unknown): NativeCardOperation {
  if (!isUnknownRecord(value) || value.kind !== 'artifact.create') {
    throw new Error('board_change native_card requires operation.kind "artifact.create".')
  }
  const artifact = value.artifact
  if (!isUnknownRecord(artifact) || artifact.kind !== 'native_card') {
    throw new Error('board_change native_card requires artifact.kind "native_card".')
  }
  const placement = isUnknownRecord(value.placement) ? value.placement : {}
  const anchorId = trimmedString(value, 'anchor_id')
  const freeTarget = parseFreePlacementTarget(placement.target)
  if (Boolean(anchorId) === Boolean(freeTarget)) {
    throw new Error(
      'board_change native_card requires exactly one of anchor_id or placement.target.'
    )
  }
  const placementTarget = anchorId ? { anchorId, kind: 'anchor' as const } : freeTarget
  if (!placementTarget) throw new Error('native_card placement target is missing.')
  const title = textWithin(requiredString(artifact, 'title'), 'title', 120)
  const body = optionalTextWithin(artifact.body, 'body', 1_200)
  return {
    body,
    clearance: boundedNumber(placement.clearance, DEFAULT_CLEARANCE, 0, 1_024),
    ...(artifact.height === undefined
      ? {}
      : { height: boundedNumber(artifact.height, 80, 80, MAX_CARD_HEIGHT) }),
    name: trimmedString(artifact, 'name') ?? title.slice(0, 80),
    placementTarget,
    preferredDirections: parsePlacementDirections(placement.preferred_directions),
    title,
    width: boundedNumber(artifact.width, DEFAULT_CARD_WIDTH, 240, 640)
  }
}

function finiteCoordinate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`native_card placement.target.${field} must be a finite number.`)
  }
  return value
}

function parseFreePlacementTarget(
  value: unknown
): Exclude<BoardPlacementTarget, { kind: 'anchor' }> | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) {
    throw new Error('native_card placement.target must be an object.')
  }
  if (value.kind === 'auto') {
    const unsupported = Object.keys(value).filter((key) => key !== 'kind')
    if (unsupported.length > 0) {
      throw new Error(
        `native_card placement.target contains unsupported fields: ${unsupported.sort().join(', ')}.`
      )
    }
    return { kind: 'auto' }
  }
  if (value.kind === 'relative') {
    const unsupported = Object.keys(value).filter((key) => !['kind', 'object_id'].includes(key))
    if (unsupported.length > 0) {
      throw new Error(
        `native_card placement.target contains unsupported fields: ${unsupported.sort().join(', ')}.`
      )
    }
    const objectId = trimmedString(value, 'object_id')
    if (!objectId) throw new Error('native_card placement.target.object_id is required.')
    return { kind: 'relative', objectId }
  }
  const supported =
    value.kind === 'point'
      ? new Set(['kind', 'x', 'y'])
      : new Set(['height', 'kind', 'width', 'x', 'y'])
  const unsupported = Object.keys(value).filter((key) => !supported.has(key))
  if (unsupported.length > 0) {
    throw new Error(
      `native_card placement.target contains unsupported fields: ${unsupported.sort().join(', ')}.`
    )
  }
  const x = finiteCoordinate(value.x, 'x')
  const y = finiteCoordinate(value.y, 'y')
  if (value.kind === 'point') return { kind: 'point', x, y }
  if (value.kind === 'region') {
    const width = finiteCoordinate(value.width, 'width')
    const height = finiteCoordinate(value.height, 'height')
    if (width <= 0 || height <= 0) {
      throw new Error('native_card placement.target region width and height must be positive.')
    }
    return { height, kind: 'region', width, x, y }
  }
  throw new Error('native_card placement.target.kind must be auto, point, relative, or region.')
}

function freeCardPlacement(
  target: AutomationTarget,
  operation: NativeCardOperation,
  placementTarget: NativeCardFreePlacementTarget,
  footprint: Pick<Rect, 'height' | 'width'>,
  obstacles: Rect[]
): BoardPlacementResult | null {
  if (placementTarget.kind === 'point') {
    return resolveCenteredFreePlacement({
      center: { x: placementTarget.x, y: placementTarget.y },
      clearance: operation.clearance,
      footprint,
      maxRings: 0,
      obstacles,
      preferredDirections: operation.preferredDirections
    })
  }
  const searchRegion =
    placementTarget.kind === 'auto'
      ? boardViewportFocusBounds(target)
      : {
          height: placementTarget.height,
          width: placementTarget.width,
          x: placementTarget.x,
          y: placementTarget.y
        }
  return resolveCenteredFreePlacement({
    center: {
      x: searchRegion.x + searchRegion.width / 2,
      y: searchRegion.y + searchRegion.height / 2
    },
    clearance: operation.clearance,
    footprint,
    maxRings: 12,
    obstacles,
    preferredDirections: operation.preferredDirections,
    searchRegion
  })
}

export function parseNativeCardProfile(value: unknown): typeof LOCAL_LEGIBLE_CARD_PROFILE {
  if (value === undefined) return LOCAL_LEGIBLE_CARD_PROFILE
  if (!isUnknownRecord(value) || value.profile !== LOCAL_LEGIBLE_CARD_PROFILE) {
    throw new Error(`native_card visual.profile must be "${LOCAL_LEGIBLE_CARD_PROFILE}".`)
  }
  return LOCAL_LEGIBLE_CARD_PROFILE
}

function opaque(color: ReturnType<typeof parseColor>) {
  return { ...color, a: 1 }
}

function solid(hex: string): Fill {
  return { color: opaque(parseColor(hex)), opacity: 1, type: 'SOLID', visible: true }
}

function border(hex: string): Stroke {
  return {
    align: 'INSIDE',
    color: opaque(parseColor(hex)),
    opacity: 1,
    visible: true,
    weight: 1
  }
}

function contrast(left: Fill, right: Fill): number {
  return wcagContrast({ mode: 'rgb', ...left.color }, { mode: 'rgb', ...right.color })
}

function paletteFor(surface: ReturnType<typeof parseColor>): NativeCardPalette {
  const black = solid('#000000')
  const white = solid('#FFFFFF')
  const page = { ...solid('#000000'), color: opaque(surface) }
  const darkSurface = contrast(white, page) > contrast(black, page)
  return darkSurface
    ? {
        appearance: 'dark',
        body: solid('#CBD5E1'),
        fill: solid('#111827'),
        stroke: border('#475569'),
        title: solid('#F8FAFC')
      }
    : {
        appearance: 'light',
        body: solid('#475569'),
        fill: solid('#FFFFFF'),
        stroke: border('#CBD5E1'),
        title: solid('#0F172A')
      }
}

function conservativeLineWidth(text: string, fontSize: number): number {
  let width = 0
  for (const character of text) {
    const factor =
      NON_ASCII_CHARACTER.test(character) || WIDE_ASCII_CHARACTER.test(character) ? 1 : 0.65
    width += fontSize * factor
  }
  return width
}

function measureText(
  text: string,
  fontSize: number,
  fontWeight: number,
  lineHeight: number,
  width: number
): number {
  const node = createDefaultNode(() => 'measurement:native-card', 'TEXT', {
    fontSize,
    fontWeight,
    lineHeight,
    text,
    textAutoResize: 'NONE'
  })
  const measured = NON_ASCII_CHARACTER.test(text)
    ? lineHeight
    : estimateTextSize(node, width).height
  const hardLineHeight = text.split(/\r\n?|\n/u).reduce((height, hardLine) => {
    const conservativeLines = Math.max(
      1,
      Math.ceil(conservativeLineWidth(hardLine, fontSize) / width)
    )
    return height + conservativeLines * lineHeight
  }, 0)
  return Math.max(lineHeight, measured, hardLineHeight)
}

function fixedTextFits(node: SceneNode | undefined): boolean {
  if (node?.type !== 'TEXT' || node.width <= 0 || node.height <= 0) return false
  const lineHeight = node.lineHeight ?? Math.ceil(node.fontSize * 1.4)
  return (
    measureText(node.text, node.fontSize, node.fontWeight, lineHeight, node.width) <= node.height
  )
}

export function nativeCardPlan(
  target: AutomationTarget,
  operation: NativeCardOperation,
  convergenceSources?: Rect[]
): NativeCardPlan {
  const textWidth = operation.width - CARD_PADDING * 2
  const titleHeight = measureText(
    operation.title,
    TITLE_FONT_SIZE,
    600,
    TITLE_LINE_HEIGHT,
    textWidth
  )
  const bodyHeight = measureText(operation.body, BODY_FONT_SIZE, 400, BODY_LINE_HEIGHT, textWidth)
  const measuredHeight = CARD_PADDING * 2 + titleHeight + CARD_GAP + bodyHeight
  const height = Math.max(measuredHeight, operation.height ?? 0)
  if (height > MAX_CARD_HEIGHT) {
    throw new Error(`native_card measured height exceeds ${MAX_CARD_HEIGHT} Board units.`)
  }
  const footprint = { height, width: operation.width }
  const resolution = resolveNativePlacement(target, operation, footprint, convergenceSources)
  const placement =
    resolution.kind === 'nearest'
      ? resolution.placement
      : freeCardPlacement(
          target,
          operation,
          resolution.placementTarget,
          footprint,
          resolution.obstacles
        )
  if (!placement) {
    throw new Error('No collision-free placement was found within the bounded search region.')
  }
  return {
    bodyHeight,
    palette: paletteFor(target.store.state.pageColor),
    placement,
    titleHeight
  }
}

export function nativeCardNodeProps(
  operation: NativeCardOperation,
  plan: NativeCardPlan,
  marker: AgentCardReceipt
) {
  const innerWidth = operation.width - CARD_PADDING * 2
  return {
    body: {
      fills: [plan.palette.body],
      fontSize: BODY_FONT_SIZE,
      fontWeight: 400,
      height: plan.bodyHeight,
      lineHeight: BODY_LINE_HEIGHT,
      name: 'Body',
      text: operation.body,
      textAutoResize: 'NONE' as const,
      width: innerWidth,
      x: CARD_PADDING,
      y: CARD_PADDING + plan.titleHeight + CARD_GAP
    },
    owner: {
      clipsContent: false,
      cornerRadius: 16,
      fills: [plan.palette.fill],
      name: operation.name,
      pluginData: [
        {
          key: CARD_RECEIPT_PLUGIN_KEY,
          pluginId: RECEIPT_PLUGIN_ID,
          value: JSON.stringify(marker)
        }
      ],
      strokes: [plan.palette.stroke]
    },
    title: {
      fills: [plan.palette.title],
      fontSize: TITLE_FONT_SIZE,
      fontWeight: 600,
      height: plan.titleHeight,
      lineHeight: TITLE_LINE_HEIGHT,
      name: 'Title',
      text: operation.title,
      textAutoResize: 'NONE' as const,
      width: innerWidth,
      x: CARD_PADDING,
      y: CARD_PADDING
    }
  }
}

function solidFill(node: SceneNode): Fill | null {
  return (
    node.fills.find(
      (fill) => fill.type === 'SOLID' && fill.visible && fill.opacity > 0 && fill.color.a > 0
    ) ?? null
  )
}

function effectiveSolidFill(node: SceneNode | undefined): Fill | null {
  return node?.visible && node.opacity > 0 ? solidFill(node) : null
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.01
}

function textChildReasons(
  role: 'body' | 'title',
  node: SceneNode | undefined,
  ownerId: string,
  ownerBounds: { height: number; width: number },
  expectedText: string,
  textFits: boolean
): string[] {
  if (!node || node.parentId !== ownerId || node.type !== 'TEXT') return [`${role}_missing`]
  const reasons: string[] = []
  if (node.text !== expectedText) reasons.push(`${role}_changed`)
  if (!node.visible) reasons.push(`${role}_hidden`)
  if (node.opacity <= 0) reasons.push(`${role}_transparent`)
  if (!textFits) reasons.push(`${role}_text_overflow`)
  if (
    node.x < 0 ||
    node.y < 0 ||
    node.width <= 0 ||
    node.height <= 0 ||
    node.x + node.width > ownerBounds.width + 0.01 ||
    node.y + node.height > ownerBounds.height + 0.01
  ) {
    reasons.push(`${role}_out_of_bounds`)
  }
  return reasons
}

function structureReasons(
  target: AutomationTarget,
  owner: SceneNode,
  title: SceneNode | undefined,
  body: SceneNode | undefined,
  marker: AgentCardReceipt,
  textFit: NativeCardTextFit
): string[] {
  const reasons: string[] = []
  if (owner.type !== 'FRAME') reasons.push('owner_type_changed')
  if (!target.store.graph.isDescendant(owner.id, target.pageId)) reasons.push('owner_off_board')
  if (!owner.visible) reasons.push('owner_hidden')
  if (owner.opacity <= 0) reasons.push('owner_transparent')
  if (owner.clipsContent) reasons.push('owner_clipping_changed')
  const ownerBounds = { height: owner.height, width: owner.width }
  reasons.push(
    ...textChildReasons('title', title, owner.id, ownerBounds, marker.title, textFit.title)
  )
  reasons.push(...textChildReasons('body', body, owner.id, ownerBounds, marker.body, textFit.body))
  if (
    owner.childIds.length !== 2 ||
    owner.childIds[0] !== marker.titleId ||
    owner.childIds[1] !== marker.bodyId
  ) {
    reasons.push('child_structure_changed')
  }
  return reasons
}

function boundsChanged(target: AutomationTarget, owner: SceneNode, expected: Rect): boolean {
  const actual = nodeBounds(target, owner)
  return (
    !close(actual.x, expected.x) ||
    !close(actual.y, expected.y) ||
    !close(actual.width, expected.width) ||
    !close(actual.height, expected.height)
  )
}

function visualVerification(
  owner: SceneNode,
  textFit: NativeCardTextFit,
  title?: SceneNode,
  body?: SceneNode
) {
  const background = effectiveSolidFill(owner)
  const titleFill = effectiveSolidFill(title)
  const bodyFill = effectiveSolidFill(body)
  const titleContrast = background && titleFill ? contrast(titleFill, background) : 0
  const bodyContrast = background && bodyFill ? contrast(bodyFill, background) : 0
  return {
    body_contrast_ratio: bodyContrast,
    status:
      titleContrast >= 4.5 && bodyContrast >= 4.5 && textFit.title && textFit.body
        ? ('passed' as const)
        : ('failed' as const),
    title_contrast_ratio: titleContrast
  }
}

export function nativeCardReadback(
  target: AutomationTarget,
  owner: SceneNode,
  marker: AgentCardReceipt
): NativeCardReadback {
  const title = target.store.graph.getNode(marker.titleId)
  const body = target.store.graph.getNode(marker.bodyId)
  const textFit = { body: fixedTextFits(body), title: fixedTextFits(title) }
  const reasons = structureReasons(target, owner, title, body, marker, textFit)
  if (boundsChanged(target, owner, marker.bounds)) reasons.push('owner_bounds_changed')
  if (!solidFill(owner)) reasons.push('owner_fill_missing')
  if (title && !solidFill(title)) reasons.push('title_fill_missing')
  if (body && !solidFill(body)) reasons.push('body_fill_missing')
  const visual = visualVerification(owner, textFit, title, body)
  if (visual.title_contrast_ratio < 4.5) reasons.push('title_contrast_failed')
  if (visual.body_contrast_ratio < 4.5) reasons.push('body_contrast_failed')
  return {
    body: body ? nodeSummary(target, body) : { id: marker.bodyId, missing: true },
    owner: nodeSummary(target, owner),
    reconciliation: { reasons, status: reasons.length === 0 ? 'current' : 'diverged' },
    title: title ? nodeSummary(target, title) : { id: marker.titleId, missing: true },
    visual
  }
}

export { CARD_RECEIPT_PLUGIN_KEY, cardReceiptEntry, type AgentCardReceipt } from './receipts'
