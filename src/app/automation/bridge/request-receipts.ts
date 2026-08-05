import {
  objectGraphConnectionById,
  type PluginDataEntry,
  type SceneNode
} from '@open-pencil/scene-graph'

import { nodeSummary } from '@/app/automation/bridge/board-tools/readback'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'

const RECEIPT_LEDGER_LIMIT = 64
const RECEIPT_RESULT_LIMIT = 8_192
const RECEIPT_TOMBSTONE_LIMIT = 512
export const MUTATION_RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
export const MUTATION_RECEIPT_PLUGIN_KEY = 'mutation-receipts'

export type MutationRequestReceipt = {
  inputDigest: string
  mutationReceipt: StoredAppliedMutationReceipt
  objectIds: string[]
  requestId: string
  result?: unknown
  route: string
  semanticIds: string[]
  taskId?: string
  traceId?: string
  version: 1
}

export type StoredAppliedMutationReceipt = {
  appliedRevision: number
  enqueuedRevision: number
  expectedRevision: number
  requestId: string
  status: 'applied'
  taskId?: string
  touchedProperties: string[]
  traceId?: string
}

export type MutationRequestLedgerState =
  | { status: 'expired' }
  | { status: 'missing' }
  | { reservation: MutationRequestReservation; status: 'pending' }
  | { status: 'saturated' }
  | { receipt: MutationRequestReceipt; status: 'stored' }
  | { status: 'unreadable' }

export type MutationRequestReservation = {
  inputDigest: string
  requestId: string
  route: string
  version: 1
}

type MutationRequestLedgerEntry = MutationRequestReceipt | MutationRequestReservation

type MutationRequestTombstone = {
  requestId: string
  version: 1
}

type MutationRequestLedger = {
  receipts: MutationRequestReceipt[]
  reservations: MutationRequestReservation[]
  saturated: boolean
  tombstones: MutationRequestTombstone[]
  version: 3
}

