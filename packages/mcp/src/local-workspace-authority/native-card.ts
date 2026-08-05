import { estimateTextSize } from '@open-pencil/core/layout'
import type { Fill, Rect, SceneGraph, SceneNode, Stroke } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import type { AuthorityBoardDocument } from './document'
import {
  AUTHORITY_PLACEMENT_ALGORITHM,
  parseAuthorityFreePlacementTarget,
  parseAuthorityPlacementDirections,
  parseAuthorityRelativePlacementOffset,
  resolveAuthorityAnchoredPlacement,
  resolveAuthorityFreePlacement,
  type AuthorityFreePlacementTarget,
  type AuthorityPlacementDirection,
  type AuthorityRelativePlacementOffset
} from './placement'
import { authorityMutationInputDigest } from './request-digest'

const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const RECEIPT_PLUGIN_KEY = 'native-card-request-receipt'
const PLACEMENT_ALGORITHM = AUTHORITY_PLACEMENT_ALGORITHM
const CARD_PADDING = 24
const CARD_GAP = 12
const TITLE_FONT_SIZE = 20
const BODY_FONT_SIZE = 14
const TITLE_LINE_HEIGHT = 28
const BODY_LINE_HEIGHT = 20
const DEFAULT_CARD_WIDTH = 320
const DEFAULT_CLEARANCE = 48
const MAX_CARD_HEIGHT = 720

type JsonRecord = Record<string, unknown>
type PlacementTarget = AuthorityFreePlacementTarget

export type AuthorityCardOperation = {
  body: string
  clearance: number
  height?: number
  name: string
  placementTarget: PlacementTarget
  preferredDirections: AuthorityPlacementDirection[]
  relativeOffset?: AuthorityRelativePlacementOffset
  title: string
  width: number
}

type CardMarker = {
  algorithm: typeof PLACEMENT_ALGORITHM
  artifactKind: 'native_card'
  body: string
  bodyId: string
  bounds: Rect
  inputDigest: string
  placementTarget: PlacementTarget
  requestId: string
  route: 'board_change'
  title: string
  titleId: string
  version: 2
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredString(value: JsonRecord, field: string): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) throw new Error(`${field} is required.`)
  return result.trim()
}

function optionalString(value: JsonRecord, field: string): string | undefined {
  const result = value[field]
  return typeof result === 'string' && result.trim() ? result.trim() : undefined
}

