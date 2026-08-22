import { estimateTextSize } from '@open-pencil/core/layout'
import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import type { AuthorityBoardDocument } from './document'
import {
  AUTHORITY_PLACEMENT_ALGORITHM,
  parseAuthorityFreePlacementTarget,
  parseAuthorityPlacementDirections,
  parseAuthorityRelativePlacementOffset,
  requireAuthorityAnchor,
  resolveAuthorityAnchoredPlacement,
  resolveAuthorityFreePlacement,
  type AuthorityFreePlacementTarget,
  type AuthorityPlacementDirection,
  type AuthorityPlacementResult,
  type AuthorityRelativePlacementOffset
} from './placement'
import { authorityMutationInputDigest } from './request-digest'

const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const RECEIPT_PLUGIN_KEY = 'request-receipt'
const DEFAULT_CLEARANCE = 48
const DEFAULT_FONT_SIZE = 18
const DEFAULT_MAX_TEXT_WIDTH = 360
const MIN_TEXT_WIDTH = 120
const TEXT_FIT_TOLERANCE = 0.01
const WIDE_ASCII_CHARACTER = /[MW@#%&mw]/u
const LOCAL_LEGIBLE_TEXT_PROFILE = 'local-legible-text-v2'

type JsonRecord = Record<string, unknown>

export type AuthorityTextOperation = {
  clearance: number
  explicitFontSize: boolean
  fontSize: number
  height?: number
  maxWidth: number
  name: string
  placementTarget: { anchorId: string; kind: 'anchor' } | AuthorityFreePlacementTarget
  preferredDirections: AuthorityPlacementDirection[]
  relativeOffset?: AuthorityRelativePlacementOffset
  text: string
}

type TextMarker = {
  algorithm: typeof AUTHORITY_PLACEMENT_ALGORITHM
  anchorId?: string
  bounds: Rect
  inputDigest: string
  requestId: string
  route: 'board_change'
  text: string
  version: 2 | 3 | 4
  visualProfile?: typeof LOCAL_LEGIBLE_TEXT_PROFILE
}

export type AuthorityTextReadback = {
  graph: {
    bounds: Rect
    id: string
    name: string
    text: string
    type: SceneNode['type']
    visible: boolean
  }
  reconciliation: { reasons: string[]; status: 'current' | 'diverged' }
}

const RECIPE_KEYS = new Set([
  'font_size',
  'height',
  'kind',
  'max_width',
  'name',
  'placement',
  'text'
])
const PLACEMENT_KEYS = new Set(['clearance', 'preferred_directions', 'relative_offset', 'target'])

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertSupportedFields(
  value: JsonRecord,
  supported: ReadonlySet<string>,
  label: string
): void {
  const unsupported = Object.keys(value).filter((key) => !supported.has(key))
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.sort().join(', ')}.`)
  }
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

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

export function parseAuthorityTextOperation(
  recipe: JsonRecord,
  anchorId: string | undefined
): AuthorityTextOperation {
  if (recipe.kind !== 'native_text') {
    throw new Error('Local authority native text requires recipe.kind "native_text".')
  }
  assertSupportedFields(recipe, RECIPE_KEYS, 'native_text recipe')
  const text = requiredString(recipe, 'text')
  if (text.length > 10_000) {
    throw new Error('native_text text must contain at most 10000 characters.')
  }
  const placement = recipe.placement === undefined ? {} : recipe.placement
  if (!isRecord(placement)) throw new Error('native_text placement must be an object.')
  assertSupportedFields(placement, PLACEMENT_KEYS, 'native_text placement')
  const exactAnchorId = anchorId?.trim()
  const freeTarget =
    placement.target === undefined ? undefined : parseAuthorityFreePlacementTarget(placement.target)
  if (Boolean(exactAnchorId) === Boolean(freeTarget)) {
    throw new Error('native_text requires exactly one of anchor_id or placement.target.')
  }
  const relativeOffset = parseAuthorityRelativePlacementOffset(placement.relative_offset)
  if (relativeOffset && !exactAnchorId && freeTarget?.kind !== 'relative') {
    throw new Error('placement.relative_offset requires an anchor or relative placement.target.')
  }
  return {
    clearance: boundedNumber(
      placement.clearance,
      DEFAULT_CLEARANCE,
      0,
      1_024,
      'placement.clearance'
    ),
    explicitFontSize: recipe.font_size !== undefined,
    fontSize: boundedNumber(recipe.font_size, DEFAULT_FONT_SIZE, 8, 256, 'font_size'),
    ...(recipe.height === undefined
      ? {}
      : { height: boundedNumber(recipe.height, 16, 16, 720, 'height') }),
    maxWidth: boundedNumber(recipe.max_width, DEFAULT_MAX_TEXT_WIDTH, 48, 2_000, 'max_width'),
    name: optionalString(recipe, 'name') ?? text.slice(0, 80),
    placementTarget: exactAnchorId
      ? { anchorId: exactAnchorId, kind: 'anchor' }
      : (freeTarget as AuthorityFreePlacementTarget),
    preferredDirections: parseAuthorityPlacementDirections(placement.preferred_directions),
    ...(relativeOffset ? { relativeOffset } : {}),
    text
  }
}

export function authorityTextInputDigest(
  operation: AuthorityTextOperation,
  taskId?: string,
  traceId?: string
): string {
  return authorityMutationInputDigest('board_change', {
    operation,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {}),
    visualProfile: LOCAL_LEGIBLE_TEXT_PROFILE
  })
}

function conservativeLineWidth(text: string, fontSize: number, letterSpacing: number): number {
  let width = 0
  for (const character of text) {
    const factor =
      (character.codePointAt(0) ?? 0) > 0x7f || WIDE_ASCII_CHARACTER.test(character) ? 1 : 0.65
    width += fontSize * factor + letterSpacing
  }
  return Math.max(0, width - letterSpacing)
}

export function authorityNativeTextFootprint(
  operation: AuthorityTextOperation
): Pick<Rect, 'height' | 'width'> {
  const typography = createDefaultNode(() => 'measurement:headless-text', 'TEXT', {
    fontSize: operation.fontSize
  })
  const lineHeight = typography.lineHeight ?? Math.ceil(typography.fontSize * 1.4)
  let measuredWidth = 0
  let measuredHeight = 0
  for (const hardLine of operation.text.split(/\r\n?|\n/u)) {
    const line = createDefaultNode(() => 'measurement:headless-text-line', 'TEXT', {
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,
      fontWeight: typography.fontWeight,
      italic: typography.italic,
      letterSpacing: typography.letterSpacing,
      lineHeight: typography.lineHeight,
      text: hardLine,
      textAutoResize: 'NONE'
    })
    const singleLine = estimateTextSize(line)
    const conservativeWidth = Math.max(
      singleLine.width,
      conservativeLineWidth(hardLine, typography.fontSize, typography.letterSpacing)
    )
    measuredWidth = Math.max(measuredWidth, conservativeWidth)
    const wrapped = estimateTextSize(line, operation.maxWidth)
    const conservativeLines = Math.max(1, Math.ceil(conservativeWidth / operation.maxWidth))
    measuredHeight += Math.max(wrapped.height, conservativeLines * lineHeight)
  }
  return {
    height: Math.max(lineHeight, measuredHeight, operation.height ?? 0),
    width: Math.min(operation.maxWidth, Math.max(MIN_TEXT_WIDTH, measuredWidth))
  }
}

function markerBounds(value: unknown): Rect | null {
  if (!isRecord(value)) return null
  const { height, width, x, y } = value
  if (
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    height <= 0 ||
    width <= 0
  ) {
    return null
  }
  return { height, width, x, y }
}

function isTextMarkerVersion(value: unknown): value is TextMarker['version'] {
  return value === 2 || value === 3 || value === 4
}

export function authorityTextMarker(node: SceneNode): TextMarker | null {
  const entry = node.pluginData.find(
    (candidate) => candidate.pluginId === RECEIPT_PLUGIN_ID && candidate.key === RECEIPT_PLUGIN_KEY
  )
  if (!entry) return null
  try {
    const value = JSON.parse(entry.value) as Partial<TextMarker>
    const bounds = markerBounds(value.bounds)
    if (
      !isTextMarkerVersion(value.version) ||
      value.algorithm !== AUTHORITY_PLACEMENT_ALGORITHM ||
      value.route !== 'board_change' ||
      typeof value.inputDigest !== 'string' ||
      typeof value.requestId !== 'string' ||
      typeof value.text !== 'string' ||
      !bounds
    ) {
      return null
    }
    if ((value.version === 2 || value.version === 3) && typeof value.anchorId !== 'string') {
      return null
    }
    if (
      (value.version === 3 || value.version === 4) &&
      value.visualProfile !== LOCAL_LEGIBLE_TEXT_PROFILE
    ) {
      return null
    }
    return {
      algorithm: AUTHORITY_PLACEMENT_ALGORITHM,
      ...(typeof value.anchorId === 'string' ? { anchorId: value.anchorId } : {}),
      bounds,
      inputDigest: value.inputDigest,
      requestId: value.requestId,
      route: 'board_change',
      text: value.text,
      version: value.version,
      ...(value.version === 3 || value.version === 4
        ? { visualProfile: LOCAL_LEGIBLE_TEXT_PROFILE }
        : {})
    }
  } catch {
    throw new Error(`Native text receipt on "${node.id}" is unreadable.`)
  }
}

export function authorityTextRequestMatches(
  graph: SceneGraph,
  pageId: string,
  requestId: string
): SceneNode[] {
  return [...graph.getDescendants(pageId)].filter(
    (node) => authorityTextMarker(node)?.requestId === requestId
  )
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= TEXT_FIT_TOLERANCE
}

export function authorityTextReadback(
  graph: SceneGraph,
  pageId: string,
  node: SceneNode,
  marker: TextMarker
): AuthorityTextReadback {
  const reasons: string[] = []
  if (node.type !== 'TEXT') reasons.push('owner_type_changed')
  if (!graph.isDescendant(node.id, pageId)) reasons.push('owner_off_board')
  if (node.text !== marker.text) reasons.push('text_changed')
  if (!node.visible) reasons.push('owner_hidden')
  if (node.opacity <= 0) reasons.push('owner_transparent')
  if (marker.version === 3 || marker.version === 4) {
    const fill = node.fills.find((candidate) => candidate.visible && candidate.type === 'SOLID')
    if (!fill || fill.color.r < 0.9 || fill.color.g < 0.9 || fill.color.b < 0.9) {
      reasons.push('theme_safe_fill_changed')
    }
    const halo = node.effects.find(
      (effect) =>
        effect.visible &&
        effect.type === 'DROP_SHADOW' &&
        effect.color.r <= 0.1 &&
        effect.color.g <= 0.1 &&
        effect.color.b <= 0.1 &&
        effect.color.a >= 0.85 &&
        effect.spread >= 1
    )
    if (!halo) reasons.push('theme_safe_halo_changed')
  }
  const actual = graph.getAbsoluteBounds(node.id)
  if (
    !close(actual.x, marker.bounds.x) ||
    !close(actual.y, marker.bounds.y) ||
    !close(actual.width, marker.bounds.width) ||
    !close(actual.height, marker.bounds.height)
  ) {
    reasons.push('owner_bounds_changed')
  }
  return {
    graph: {
      bounds: actual,
      id: node.id,
      name: node.name,
      text: node.text,
      type: node.type,
      visible: node.visible
    },
    reconciliation: { reasons, status: reasons.length === 0 ? 'current' : 'diverged' }
  }
}

export function createAuthorityNativeText(
  document: AuthorityBoardDocument,
  pageId: string,
  operation: AuthorityTextOperation,
  inputDigest: string,
  requestId: string,
  placementAnchor?: Rect
): { owner: SceneNode; placement: AuthorityPlacementResult } {
  let placement: AuthorityPlacementResult
  if (placementAnchor) {
    placement = resolveAuthorityAnchoredPlacement({
      anchor: placementAnchor,
      clearance: operation.clearance,
      footprint: authorityNativeTextFootprint(operation),
      graph: document.graph,
      pageId,
      preferredDirections: operation.preferredDirections
    })
  } else if (operation.placementTarget.kind === 'anchor') {
    const anchor = requireAuthorityAnchor(
      document.graph,
      pageId,
      operation.placementTarget.anchorId
    )
    placement = resolveAuthorityAnchoredPlacement({
      anchor: document.graph.getAbsoluteBounds(anchor.id),
      clearance: operation.clearance,
      footprint: authorityNativeTextFootprint(operation),
      graph: document.graph,
      pageId,
      preferredDirections: operation.preferredDirections,
      relativeOffset: operation.relativeOffset
    })
  } else {
    placement = resolveAuthorityFreePlacement({
      clearance: operation.clearance,
      footprint: authorityNativeTextFootprint(operation),
      graph: document.graph,
      pageId,
      preferredDirections: operation.preferredDirections,
      relativeOffset: operation.relativeOffset,
      target: operation.placementTarget
    })
  }
  const owner = document.graph.createNode('TEXT', pageId, {
    effects: [
      {
        color: { a: 0.92, b: 0.02, g: 0.02, r: 0.02 },
        offset: { x: 0, y: 0 },
        radius: 1,
        spread: 1,
        type: 'DROP_SHADOW',
        visible: true
      }
    ],
    fills: [
      {
        color: { a: 1, b: 0.988, g: 0.98, r: 0.973 },
        opacity: 1,
        type: 'SOLID',
        visible: true
      }
    ],
    fontSize: operation.fontSize,
    height: placement.bounds.height,
    name: operation.name,
    text: operation.text,
    textAutoResize: 'NONE',
    width: placement.bounds.width,
    x: placement.bounds.x,
    y: placement.bounds.y
  })
  const marker: TextMarker = {
    algorithm: AUTHORITY_PLACEMENT_ALGORITHM,
    ...(operation.placementTarget.kind === 'anchor'
      ? { anchorId: operation.placementTarget.anchorId }
      : {}),
    bounds: placement.bounds,
    inputDigest,
    requestId,
    route: 'board_change',
    text: operation.text,
    version: operation.placementTarget.kind === 'anchor' ? 3 : 4,
    visualProfile: LOCAL_LEGIBLE_TEXT_PROFILE
  }
  document.graph.updateNode(owner.id, {
    pluginData: [
      ...owner.pluginData,
      { key: RECEIPT_PLUGIN_KEY, pluginId: RECEIPT_PLUGIN_ID, value: JSON.stringify(marker) }
    ]
  })
  return { owner: document.graph.getNode(owner.id) ?? owner, placement }
}
