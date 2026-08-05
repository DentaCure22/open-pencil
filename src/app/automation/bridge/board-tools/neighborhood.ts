import { IS_BROWSER } from '@open-pencil/core/constants'
import { computeAbsoluteBounds, type Rect, type SceneNode } from '@open-pencil/scene-graph'

import {
  targetToResult,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import { editorViewportInsets, visibleElementRect } from '@/app/editor/viewport-insets'

import { nodeBounds } from './readback'

export const BOARD_CONTEXT_BYTE_LIMIT = 32_768
export const BOARD_NEIGHBORHOOD_BYTE_LIMIT = 12_288
export const BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT = 512
export const BOARD_CONTEXT_STRING_SCAN_CODE_UNIT_LIMIT = 4_096

const CONTEXT_SELECTION_BYTE_LIMIT = 8_192
const CONTEXT_SELECTION_LIMIT = 25
const MAX_PAGE_OWNED_ANCESTOR_DEPTH = 64
const NEIGHBORHOOD_LIMIT = 12
const NODE_NAME_BYTE_LIMIT = 256
const NODE_TEXT_BYTE_LIMIT = 512
const TARGET_NAME_BYTE_LIMIT = 512
const TARGET_PATH_BYTE_LIMIT = 1_024
const UTF8_ENCODER = new TextEncoder()

type NeighborhoodBasis = 'selection' | 'viewport'

type CompactNodeSummary = ReturnType<typeof compactNodeSummary>

type NeighborhoodCandidate = {
  distance: number
  node: SceneNode
  selectedOwner: boolean
}

type PayloadOmissions = {
  childIds: number
  nameBytes: number | null
  nameCodeUnits: number
  textBytes: number | null
  textCodeUnits: number
}

type PageRootScan = {
  child_count: number
  limit: number
  sampled: number
  selected_owner_supplements: number
  strategy: 'evenly-spaced-plus-selected/v1'
  unscanned: number
}

export function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).length
}

export function jsonUtf8ByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value, null, 2))
}

function unicodeScalar(value: string): string {
  if (value.length !== 1) return value
  const code = value.charCodeAt(0)
  return code >= 0xd800 && code <= 0xdfff ? '\uFFFD' : value
}

function boundedUtf8String(value: string, byteLimit: number) {
  const sourceCodeUnits = value.length
  let scanCodeUnits = Math.min(sourceCodeUnits, BOARD_CONTEXT_STRING_SCAN_CODE_UNIT_LIMIT)
  if (
    scanCodeUnits < sourceCodeUnits &&
    scanCodeUnits > 0 &&
    /[\uD800-\uDBFF]/.test(value[scanCodeUnits - 1] ?? '') &&
    /[\uDC00-\uDFFF]/.test(value[scanCodeUnits] ?? '')
  ) {
    scanCodeUnits--
  }
  const scanWindow = value.slice(0, scanCodeUnits)
  const result: string[] = []
  let payloadBytes = 0
  let payloadCodeUnits = 0
  for (const rawScalar of scanWindow) {
    const scalar = unicodeScalar(rawScalar)
    const scalarBytes = utf8ByteLength(scalar)
    if (payloadBytes + scalarBytes > byteLimit) break
    result.push(scalar)
    payloadBytes += scalarBytes
    payloadCodeUnits += rawScalar.length
  }
  const omittedCodeUnits = sourceCodeUnits - payloadCodeUnits
  const sourceFullyScanned = scanCodeUnits === sourceCodeUnits
  const sourceBytes = sourceFullyScanned ? utf8ByteLength(value) : null
  return {
    omittedBytes: sourceBytes === null ? null : Math.max(0, sourceBytes - payloadBytes),
    omittedCodeUnits,
    payloadBytes,
    scanTruncated: !sourceFullyScanned,
    truncated: omittedCodeUnits > 0,
    value: result.join('')
  }
}

function stableMeasuredPayload<T>(create: (payloadBytes: number) => T): T {
  let payloadBytes = 0
  for (let iteration = 0; iteration < 16; iteration++) {
    const value = create(payloadBytes)
    const measured = jsonUtf8ByteLength(value)
    if (measured === payloadBytes) return value
    payloadBytes = measured
  }
  throw new Error('Board context payload byte measurement did not converge.')
}