function optionalText(value: JsonRecord, field: string): string {
  const result = value[field]
  if (result === undefined) return ''
  if (typeof result !== 'string') throw new Error(`${field} must be a string.`)
  return result.trim()
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  return value
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (value === undefined) return fallback
  const result = finiteNumber(value, field)
  if (result < minimum || result > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return result
}

export function authorityCardInputDigest(
  operation: AuthorityCardOperation,
  taskId?: string,
  traceId?: string
): string {
  const signatureOperation = {
    body: operation.body,
    clearance: operation.clearance,
    height: operation.height,
    name: operation.name,
    placementTarget: operation.placementTarget,
    preferredDirections: operation.preferredDirections,
    relativeOffset: operation.relativeOffset,
    title: operation.title,
    width: operation.width
  }
  const input = {
    operation: signatureOperation,
    visualProfile: 'local-legible-card-v1',
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
  return authorityMutationInputDigest('board_change', input)
}

function solidFill(red: number, green: number, blue: number): Fill {
  return {
    color: { a: 1, b: blue, g: green, r: red },
    opacity: 1,
    type: 'SOLID',
    visible: true
  }
}

function cardStroke(): Stroke {
  return {
    align: 'INSIDE',
    color: { a: 1, b: 0.412, g: 0.333, r: 0.278 },
    opacity: 1,
    visible: true,
    weight: 1
  }
}

function measuredHeight(text: string, fontSize: number, lineHeight: number, width: number): number {
  const provisional = createDefaultNode(() => 'measurement:headless-card', 'TEXT', {
    fontSize,
    lineHeight,
    text,
    textAutoResize: 'NONE'
  })
  return Math.max(lineHeight, estimateTextSize(provisional, width).height)
}

export function authorityNativeCardFootprint(
  operation: AuthorityCardOperation
): Pick<Rect, 'height' | 'width'> {
  const innerWidth = operation.width - CARD_PADDING * 2
  const titleHeight = measuredHeight(
    operation.title,
    TITLE_FONT_SIZE,
    TITLE_LINE_HEIGHT,
    innerWidth
  )
  const bodyHeight = measuredHeight(operation.body, BODY_FONT_SIZE, BODY_LINE_HEIGHT, innerWidth)
  const contentHeight = CARD_PADDING * 2 + titleHeight + CARD_GAP + bodyHeight
  const height = Math.max(contentHeight, operation.height ?? 0)
  if (height > MAX_CARD_HEIGHT) {
    throw new Error(`native_card exceeds ${MAX_CARD_HEIGHT} Board units.`)
  }
  return { height, width: operation.width }
}

export function parseAuthorityCardOperation(recipe: JsonRecord): AuthorityCardOperation {
  if (recipe.kind !== 'native_card') {
    throw new Error(
      'no_live_runtime: local authority supports native_card with explicit auto, point, relative, or region placement.target; open-app-only modalities were not applied.'
    )
  }
  const title = requiredString(recipe, 'title')
  const body = optionalText(recipe, 'body')
  if (title.length > 120 || body.length > 1_200) {
    throw new Error('native_card title or body exceeds its supported length.')
  }
  const placement = isRecord(recipe.placement) ? recipe.placement : {}
  if (!isRecord(placement.target)) {
    throw new Error('native_card requires placement.target without a live Board.')
  }
  const placementTarget = parseAuthorityFreePlacementTarget(placement.target)
  const relativeOffset = parseAuthorityRelativePlacementOffset(placement.relative_offset)
  if (relativeOffset && placementTarget.kind !== 'relative') {
    throw new Error('placement.relative_offset requires a relative placement.target.')
  }
  return {
    body,
    clearance: boundedNumber(
      placement.clearance,
      DEFAULT_CLEARANCE,
      0,
      1_024,
      'placement.clearance'
    ),
    ...(recipe.height === undefined
      ? {}
      : { height: boundedNumber(recipe.height, 80, 80, MAX_CARD_HEIGHT, 'height') }),
    name: optionalString(recipe, 'name') ?? title.slice(0, 80),
    placementTarget,
    preferredDirections: parseAuthorityPlacementDirections(placement.preferred_directions),
    ...(relativeOffset ? { relativeOffset } : {}),
    title,
    width: boundedNumber(recipe.width, DEFAULT_CARD_WIDTH, 240, 640, 'width')
  }
}

export function authorityCardMarker(node: SceneNode): CardMarker | null {
  const entry = node.pluginData.find(
    (candidate) => candidate.pluginId === RECEIPT_PLUGIN_ID && candidate.key === RECEIPT_PLUGIN_KEY
  )
  if (!entry) return null
  try {
    const value = JSON.parse(entry.value) as Partial<CardMarker>
    return value.version === 2 &&
      value.artifactKind === 'native_card' &&
      value.route === 'board_change' &&
      typeof value.requestId === 'string' &&
      typeof value.inputDigest === 'string'
      ? (value as CardMarker)
      : null
  } catch {
    throw new Error(`Native card receipt on "${node.id}" is unreadable.`)
  }
}

export function authorityCardRequestMatches(
  graph: SceneGraph,
  pageId: string,
  requestId: string
): SceneNode[] {
  return [...graph.getDescendants(pageId)].filter(
    (node) => authorityCardMarker(node)?.requestId === requestId
  )
}

export function createAuthorityNativeCard(
  document: AuthorityBoardDocument,
  pageId: string,
  operation: AuthorityCardOperation,
  inputDigest: string,
  requestId: string,
  placementAnchor?: Rect
) {
  const innerWidth = operation.width - CARD_PADDING * 2
  const titleHeight = measuredHeight(
    operation.title,
    TITLE_FONT_SIZE,
    TITLE_LINE_HEIGHT,
    innerWidth
  )
  const bodyHeight = measuredHeight(operation.body, BODY_FONT_SIZE, BODY_LINE_HEIGHT, innerWidth)
  const footprint = authorityNativeCardFootprint(operation)
  const height = footprint.height
  const placed = placementAnchor
    ? resolveAuthorityAnchoredPlacement({
        anchor: placementAnchor,
        clearance: operation.clearance,
        footprint,
        graph: document.graph,
        pageId,
        preferredDirections: operation.preferredDirections
      })
    : resolveAuthorityFreePlacement({
        clearance: operation.clearance,
        footprint,
        graph: document.graph,
        pageId,
        preferredDirections: operation.preferredDirections,
        relativeOffset: operation.relativeOffset,
        target: operation.placementTarget
      })
  const owner = document.graph.createNode('FRAME', pageId, {
    clipsContent: false,
    cornerRadius: 16,
    fills: [solidFill(0.067, 0.094, 0.153)],
    height,
    name: operation.name,
    strokes: [cardStroke()],
    width: operation.width,
    x: placed.bounds.x,
    y: placed.bounds.y
  })
  const title = document.graph.createNode('TEXT', owner.id, {
    fills: [solidFill(0.973, 0.98, 0.988)],
    fontSize: TITLE_FONT_SIZE,
    fontWeight: 600,
    height: titleHeight,
    lineHeight: TITLE_LINE_HEIGHT,
    name: 'Title',
    text: operation.title,
    textAutoResize: 'NONE',
    width: innerWidth,
    x: CARD_PADDING,
    y: CARD_PADDING
  })
  const body = document.graph.createNode('TEXT', owner.id, {
    fills: [solidFill(0.796, 0.835, 0.882)],
    fontSize: BODY_FONT_SIZE,
    fontWeight: 400,
    height: bodyHeight,
    lineHeight: BODY_LINE_HEIGHT,
    name: 'Body',
    text: operation.body,
    textAutoResize: 'NONE',
    width: innerWidth,
    x: CARD_PADDING,
    y: CARD_PADDING + titleHeight + CARD_GAP
  })
  const marker: CardMarker = {
    algorithm: PLACEMENT_ALGORITHM,
    artifactKind: 'native_card',
    body: operation.body,
    bodyId: body.id,
    bounds: placed.bounds,
    inputDigest,
    placementTarget: operation.placementTarget,
    requestId,
    route: 'board_change',
    title: operation.title,
    titleId: title.id,
    version: 2
  }
  document.graph.updateNode(owner.id, {
    pluginData: [
      ...owner.pluginData,
      { key: RECEIPT_PLUGIN_KEY, pluginId: RECEIPT_PLUGIN_ID, value: JSON.stringify(marker) }
    ]
  })
  return {
    body,
    owner: document.graph.getNode(owner.id) ?? owner,
    placement: placed,
    title
  }
}
