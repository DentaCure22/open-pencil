import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'

import { BOARD_PLACEMENT_ALGORITHM, type BoardFreePlacementTarget } from '../placement'

export const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
export const TEXT_RECEIPT_PLUGIN_KEY = 'request-receipt'
export const CARD_RECEIPT_PLUGIN_KEY = 'native-card-request-receipt'

export type AgentTextReceipt = {
  algorithm: typeof BOARD_PLACEMENT_ALGORITHM
  anchorId: string
  bounds: Rect
  inputDigest: string
  requestId: string
  route: 'board_change'
  text: string
  version: 2
}

export type StoredAgentTextReceipt =
  | AgentTextReceipt
  | {
      algorithm: typeof BOARD_PLACEMENT_ALGORITHM
      anchorId: string
      bounds: Rect
      requestId: string
      text: string
      version: 1
    }

type AgentCardReceiptCommon = {
  algorithm: typeof BOARD_PLACEMENT_ALGORITHM
  artifactKind: 'native_card'
  body: string
  bodyId: string
  bounds: Rect
  inputDigest: string
  requestId: string
  route: 'board_change'
  title: string
  titleId: string
}

export type AgentCardReceipt =
  | (AgentCardReceiptCommon & {
      anchorId: string
      version: 1
    })
  | (AgentCardReceiptCommon & {
      placementTarget: BoardFreePlacementTarget
      version: 2
    })

type NativeReceiptMarker =
  | { inputDigest?: string; kind: 'native_text'; requestId: string; route?: string; version: 1 | 2 }
  | {
      inputDigest: string
      kind: 'native_card'
      requestId: string
      route: string
      version: 1 | 2
    }

function receiptValue(node: SceneNode, key: string): unknown {
  const entry = node.pluginData.find(
    (candidate) => candidate.pluginId === RECEIPT_PLUGIN_ID && candidate.key === key
  )
  if (!entry) return null
  try {
    return JSON.parse(entry.value) as unknown
  } catch {
    return undefined
  }
}

function bounds(value: unknown): Rect | null {
  if (!isUnknownRecord(value)) return null
  const { height, width, x, y } = value
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null
  }
  return { height, width, x, y }
}

export function receiptEntry(node: SceneNode): StoredAgentTextReceipt | null {
  const value = receiptValue(node, TEXT_RECEIPT_PLUGIN_KEY)
  if (!isUnknownRecord(value)) return null
  const storedBounds = bounds(value.bounds)
  if (
    (value.version !== 1 && value.version !== 2) ||
    value.algorithm !== BOARD_PLACEMENT_ALGORITHM ||
    typeof value.requestId !== 'string' ||
    typeof value.anchorId !== 'string' ||
    typeof value.text !== 'string' ||
    !storedBounds ||
    (value.version === 2 &&
      (value.route !== 'board_change' || typeof value.inputDigest !== 'string'))
  ) {
    return null
  }
  const common = {
    algorithm: BOARD_PLACEMENT_ALGORITHM,
    anchorId: value.anchorId,
    bounds: storedBounds,
    requestId: value.requestId,
    text: value.text
  }
  return value.version === 2
    ? {
        ...common,
        inputDigest: value.inputDigest as string,
        route: 'board_change',
        version: 2
      }
    : { ...common, version: 1 }
}

export function cardReceiptEntry(node: SceneNode): AgentCardReceipt | null {
  const value = receiptValue(node, CARD_RECEIPT_PLUGIN_KEY)
  if (!isUnknownRecord(value)) return null
  const storedBounds = bounds(value.bounds)
  if (
    (value.version !== 1 && value.version !== 2) ||
    value.artifactKind !== 'native_card' ||
    value.algorithm !== BOARD_PLACEMENT_ALGORITHM ||
    value.route !== 'board_change' ||
    typeof value.requestId !== 'string' ||
    typeof value.inputDigest !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.body !== 'string' ||
    typeof value.titleId !== 'string' ||
    typeof value.bodyId !== 'string' ||
    !storedBounds
  ) {
    return null
  }
  const common = {
    algorithm: BOARD_PLACEMENT_ALGORITHM,
    artifactKind: 'native_card' as const,
    body: value.body,
    bodyId: value.bodyId,
    bounds: storedBounds,
    inputDigest: value.inputDigest,
    requestId: value.requestId,
    route: 'board_change' as const,
    title: value.title,
    titleId: value.titleId
  }
  if (value.version === 1) {
    return typeof value.anchorId === 'string'
      ? { ...common, anchorId: value.anchorId, version: 1 }
      : null
  }
  const placementTarget = freePlacementTarget(value.placementTarget)
  return placementTarget ? { ...common, placementTarget, version: 2 } : null
}

function freePlacementTarget(value: unknown): BoardFreePlacementTarget | null {
  if (!isUnknownRecord(value)) return null
  if (value.kind === 'auto') return { kind: 'auto' }
  if (value.kind === 'relative') {
    return typeof value.objectId === 'string' && value.objectId
      ? { kind: 'relative', objectId: value.objectId }
      : null
  }
  const { x, y } = value
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y)
  ) {
    return null
  }
  if (value.kind === 'point') return { kind: 'point', x, y }
  if (
    value.kind !== 'region' ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    value.width <= 0 ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height) ||
    value.height <= 0
  ) {
    return null
  }
  return { height: value.height, kind: 'region', width: value.width, x, y }
}

export function nativeReceiptMarker(node: SceneNode): NativeReceiptMarker | null {
  const hasTextMarker = node.pluginData.some(
    (entry) => entry.pluginId === RECEIPT_PLUGIN_ID && entry.key === TEXT_RECEIPT_PLUGIN_KEY
  )
  const hasCardMarker = node.pluginData.some(
    (entry) => entry.pluginId === RECEIPT_PLUGIN_ID && entry.key === CARD_RECEIPT_PLUGIN_KEY
  )
  if (hasTextMarker && hasCardMarker) {
    throw new Error('A native Board object has conflicting request receipt markers.')
  }
  if (hasTextMarker) {
    const marker = receiptEntry(node)
    if (!marker)
      throw new Error('A native Board request receipt is unreadable; mutation is blocked.')
    return {
      ...(marker.version === 2 ? { inputDigest: marker.inputDigest, route: marker.route } : {}),
      kind: 'native_text',
      requestId: marker.requestId,
      version: marker.version
    }
  }
  if (hasCardMarker) {
    const marker = cardReceiptEntry(node)
    if (!marker)
      throw new Error('A native Board request receipt is unreadable; mutation is blocked.')
    return {
      inputDigest: marker.inputDigest,
      kind: 'native_card',
      requestId: marker.requestId,
      route: marker.route,
      version: marker.version
    }
  }
  return null
}

export function requestNodes(target: AutomationTarget, requestId: string): SceneNode[] {
  return [...target.store.graph.getDescendants(target.pageId)].filter((node) => {
    const markerRequestIds = node.pluginData
      .filter(
        (entry) =>
          entry.pluginId === RECEIPT_PLUGIN_ID &&
          (entry.key === TEXT_RECEIPT_PLUGIN_KEY || entry.key === CARD_RECEIPT_PLUGIN_KEY)
      )
      .flatMap((entry) => {
        try {
          const value = JSON.parse(entry.value) as unknown
          return isUnknownRecord(value) && typeof value.requestId === 'string'
            ? [value.requestId]
            : []
        } catch {
          return []
        }
      })
    if (!markerRequestIds.includes(requestId)) return false
    const marker = nativeReceiptMarker(node)
    return marker?.requestId === requestId
  })
}
