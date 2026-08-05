import { estimateTextSize } from '@open-pencil/core/layout'
import { boardBuildPlanConvergenceAnchor } from '@open-pencil/core/rpc'
import type { Rect, SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'

import { boundedNumber, requiredString, trimmedString } from '../input'
import { boardViewportFocusBounds } from '../neighborhood'
import {
  parsePlacementDirections,
  requireVisibleBoardAnchor,
  resolveCenteredFreePlacement,
  resolveNearestFreePlacement,
  visibleBoardObstacles,
  type BoardFreePlacementTarget,
  type BoardPlacementDirection,
  type BoardPlacementResult,
  type BoardPlacementTarget,
  type BoardRelativePlacementOffset
} from '../placement'
import { nodeBounds } from '../readback'

const DEFAULT_CLEARANCE = 48
const DEFAULT_FONT_SIZE = 18
const DEFAULT_MAX_TEXT_WIDTH = 360
const MIN_TEXT_WIDTH = 120
const WIDE_ASCII_CHARACTER = /[MW@#%&mw]/u
const TEXT_FIT_TOLERANCE = 0.01
export {
  receiptEntry,
  RECEIPT_PLUGIN_ID,
  requestNodes,
  TEXT_RECEIPT_PLUGIN_KEY as RECEIPT_PLUGIN_KEY,
  type AgentTextReceipt,
  type StoredAgentTextReceipt
} from './receipts'

export type NativeTextOperation = {
  clearance: number
  explicitFontSize: boolean
  fontSize: number
  height?: number
  maxWidth: number
  name: string
  placementTarget: BoardPlacementTarget
  preferredDirections: BoardPlacementDirection[]
  relativeOffset?: BoardRelativePlacementOffset
  text: string
}

function parseFreePlacementTarget(value: unknown): BoardFreePlacementTarget | null {
  if (!isUnknownRecord(value)) return null
  if (value.kind === 'auto') return { kind: 'auto' }
  if (value.kind === 'point') {
    return {
      kind: 'point',
      x: boundedNumber(value.x, 0, -1_000_000, 1_000_000),
      y: boundedNumber(value.y, 0, -1_000_000, 1_000_000)
    }
  }
  if (value.kind === 'relative') {
    return { kind: 'relative', objectId: requiredString(value, 'object_id') }
  }
  if (value.kind === 'region') {
    const height = boundedNumber(value.height, 0, 1, 1_000_000)
    const width = boundedNumber(value.width, 0, 1, 1_000_000)
    return {
      height,
      kind: 'region',
      width,
      x: boundedNumber(value.x, 0, -1_000_000, 1_000_000),
      y: boundedNumber(value.y, 0, -1_000_000, 1_000_000)
    }
  }
  return null
}

export type NativeTextTypography = Pick<
  SceneNode,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'letterSpacing' | 'lineHeight'
>

export type NativeTextReconciliation = {
  reasons: string[]
  status: 'current' | 'diverged'
}

export function parseNativeTextOperation(value: unknown): NativeTextOperation {
  if (!isUnknownRecord(value) || value.kind !== 'artifact.create') {
    throw new Error('board_change currently supports only operation.kind "artifact.create".')
  }
  const artifact = value.artifact
  if (!isUnknownRecord(artifact) || artifact.kind !== 'native_text') {
    throw new Error('board_change currently supports only artifact.kind "native_text".')
  }
  const placement = isUnknownRecord(value.placement) ? value.placement : {}
  const text = requiredString(artifact, 'text')
  const anchorId = trimmedString(value, 'anchor_id')
  const freeTarget = parseFreePlacementTarget(placement.target)
  if (Boolean(anchorId) === Boolean(freeTarget)) {
    throw new Error('native_text requires exactly one of anchor_id or placement.target.')
  }
  return {
    clearance: boundedNumber(placement.clearance, DEFAULT_CLEARANCE, 0, 1_024),
    explicitFontSize: artifact.font_size !== undefined,
    fontSize: boundedNumber(artifact.font_size, DEFAULT_FONT_SIZE, 8, 256),
    ...(artifact.height === undefined
      ? {}
      : { height: boundedNumber(artifact.height, 16, 16, 720) }),
    maxWidth: boundedNumber(artifact.max_width, DEFAULT_MAX_TEXT_WIDTH, 48, 2_000),
    name: trimmedString(artifact, 'name') ?? text.slice(0, 80),
    placementTarget: anchorId
      ? { anchorId, kind: 'anchor' }
      : (freeTarget as BoardFreePlacementTarget),
    preferredDirections: parsePlacementDirections(placement.preferred_directions),
    text
  }
}

function conservativeLineWidth(text: string, typography: NativeTextTypography): number {
  let width = 0
  for (const character of text) {
    const factor =
      (character.codePointAt(0) ?? 0) > 0x7f || WIDE_ASCII_CHARACTER.test(character) ? 1 : 0.65
    width += typography.fontSize * factor + typography.letterSpacing
  }
  return Math.max(0, width - typography.letterSpacing)
}

function resolvedTypography(
  operation: Pick<NativeTextOperation, 'fontSize'>,
  typography?: NativeTextTypography
): NativeTextTypography {
  const provisional = createDefaultNode(() => 'measurement:text', 'TEXT', {
    ...typography,
    fontSize: typography?.fontSize ?? operation.fontSize
  })
  return {
    fontFamily: provisional.fontFamily,
    fontSize: provisional.fontSize,
    fontWeight: provisional.fontWeight,
    italic: provisional.italic,
    letterSpacing: provisional.letterSpacing,
    lineHeight: provisional.lineHeight
  }
}

function measuredText(
  operation: Pick<NativeTextOperation, 'fontSize' | 'height' | 'maxWidth' | 'text'>,
  typography?: NativeTextTypography
): Pick<Rect, 'height' | 'width'> {
  const resolved = resolvedTypography(operation, typography)
  const lineHeight = resolved.lineHeight ?? Math.ceil(resolved.fontSize * 1.4)
  let measuredWidth = 0
  let measuredHeight = 0
  for (const hardLine of operation.text.split(/\r\n?|\n/u)) {
    const provisional = createDefaultNode(() => 'measurement:text', 'TEXT', {
      ...resolved,
      text: hardLine,
      textAutoResize: 'NONE'
    })
    const singleLine = estimateTextSize(provisional)
    const conservativeWidth = Math.max(singleLine.width, conservativeLineWidth(hardLine, resolved))
    measuredWidth = Math.max(measuredWidth, conservativeWidth)
    const wrapped = estimateTextSize(provisional, operation.maxWidth)
    const conservativeLines = Math.max(1, Math.ceil(conservativeWidth / operation.maxWidth))
    measuredHeight += Math.max(wrapped.height, conservativeLines * lineHeight)
  }
  return {
    height: Math.max(lineHeight, measuredHeight, operation.height ?? 0),
    width: Math.min(operation.maxWidth, Math.max(MIN_TEXT_WIDTH, measuredWidth))
  }
}

export function nativeTextFits(node: SceneNode): boolean {
  if (node.type !== 'TEXT' || node.width <= 0 || node.height <= 0) return false
  const measured = measuredText(
    { fontSize: node.fontSize, height: node.height, maxWidth: node.width, text: node.text },
    node
  )
  return (
    measured.width <= node.width + TEXT_FIT_TOLERANCE &&
    measured.height <= node.height + TEXT_FIT_TOLERANCE
  )
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= TEXT_FIT_TOLERANCE
}

export function nativeTextReconciliation(
  target: AutomationTarget,
  node: SceneNode,
  expected: { bounds: Rect; text: string }
): NativeTextReconciliation {
  const reasons: string[] = []
  if (node.type !== 'TEXT') reasons.push('owner_type_changed')
  if (!target.store.graph.isDescendant(node.id, target.pageId)) reasons.push('owner_off_board')
  if (node.text !== expected.text) reasons.push('text_changed')
  if (!node.visible) reasons.push('owner_hidden')
  if (node.opacity <= 0) reasons.push('owner_transparent')
  const actual = nodeBounds(target, node)
  if (
    !close(actual.x, expected.bounds.x) ||
    !close(actual.y, expected.bounds.y) ||
    !close(actual.width, expected.bounds.width) ||
    !close(actual.height, expected.bounds.height)
  ) {
    reasons.push('owner_bounds_changed')
  }
  return { reasons, status: reasons.length === 0 ? 'current' : 'diverged' }
}

export function placementFor(
  target: AutomationTarget,
  operation: NativeTextOperation,
  typography?: NativeTextTypography,
  convergenceSources?: Rect[]
): BoardPlacementResult {
  const footprint = measuredText(operation, typography)
  const obstacles = visibleBoardObstacles(target)
  const placementTarget = operation.placementTarget
  const convergenceAnchor = convergenceSources
    ? boardBuildPlanConvergenceAnchor(
        convergenceSources,
        footprint,
        operation.preferredDirections[0] ?? 'right'
      )
    : undefined
  const placement = convergenceAnchor
    ? resolveNearestFreePlacement({
        anchor: convergenceAnchor,
        clearance: operation.clearance,
        footprint,
        obstacles,
        preferredDirections: operation.preferredDirections
      })
    : placementTarget.kind === 'anchor'
      ? resolveNearestFreePlacement({
          anchor: nodeBounds(target, requireVisibleBoardAnchor(target, placementTarget.anchorId)),
          clearance: operation.clearance,
          footprint,
          obstacles,
          preferredDirections: operation.preferredDirections,
          ...(operation.relativeOffset ? { relativeOffset: operation.relativeOffset } : {})
        })
      : placementTarget.kind === 'relative'
        ? resolveNearestFreePlacement({
            anchor: nodeBounds(target, requireVisibleBoardAnchor(target, placementTarget.objectId)),
            clearance: operation.clearance,
            footprint,
            obstacles,
            preferredDirections: operation.preferredDirections,
            ...(operation.relativeOffset ? { relativeOffset: operation.relativeOffset } : {})
          })
        : resolveCenteredFreePlacement({
            center:
              placementTarget.kind === 'point'
                ? { x: placementTarget.x, y: placementTarget.y }
                : (() => {
                    const region =
                      placementTarget.kind === 'region'
                        ? placementTarget
                        : boardViewportFocusBounds(target)
                    return {
                      x: region.x + region.width / 2,
                      y: region.y + region.height / 2
                    }
                  })(),
            clearance: operation.clearance,
            footprint,
            maxRings: placementTarget.kind === 'point' ? 0 : 12,
            obstacles,
            preferredDirections: operation.preferredDirections,
            ...(placementTarget.kind === 'region'
              ? { searchRegion: placementTarget }
              : placementTarget.kind === 'auto'
                ? { searchRegion: boardViewportFocusBounds(target) }
                : {})
          })
  if (!placement) {
    throw new Error('No collision-free placement was found within the bounded search region.')
  }
  return placement
}