export function boardViewportFocusBounds(target: AutomationTarget): Rect {
  const canReadDocument =
    typeof document !== 'undefined' && typeof document.querySelector === 'function'
  const canvas = canReadDocument ? visibleElementRect('[data-test-id="canvas-area"]') : null
  const width = canvas?.width ?? (IS_BROWSER ? window.innerWidth : 800)
  const height = canvas?.height ?? (IS_BROWSER ? window.innerHeight : 600)
  const insets = canReadDocument ? editorViewportInsets() : {}
  const left = Math.max(0, insets.left ?? 0)
  const right = Math.max(0, insets.right ?? 0)
  const top = Math.max(0, insets.top ?? 0)
  const bottom = Math.max(0, insets.bottom ?? 0)
  const topLeft = target.store.screenToCanvas(left, top)
  const bottomRight = target.store.screenToCanvas(
    Math.max(left + 1, width - right),
    Math.max(top + 1, height - bottom)
  )
  return {
    height: Math.abs(bottomRight.y - topLeft.y),
    width: Math.abs(bottomRight.x - topLeft.x),
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y)
  }
}

function focusBounds(
  target: AutomationTarget,
  selectedIds: readonly string[]
): { basis: NeighborhoodBasis; bounds: Rect } {
  const selectedNodes = selectedIds.flatMap((id) => {
    const node = target.store.graph.getNode(id)
    return node ? [node] : []
  })
  if (selectedNodes.length === 0) {
    return { basis: 'viewport', bounds: boardViewportFocusBounds(target) }
  }
  return {
    basis: 'selection',
    bounds: computeAbsoluteBounds(selectedNodes, (id) => target.store.graph.getAbsolutePosition(id))
  }
}

export function pageOwnedAncestorId(target: AutomationTarget, nodeId: string): string | null {
  const visited = new Set<string>()
  let current = target.store.graph.getNode(nodeId)
  for (let depth = 0; current && depth < MAX_PAGE_OWNED_ANCESTOR_DEPTH; depth++) {
    if (visited.has(current.id)) return null
    visited.add(current.id)
    if (current.parentId === target.pageId) return current.id
    current = current.parentId ? target.store.graph.getNode(current.parentId) : undefined
  }
  return null
}

function boundsDistance(first: Rect, second: Rect): number {
  const horizontal = Math.max(
    first.x - (second.x + second.width),
    second.x - (first.x + first.width),
    0
  )
  const vertical = Math.max(
    first.y - (second.y + second.height),
    second.y - (first.y + first.height),
    0
  )
  return Math.hypot(horizontal, vertical)
}

function compactNodeSummary(target: AutomationTarget, node: SceneNode, distance?: number) {
  const name = boundedUtf8String(node.name, NODE_NAME_BYTE_LIMIT)
  const text = node.type === 'TEXT' ? boundedUtf8String(node.text, NODE_TEXT_BYTE_LIMIT) : null
  return {
    bounds: nodeBounds(target, node),
    child_count: node.childIds.length,
    child_ids_omitted: node.childIds.length,
    ...(distance === undefined ? {} : { distance_from_focus: distance }),
    id: node.id,
    name: name.value,
    name_omitted_bytes: name.omittedBytes,
    name_omitted_code_units: name.omittedCodeUnits,
    name_scan_truncated: name.scanTruncated,
    name_truncated: name.truncated,
    parent_id: node.parentId,
    ...(text
      ? {
          text_preview: text.value,
          text_preview_omitted_bytes: text.omittedBytes,
          text_preview_omitted_code_units: text.omittedCodeUnits,
          text_preview_scan_truncated: text.scanTruncated,
          text_truncated: text.truncated
        }
      : {}),
    type: node.type,
    visible: node.visible
  }
}

function compactMissingNodeSummary(id: string) {
  return { id, missing: true as const }
}

function summaryOmissions(nodes: readonly CompactNodeSummary[]): PayloadOmissions {
  return nodes.reduce<PayloadOmissions>(
    (total, node) => {
      const textBytes =
        'text_preview_omitted_bytes' in node ? (node.text_preview_omitted_bytes ?? null) : 0
      return {
        childIds: total.childIds + node.child_ids_omitted,
        nameBytes:
          total.nameBytes === null || node.name_omitted_bytes === null
            ? null
            : total.nameBytes + node.name_omitted_bytes,
        nameCodeUnits: total.nameCodeUnits + node.name_omitted_code_units,
        textBytes:
          total.textBytes === null || textBytes === null ? null : total.textBytes + textBytes,
        textCodeUnits:
          total.textCodeUnits +
          ('text_preview_omitted_code_units' in node
            ? (node.text_preview_omitted_code_units ?? 0)
            : 0)
      }
    },
    { childIds: 0, nameBytes: 0, nameCodeUnits: 0, textBytes: 0, textCodeUnits: 0 }
  )
}