const EMPTY_LEDGER: MutationRequestLedger = {
  receipts: [],
  reservations: [],
  saturated: false,
  tombstones: [],
  version: 3
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'))
  if (typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Mutation request inputs must contain only finite numbers.')
    }
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError('Mutation request inputs must be JSON-serializable.')
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Mutation request inputs must use plain JSON objects.')
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key.normalize('NFC'), item] as const)
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new TypeError('Mutation request inputs contain duplicate Unicode-normalized keys.')
  }
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function mutationRequestSignature(route: string, input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson({ input, route }))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${bytesToHex(new Uint8Array(hash))}`
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null
  return value
}

function parseReceipt(value: unknown): MutationRequestReceipt | null {
  if (!isUnknownRecord(value)) return null
  const objectIds = stringArray(value.objectIds)
  const semanticIds = stringArray(value.semanticIds)
  const mutationReceipt = parseAppliedMutationReceipt(value.mutationReceipt)
  if (
    value.version !== 1 ||
    typeof value.inputDigest !== 'string' ||
    !mutationReceipt ||
    !objectIds ||
    typeof value.requestId !== 'string' ||
    typeof value.route !== 'string' ||
    !semanticIds ||
    (value.taskId !== undefined && typeof value.taskId !== 'string') ||
    (value.traceId !== undefined && typeof value.traceId !== 'string')
  ) {
    return null
  }
  return {
    inputDigest: value.inputDigest,
    mutationReceipt,
    objectIds,
    requestId: value.requestId,
    ...(value.result === undefined ? {} : { result: value.result }),
    route: value.route,
    semanticIds,
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
    version: 1
  }
}

function parseAppliedMutationReceipt(value: unknown): StoredAppliedMutationReceipt | null {
  if (!isUnknownRecord(value)) return null
  const touchedProperties = stringArray(value.touchedProperties)
  if (
    !Number.isInteger(value.appliedRevision) ||
    !Number.isInteger(value.enqueuedRevision) ||
    !Number.isInteger(value.expectedRevision) ||
    typeof value.requestId !== 'string' ||
    value.status !== 'applied' ||
    !touchedProperties ||
    (value.taskId !== undefined && typeof value.taskId !== 'string') ||
    (value.traceId !== undefined && typeof value.traceId !== 'string')
  ) {
    return null
  }
  return {
    appliedRevision: value.appliedRevision as number,
    enqueuedRevision: value.enqueuedRevision as number,
    expectedRevision: value.expectedRevision as number,
    requestId: value.requestId,
    status: 'applied',
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    touchedProperties,
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {})
  }
}

function parseReceiptList(value: unknown): MutationRequestReceipt[] | null {
  if (!Array.isArray(value)) return null
  const parsed = value.map(parseReceipt)
  return parsed.some((receipt) => receipt === null)
    ? null
    : parsed.filter((receipt): receipt is MutationRequestReceipt => receipt !== null)
}

function parseTombstones(value: unknown): MutationRequestTombstone[] | null {
  if (!Array.isArray(value)) return null
  const tombstones: MutationRequestTombstone[] = []
  for (const item of value) {
    if (!isUnknownRecord(item) || item.version !== 1 || typeof item.requestId !== 'string') {
      return null
    }
    tombstones.push({ requestId: item.requestId, version: 1 })
  }
  return tombstones
}

function parseReservations(value: unknown): MutationRequestReservation[] | null {
  if (!Array.isArray(value)) return null
  const reservations: MutationRequestReservation[] = []
  for (const item of value) {
    if (
      !isUnknownRecord(item) ||
      item.version !== 1 ||
      typeof item.inputDigest !== 'string' ||
      typeof item.requestId !== 'string' ||
      typeof item.route !== 'string'
    ) {
      return null
    }
    reservations.push({
      inputDigest: item.inputDigest,
      requestId: item.requestId,
      route: item.route,
      version: 1
    })
  }
  return reservations
}

function hasUniqueRequestIds(ledger: MutationRequestLedger): boolean {
  const receiptIds = ledger.receipts.map((receipt) => receipt.requestId)
  const reservationIds = ledger.reservations.map((reservation) => reservation.requestId)
  const tombstoneIds = ledger.tombstones.map((tombstone) => tombstone.requestId)
  const allIds = [...receiptIds, ...reservationIds, ...tombstoneIds]
  return new Set(allIds).size === allIds.length
}

function parseLedger(serialized: string): MutationRequestLedger | null {
  try {
    const parsed: unknown = JSON.parse(serialized)
    const legacyReceipts = parseReceiptList(parsed)
    if (legacyReceipts) {
      const legacy: MutationRequestLedger = {
        receipts: legacyReceipts,
        reservations: [],
        saturated: false,
        tombstones: [],
        version: 3
      }
      return hasUniqueRequestIds(legacy) ? legacy : null
    }
    if (
      !isUnknownRecord(parsed) ||
      (parsed.version !== 2 && parsed.version !== 3) ||
      typeof parsed.saturated !== 'boolean'
    ) {
      return null
    }
    const receipts = parseReceiptList(parsed.receipts)
    const reservations = parsed.version === 2 ? [] : parseReservations(parsed.reservations)
    const tombstones = parseTombstones(parsed.tombstones)
    if (!receipts || !reservations || !tombstones) return null
    const ledger: MutationRequestLedger = {
      receipts,
      reservations,
      saturated: parsed.saturated,
      tombstones,
      version: 3
    }
    return hasUniqueRequestIds(ledger) ? ledger : null
  } catch {
    return null
  }
}

function ledgerEntries(page: Pick<SceneNode, 'pluginData'> | null | undefined): PluginDataEntry[] {
  return (
    page?.pluginData.filter(
      (entry) =>
        entry.pluginId === MUTATION_RECEIPT_PLUGIN_ID && entry.key === MUTATION_RECEIPT_PLUGIN_KEY
    ) ?? []
  )
}

function readLedger(
  page: Pick<SceneNode, 'pluginData'> | null | undefined
): { ledger: MutationRequestLedger; status: 'ready' } | { status: 'unreadable' } {
  const entries = ledgerEntries(page)
  if (entries.length === 0) return { ledger: structuredClone(EMPTY_LEDGER), status: 'ready' }
  if (entries.length !== 1) return { status: 'unreadable' }
  const ledger = parseLedger(entries[0].value)
  return ledger ? { ledger, status: 'ready' } : { status: 'unreadable' }
}

export function mutationRequestLedgerState(
  target: AutomationTarget,
  requestId: string
): MutationRequestLedgerState {
  const stored = readLedger(target.store.graph.getNode(target.pageId))
  if (stored.status === 'unreadable') return { status: 'unreadable' }
  const receipt = stored.ledger.receipts.find((candidate) => candidate.requestId === requestId)
  if (receipt) return { receipt, status: 'stored' }
  const reservation = stored.ledger.reservations.find(
    (candidate) => candidate.requestId === requestId
  )
  if (reservation) return { reservation, status: 'pending' }
  if (stored.ledger.tombstones.some((candidate) => candidate.requestId === requestId)) {
    return { status: 'expired' }
  }
  return { status: stored.ledger.saturated ? 'saturated' : 'missing' }
}

export function mutationRequestLedgerStatus(
  page: Pick<SceneNode, 'pluginData'> | null | undefined
) {
  const limits = {
    receipts: RECEIPT_LEDGER_LIMIT,
    reservations: RECEIPT_LEDGER_LIMIT,
    tombstones: RECEIPT_TOMBSTONE_LIMIT
  }
  const stored = readLedger(page)
  if (stored.status === 'unreadable') {
    return { limits, status: 'unreadable', usage: null }
  }
  return {
    limits,
    recent_transactions: stored.ledger.receipts
      .slice(-8)
      .reverse()
      .map((receipt) => ({ request_id: receipt.requestId, route: receipt.route })),
    status: stored.ledger.saturated ? 'saturated' : 'open',
    usage: {
      receipts: stored.ledger.receipts.length,
      reservations: stored.ledger.reservations.length,
      tombstones: stored.ledger.tombstones.length
    }
  }
}

export function mutationRequestLedgerError(
  requestId: string,
  status: Exclude<MutationRequestLedgerState['status'], 'missing' | 'stored'>
): Error {
  if (status === 'expired') {
    return new Error(
      `Request "${requestId}" is expired and cannot be reused. Use a new request ID for a new mutation.`
    )
  }
  if (status === 'saturated') {
    return new Error(
      'The Board request ledger is saturated and cannot prove that an unknown request ID is fresh.'
    )
  }
  if (status === 'pending') {
    return new Error(
      `Request "${requestId}" has an incomplete mutation outcome; inspect the Board and request receipt before retrying.`
    )
  }
  return new Error('The Board request ledger is unreadable; mutation is blocked.')
}

export function assertMutationRequestIdFresh(target: AutomationTarget, requestId: string): void {
  const state = mutationRequestLedgerState(target, requestId)
  if (state.status === 'missing') return
  if (state.status === 'stored') {
    throw new Error(`Request "${requestId}" was already applied.`)
  }
  throw mutationRequestLedgerError(requestId, state.status)
}

export function mutationRequestReceipts(
  page: Pick<SceneNode, 'pluginData'> | null | undefined
): MutationRequestReceipt[] {
  const stored = readLedger(page)
  if (stored.status === 'unreadable') {
    throw new Error('The Board request ledger is unreadable; mutation is blocked.')
  }
  return stored.ledger.receipts
}

export function mutationRequestReceiptsById(
  target: AutomationTarget,
  requestId: string
): MutationRequestReceipt[] {
  const state = mutationRequestLedgerState(target, requestId)
  if (state.status === 'stored') return [state.receipt]
  if (state.status === 'missing') return []
  throw mutationRequestLedgerError(requestId, state.status)
}

function boundedResult(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > RECEIPT_RESULT_LIMIT) return undefined
    return JSON.parse(serialized) as unknown
  } catch {
    return undefined
  }
}

function boundLedgerEntries(
  entries: MutationRequestLedgerEntry[],
  tombstones: MutationRequestTombstone[],
  saturated: boolean
): boolean {
  while (entries.length >= RECEIPT_LEDGER_LIMIT) {
    const expired = entries.shift()
    if (expired && !tombstones.some((item) => item.requestId === expired.requestId)) {
      tombstones.push({ requestId: expired.requestId, version: 1 })
    }
  }
  if (tombstones.length <= RECEIPT_TOMBSTONE_LIMIT) return saturated
  tombstones.splice(0, tombstones.length - RECEIPT_TOMBSTONE_LIMIT)
  return true
}

function receiptPluginData(
  page: Pick<SceneNode, 'pluginData'>,
  receipt: MutationRequestReceipt
): PluginDataEntry[] {
  const stored = readLedger(page)
  if (stored.status === 'unreadable') {
    throw new Error('The Board request ledger is unreadable; mutation is blocked.')
  }
  const receipts = stored.ledger.receipts.filter(
    (candidate) => candidate.requestId !== receipt.requestId
  )
  const reservations = stored.ledger.reservations.filter(
    (candidate) => candidate.requestId !== receipt.requestId
  )
  const tombstones = [...stored.ledger.tombstones]
  const saturated = boundLedgerEntries(receipts, tombstones, stored.ledger.saturated)
  const ledger: MutationRequestLedger = {
    receipts: [...receipts, receipt],
    reservations,
    saturated,
    tombstones,
    version: 3
  }
  return [
    ...page.pluginData.filter(
      (entry) =>
        !(
          entry.pluginId === MUTATION_RECEIPT_PLUGIN_ID && entry.key === MUTATION_RECEIPT_PLUGIN_KEY
        )
    ),
    {
      key: MUTATION_RECEIPT_PLUGIN_KEY,
      pluginId: MUTATION_RECEIPT_PLUGIN_ID,
      value: JSON.stringify(ledger)
    }
  ]
}

export function recordMutationRequestReceipt(
  target: AutomationTarget,
  receipt: MutationRequestReceipt
): MutationRequestReceipt {
  const page = target.store.graph.getNode(target.pageId)
  if (!page) throw new Error(`Board "${target.pageId}" disappeared before receipt storage.`)
  const state = mutationRequestLedgerState(target, receipt.requestId)
  if (state.status === 'stored') {
    if (
      state.receipt.inputDigest !== receipt.inputDigest ||
      state.receipt.route !== receipt.route
    ) {
      throw new Error(`Request "${receipt.requestId}" was already used for a different mutation.`)
    }
    return state.receipt
  }
  if (state.status === 'pending') {
    if (
      state.reservation.inputDigest !== receipt.inputDigest ||
      state.reservation.route !== receipt.route
    ) {
      throw new Error(`Request "${receipt.requestId}" was already used for a different mutation.`)
    }
  } else if (state.status !== 'missing') {
    throw mutationRequestLedgerError(receipt.requestId, state.status)
  }
  const result = boundedResult(receipt.result)
  const stored: MutationRequestReceipt = {
    ...receipt,
    ...(result === undefined ? {} : { result })
  }
  target.store.graph.updateNode(page.id, {
    pluginData: receiptPluginData(page, stored)
  })
  return stored
}

export function reserveMutationRequest(
  target: AutomationTarget,
  reservation: MutationRequestReservation
): MutationRequestReservation {
  const page = target.store.graph.getNode(target.pageId)
  if (!page) throw new Error(`Board "${target.pageId}" disappeared before request reservation.`)
  const state = mutationRequestLedgerState(target, reservation.requestId)
  if (state.status !== 'missing') {
    if (
      state.status === 'pending' &&
      (state.reservation.inputDigest !== reservation.inputDigest ||
        state.reservation.route !== reservation.route)
    ) {
      throw new Error(
        `Request "${reservation.requestId}" was already used for a different mutation.`
      )
    }
    if (state.status === 'stored') {
      throw new Error(`Request "${reservation.requestId}" was already applied.`)
    }
    throw mutationRequestLedgerError(reservation.requestId, state.status)
  }
  const stored = readLedger(page)
  if (stored.status === 'unreadable') {
    throw new Error('The Board request ledger is unreadable; mutation is blocked.')
  }
  const reservations = [...stored.ledger.reservations]
  const tombstones = [...stored.ledger.tombstones]
  const saturated = boundLedgerEntries(reservations, tombstones, stored.ledger.saturated)
  const ledger: MutationRequestLedger = {
    receipts: stored.ledger.receipts,
    reservations: [...reservations, reservation],
    saturated,
    tombstones,
    version: 3
  }
  target.store.graph.updateNode(page.id, {
    pluginData: [
      ...page.pluginData.filter(
        (entry) =>
          !(
            entry.pluginId === MUTATION_RECEIPT_PLUGIN_ID &&
            entry.key === MUTATION_RECEIPT_PLUGIN_KEY
          )
      ),
      {
        key: MUTATION_RECEIPT_PLUGIN_KEY,
        pluginId: MUTATION_RECEIPT_PLUGIN_ID,
        value: JSON.stringify(ledger)
      }
    ]
  })
  return reservation
}

export function mutationRequestLedgerSnapshot(
  page: Pick<SceneNode, 'pluginData'> | null | undefined
): PluginDataEntry | null {
  const entries = ledgerEntries(page)
  if (entries.length > 1) {
    throw new Error('The Board request ledger is unreadable; mutation is blocked.')
  }
  return entries[0] ? structuredClone(entries[0]) : null
}

export function restoreMutationRequestLedger(
  target: AutomationTarget,
  snapshot: PluginDataEntry | null
): void {
  const page = target.store.graph.getNode(target.pageId)
  if (!page) throw new Error(`Board "${target.pageId}" disappeared during history replay.`)
  target.store.graph.updateNode(page.id, {
    pluginData: [
      ...page.pluginData.filter(
        (entry) =>
          !(
            entry.pluginId === MUTATION_RECEIPT_PLUGIN_ID &&
            entry.key === MUTATION_RECEIPT_PLUGIN_KEY
          )
      ),
      ...(snapshot ? [structuredClone(snapshot)] : [])
    ]
  })
}

export function mutationRequestReadback(
  target: AutomationTarget,
  receipt: MutationRequestReceipt
): Record<string, unknown> {
  const nodes = receipt.objectIds.map((id) => {
    const node = target.store.graph.getNode(id)
    return node ? nodeSummary(target, node) : { id, missing: true }
  })
  const connections = receipt.semanticIds.map(
    (id) =>
      objectGraphConnectionById(target.store.graph, target.pageId, id) ?? {
        id,
        missing: true
      }
  )
  return {
    nodes,
    ...(connections.length > 0 ? { object_graph_connections: connections } : {}),
    ...(receipt.result === undefined ? {} : { result: receipt.result })
  }
}