function neighborhoodPayload(
  focus: { basis: NeighborhoodBasis; bounds: Rect },
  nodes: readonly CompactNodeSummary[],
  candidateCount: number,
  pageRootScan: PageRootScan
) {
  const omitted = summaryOmissions(nodes)
  const omittedNodes = candidateCount - nodes.length
  return stableMeasuredPayload((payloadBytes) => ({
    basis: focus.basis,
    byte_limit: BOARD_NEIGHBORHOOD_BYTE_LIMIT,
    focus_bounds: focus.bounds,
    limit: NEIGHBORHOOD_LIMIT,
    nodes,
    omitted: {
      child_ids: omitted.childIds,
      name_bytes: omitted.nameBytes,
      name_code_units: omitted.nameCodeUnits,
      nodes: omittedNodes,
      text_bytes: omitted.textBytes,
      text_code_units: omitted.textCodeUnits,
      unscanned_page_root_children: pageRootScan.unscanned
    },
    page_owned_candidate_count: candidateCount,
    page_owned_candidate_count_exact: pageRootScan.unscanned === 0,
    page_root_scan: pageRootScan,
    payload_bytes: payloadBytes,
    policy: 'bounded-nearest-page-owned/v2' as const,
    returned: nodes.length,
    string_limits: {
      name_bytes: NODE_NAME_BYTE_LIMIT,
      scan_code_units: BOARD_CONTEXT_STRING_SCAN_CODE_UNIT_LIMIT,
      text_preview_bytes: NODE_TEXT_BYTE_LIMIT
    },
    truncated:
      omittedNodes > 0 ||
      pageRootScan.unscanned > 0 ||
      omitted.childIds > 0 ||
      omitted.nameCodeUnits > 0 ||
      omitted.textCodeUnits > 0
  }))
}

function evenlySpacedIds(ids: readonly string[], limit: number): string[] {
  if (ids.length <= limit) return [...ids]
  if (limit === 1) return [ids[0]].filter((id): id is string => typeof id === 'string')
  const sampled: string[] = []
  for (let index = 0; index < limit; index++) {
    const sourceIndex = Math.floor((index * (ids.length - 1)) / (limit - 1))
    sampled.push(ids[sourceIndex])
  }
  return sampled
}

function pageRootCandidateScan(
  target: AutomationTarget,
  selectedOwners: ReadonlySet<string>
): { nodes: SceneNode[]; scan: PageRootScan } {
  const page = target.store.graph.getNode(target.pageId)
  const childIds = page?.childIds ?? []
  const sampledIds = evenlySpacedIds(childIds, BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT)
  const inspectedIds = new Set(sampledIds)
  let selectedOwnerSupplements = 0
  for (const ownerId of selectedOwners) {
    if (inspectedIds.has(ownerId)) continue
    const owner = target.store.graph.getNode(ownerId)
    if (!owner || owner.parentId !== target.pageId) continue
    inspectedIds.add(ownerId)
    selectedOwnerSupplements++
  }
  return {
    nodes: [...inspectedIds].flatMap((id) => {
      const node = target.store.graph.getNode(id)
      return node ? [node] : []
    }),
    scan: {
      child_count: childIds.length,
      limit: BOARD_NEIGHBORHOOD_PAGE_ROOT_SCAN_LIMIT,
      sampled: sampledIds.length,
      selected_owner_supplements: selectedOwnerSupplements,
      strategy: 'evenly-spaced-plus-selected/v1',
      unscanned: Math.max(0, childIds.length - inspectedIds.size)
    }
  }
}

export function boardNeighborhoodSnapshot(
  target: AutomationTarget,
  selectedIds: readonly string[]
) {
  const boundedSelectedIds = selectedIds.slice(0, CONTEXT_SELECTION_LIMIT)
  const focus = focusBounds(target, boundedSelectedIds)
  const selectedOwners = new Set(
    boundedSelectedIds.flatMap((id) => {
      const ownerId = pageOwnedAncestorId(target, id)
      return ownerId ? [ownerId] : []
    })
  )
  const pageRoot = pageRootCandidateScan(target, selectedOwners)
  const candidates = pageRoot.nodes
    .filter((node) => node.visible && node.width > 0 && node.height > 0)
    .map((node): NeighborhoodCandidate => {
      const bounds = nodeBounds(target, node)
      return {
        distance: boundsDistance(focus.bounds, bounds),
        node,
        selectedOwner: selectedOwners.has(node.id)
      }
    })
    .sort(
      (first, second) =>
        Number(second.selectedOwner) - Number(first.selectedOwner) ||
        first.distance - second.distance ||
        first.node.id.localeCompare(second.node.id)
    )
  const included: CompactNodeSummary[] = []
  for (const candidate of candidates.slice(0, NEIGHBORHOOD_LIMIT)) {
    const summary = compactNodeSummary(target, candidate.node, candidate.distance)
    const proposed = neighborhoodPayload(
      focus,
      [...included, summary],
      candidates.length,
      pageRoot.scan
    )
    if (jsonUtf8ByteLength(proposed) <= BOARD_NEIGHBORHOOD_BYTE_LIMIT) included.push(summary)
  }
  const result = neighborhoodPayload(focus, included, candidates.length, pageRoot.scan)
  if (jsonUtf8ByteLength(result) > BOARD_NEIGHBORHOOD_BYTE_LIMIT) {
    throw new Error('Board neighborhood exceeded its hard byte limit.')
  }
  return result
}

function selectionPayload(
  nodes: ReadonlyArray<CompactNodeSummary | ReturnType<typeof compactMissingNodeSummary>>,
  selectedCount: number
) {
  const compactNodes = nodes.filter((node): node is CompactNodeSummary => !('missing' in node))
  const omitted = summaryOmissions(compactNodes)
  const omittedNodes = selectedCount - nodes.length
  return stableMeasuredPayload((payloadBytes) => ({
    selection: nodes,
    selection_summary: {
      byte_limit: CONTEXT_SELECTION_BYTE_LIMIT,
      count: selectedCount,
      limit: CONTEXT_SELECTION_LIMIT,
      omitted: {
        child_ids: omitted.childIds,
        name_bytes: omitted.nameBytes,
        name_code_units: omitted.nameCodeUnits,
        nodes: omittedNodes,
        text_bytes: omitted.textBytes,
        text_code_units: omitted.textCodeUnits
      },
      payload_bytes: payloadBytes,
      returned: nodes.length,
      truncated:
        omittedNodes > 0 ||
        omitted.childIds > 0 ||
        omitted.nameCodeUnits > 0 ||
        omitted.textCodeUnits > 0
    }
  }))
}

export function boardContextSelectionSnapshot(
  target: AutomationTarget,
  selectedIds: readonly string[]
) {
  const included: Array<CompactNodeSummary | ReturnType<typeof compactMissingNodeSummary>> = []
  for (const id of selectedIds.slice(0, CONTEXT_SELECTION_LIMIT)) {
    const node = target.store.graph.getNode(id)
    const summary = node ? compactNodeSummary(target, node) : compactMissingNodeSummary(id)
    const proposed = selectionPayload([...included, summary], selectedIds.length)
    if (jsonUtf8ByteLength(proposed) <= CONTEXT_SELECTION_BYTE_LIMIT) included.push(summary)
  }
  const result = selectionPayload(included, selectedIds.length)
  if (jsonUtf8ByteLength(result) > CONTEXT_SELECTION_BYTE_LIMIT) {
    throw new Error('Board context selection exceeded its hard byte limit.')
  }
  return result
}

export function boardContextTargetSnapshot(target: AutomationTarget) {
  const raw = targetToResult(target)
  const documentName = boundedUtf8String(raw.documentName, TARGET_NAME_BYTE_LIMIT)
  const pageName = boundedUtf8String(raw.pageName, TARGET_NAME_BYTE_LIMIT)
  const path = raw.path ? boundedUtf8String(raw.path, TARGET_PATH_BYTE_LIMIT) : null
  const omittedBytes = [documentName.omittedBytes, pageName.omittedBytes, path?.omittedBytes ?? 0]
  return {
    omittedBytes: omittedBytes.includes(null)
      ? null
      : omittedBytes.reduce<number>((total, value) => total + (value ?? 0), 0),
    omittedCodeUnits:
      documentName.omittedCodeUnits + pageName.omittedCodeUnits + (path?.omittedCodeUnits ?? 0),
    target: {
      ...raw,
      documentName: documentName.value,
      pageName: pageName.value,
      ...(path ? { path: path.value } : {})
    }
  }
}

export function finalizeBoardContext(
  context: UnknownRecord,
  omissions: {
    neighborhoodNodes: number
    neighborhoodUnscannedPageRootChildren: number
    selectionNodes: number
    targetStringBytes: number | null
    targetStringCodeUnits: number
    truncated: boolean
  }
) {
  const result = stableMeasuredPayload((payloadBytes) => ({
    ...context,
    context_payload: {
      byte_limit: BOARD_CONTEXT_BYTE_LIMIT,
      omitted: {
        neighborhood_nodes: omissions.neighborhoodNodes,
        neighborhood_unscanned_page_root_children: omissions.neighborhoodUnscannedPageRootChildren,
        selection_nodes: omissions.selectionNodes,
        target_string_bytes: omissions.targetStringBytes,
        target_string_code_units: omissions.targetStringCodeUnits
      },
      payload_bytes: payloadBytes,
      truncated: omissions.truncated || omissions.targetStringCodeUnits > 0
    }
  }))
  if (jsonUtf8ByteLength(result) > BOARD_CONTEXT_BYTE_LIMIT) {
    throw new Error(
      'Board context exceeds its hard byte limit after bounded selection and neighborhood compaction.'
    )
  }
  return result
}
