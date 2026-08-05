import { randomBytes } from 'node:crypto'

import {
  canAddObjectGraphConnection,
  OBJECT_GRAPH_SCHEMA_VERSION,
  objectGraphConnectionById,
  objectGraphConnectionsForNode,
  objectGraphConnectionsOnPage,
  parseObjectGraphConnection,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type ObjectGraphConnectionKind,
  type ObjectGraphPermission,
  type ObjectGraphPortSide,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument,
  type AuthorityBoardDocument
} from './document'
import { authorityMutationInputDigest } from './request-digest'
import type { LocalWorkspaceAuthorityStore } from './store'
import type { LocalWorkspaceAuthorityHead } from './types'

const EXECUTION_SURFACE = 'local_workspace_authority'
const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const RECEIPT_KEY_PREFIX = 'authority-connection-request:'
const MAX_CONNECTIONS_PER_OBJECT = 64

type JsonRecord = Record<string, unknown>
type AuthorityConnectionInput = {
  automatic?: boolean
  kind: ObjectGraphConnectionKind
  label?: string
  sourceNodeId: string
  sourcePort?: ObjectGraphPortSide
  sourcePortId?: string
  targetNodeId: string
  targetPort?: ObjectGraphPortSide
  targetPortId?: string
}
type AuthorityConnectionReceipt = {
  appliedRevision: number
  baseRevision: number
  connection: ObjectGraphConnection
  inputDigest: string
  pageId: string
  requestId: string
  route: 'connect_objects'
  taskId?: string
  traceId?: string
  version: 1
}
type ResolvedAuthorityContext = {
  current: boolean
  document: AuthorityBoardDocument
  head: LocalWorkspaceAuthorityHead
  page: SceneNode
}
type AuthorityConnectionOutcome = {
  head: LocalWorkspaceAuthorityHead
  page: SceneNode
  result: JsonRecord
}
type IssueAuthorityContext = (
  head: LocalWorkspaceAuthorityHead,
  page: SceneNode,
  document: AuthorityBoardDocument
) => unknown

const CONNECT_OBJECTS_FIELDS = new Set([
  'automatic',
  'content_document_id',
  'context_token',
  'document_id',
  'expected_revision',
  'kind',
  'label',
  'page_id',
  'request_id',
  'runtime_instance_id',
  'source_id',
  'source_port',
  'target_id',
  'target_port',
  'task_id',
  'trace_id',
  'workspace_id'
])

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

export function normalizeAuthorityRpcArgs(body: JsonRecord): JsonRecord {
  const args = isRecord(body.args) ? body.args : {}
  if (!isRecord(args.base)) return args
  const { base, ...logical } = args
  return { ...base, ...logical }
}

function connectionKind(value: string): ObjectGraphConnectionKind {
  if (value === 'action' || value === 'data' || value === 'visual') return value
  throw new Error('connect_objects kind must be "visual", "data", or "action".')
}

const PORT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u

function connectionPort(
  value: string | undefined,
  field: string
): {
  id?: string
  side?: ObjectGraphPortSide
} {
  if (value === undefined) return {}
  if (
    value === 'auto' ||
    value === 'bottom' ||
    value === 'left' ||
    value === 'right' ||
    value === 'top'
  ) {
    return { side: value }
  }
  if (PORT_ID_PATTERN.test(value)) return { id: value, side: 'auto' }
  throw new Error(`${field} must be a side or stable named port ID.`)
}

function parseConnectionInput(args: JsonRecord): AuthorityConnectionInput {
  const unsupported = Object.keys(args)
    .filter((field) => !CONNECT_OBJECTS_FIELDS.has(field))
    .sort()
  if (unsupported.length > 0) {
    throw new Error(`connect_objects received unsupported fields: ${unsupported.join(', ')}.`)
  }
  if (args.automatic !== undefined && typeof args.automatic !== 'boolean') {
    throw new Error('connect_objects automatic must be a boolean.')
  }
  const kind = connectionKind(requiredString(args, 'kind'))
  if (kind === 'visual' && args.automatic === true) {
    throw new Error(
      'connect_objects visual connections cannot be automatic. Omit automatic or set it to false.'
    )
  }
  if (kind !== 'visual' && typeof args.automatic !== 'boolean') {
    throw new Error(
      'connect_objects requires explicit automatic true or false for data and action connections.'
    )
  }
  const label = optionalString(args, 'label')
  const sourcePort = connectionPort(optionalString(args, 'source_port'), 'source_port')
  const targetPort = connectionPort(optionalString(args, 'target_port'), 'target_port')
  return {
    ...(typeof args.automatic === 'boolean' ? { automatic: args.automatic } : {}),
    kind,
    ...(label ? { label } : {}),
    sourceNodeId: requiredString(args, 'source_id'),
    ...(sourcePort.side ? { sourcePort: sourcePort.side } : {}),
    ...(sourcePort.id ? { sourcePortId: sourcePort.id } : {}),
    targetNodeId: requiredString(args, 'target_id'),
    ...(targetPort.side ? { targetPort: targetPort.side } : {}),
    ...(targetPort.id ? { targetPortId: targetPort.id } : {})
  }
}

function connectionPermissions(kind: ObjectGraphConnectionKind): ObjectGraphPermission[] {
  if (kind === 'action') return ['target.action.execute']
  if (kind === 'data') return ['target.data.write']
  return []
}

function createConnection(input: AuthorityConnectionInput): ObjectGraphConnection {
  return {
    automatic: input.automatic ?? input.kind !== 'visual',
    id: `object-connection:${randomBytes(8).toString('hex')}`,
    kind: input.kind,
    label: (input.label?.trim() || input.kind).slice(0, 80),
    permissions: connectionPermissions(input.kind),
    schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
    sourceNodeId: input.sourceNodeId,
    sourcePort: input.sourcePort ?? 'auto',
    ...(input.sourcePortId ? { sourcePortId: input.sourcePortId } : {}),
    targetNodeId: input.targetNodeId,
    targetPort: input.targetPort ?? 'auto',
    ...(input.targetPortId ? { targetPortId: input.targetPortId } : {})
  }
}

function receiptFromEntry(entry: { key: string; value: string }): AuthorityConnectionReceipt {
  try {
    const value: unknown = JSON.parse(entry.value)
    if (!isRecord(value)) throw new Error('not an object')
    const connection = parseObjectGraphConnection(value.connection)
    if (
      value.version !== 1 ||
      value.route !== 'connect_objects' ||
      typeof value.appliedRevision !== 'number' ||
      typeof value.baseRevision !== 'number' ||
      !connection ||
      typeof value.inputDigest !== 'string' ||
      typeof value.pageId !== 'string' ||
      typeof value.requestId !== 'string' ||
      (value.taskId !== undefined && typeof value.taskId !== 'string') ||
      (value.traceId !== undefined && typeof value.traceId !== 'string')
    ) {
      throw new Error('invalid fields')
    }
    return {
      appliedRevision: value.appliedRevision,
      baseRevision: value.baseRevision,
      connection,
      inputDigest: value.inputDigest,
      pageId: value.pageId,
      requestId: value.requestId,
      route: 'connect_objects',
      ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
      ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {}),
      version: 1
    }
  } catch {
    throw new Error(`Connection receipt "${entry.key}" is unreadable.`)
  }
}

function connectionReceiptsOnPage(page: SceneNode): AuthorityConnectionReceipt[] {
  return page.pluginData
    .filter(
      (entry) => entry.pluginId === RECEIPT_PLUGIN_ID && entry.key.startsWith(RECEIPT_KEY_PREFIX)
    )
    .map(receiptFromEntry)
}

function connectionRequestMatches(
  document: AuthorityBoardDocument,
  requestId: string
): Array<{ page: SceneNode; receipt: AuthorityConnectionReceipt }> {
  return document.graph.getPages(true).flatMap((page) =>
    connectionReceiptsOnPage(page)
      .filter((receipt) => receipt.requestId === requestId)
      .map((receipt) => ({ page, receipt }))
  )
}

function addConnectionReceipt(page: SceneNode, receipt: AuthorityConnectionReceipt): void {
  page.pluginData.push({
    key: `${RECEIPT_KEY_PREFIX}${receipt.requestId}`,
    pluginId: RECEIPT_PLUGIN_ID,
    value: JSON.stringify(receipt)
  })
}

function sameConnection(left: ObjectGraphConnection, right: ObjectGraphConnection): boolean {
  return (
    left.automatic === right.automatic &&
    left.id === right.id &&
    left.kind === right.kind &&
    left.label === right.label &&
    left.permissions.length === right.permissions.length &&
    left.permissions.every((permission, index) => permission === right.permissions[index]) &&
    left.sourceNodeId === right.sourceNodeId &&
    left.sourcePort === right.sourcePort &&
    left.targetNodeId === right.targetNodeId &&
    left.targetPort === right.targetPort
  )
}

function connectionLiveStatus(
  document: AuthorityBoardDocument,
  pageId: string,
  receipt: AuthorityConnectionReceipt
): 'diverged' | 'missing' | 'present' {
  const connection = objectGraphConnectionById(document.graph, pageId, receipt.connection.id)
  if (!connection) return 'missing'
  return sameConnection(connection, receipt.connection) &&
    canAddObjectGraphConnection(document.graph, pageId, connection, connection.id)
    ? 'present'
    : 'diverged'
}

function historicalReason(status: 'diverged' | 'missing' | 'present'): string {
  if (status === 'missing') return 'historical_receipt_only'
  if (status === 'diverged') return 'historical_receipt_diverged'
  return 'no_live_runtime'
}

function semanticReadback(
  document: AuthorityBoardDocument,
  pageId: string,
  receipt: AuthorityConnectionReceipt
) {
  const current = objectGraphConnectionById(document.graph, pageId, receipt.connection.id)
  const liveStatus = connectionLiveStatus(document, pageId, receipt)
  return {
    connection_liveness: { current: liveStatus, historical: 'applied' },
    object_graph_connection: current ?? { id: receipt.connection.id, missing: true }
  }
}

function persistence(head: LocalWorkspaceAuthorityHead) {
  return {
    authority_id: head.authorityId,
    authority_revision: head.revision,
    content_hash: head.contentHash,
    status: 'durable',
    target: EXECUTION_SURFACE
  }
}

function replayResult(
  document: AuthorityBoardDocument,
  head: LocalWorkspaceAuthorityHead,
  page: SceneNode,
  receipt: AuthorityConnectionReceipt,
  issueContext: IssueAuthorityContext
): JsonRecord {
  const readback = semanticReadback(document, page.id, receipt)
  const liveStatus = readback.connection_liveness.current
  return {
    context: issueContext(head, page, document),
    execution_surface: EXECUTION_SURFACE,
    persistence: persistence(head),
    presentation: { reason: 'no_live_runtime', status: 'unavailable' },
    proof: {
      durable_readback: liveStatus === 'present' ? 'passed' : 'historical_only',
      normal_editor_undo: 'unavailable',
      pixels: 'not_evaluated',
      reason: historicalReason(liveStatus)
    },
    readback,
    receipt: {
      appliedRevision: receipt.appliedRevision,
      baseRevision: receipt.baseRevision,
      historical_only: liveStatus !== 'present',
      idempotent_replay: true,
      input_digest: receipt.inputDigest,
      live_status: liveStatus,
      requestId: receipt.requestId,
      status: 'applied'
    },
    status: {
      attention_required: true,
      command: 'unavailable',
      mutation: 'replayed',
      reason: historicalReason(liveStatus)
    }
  }
}

function committedPage(document: AuthorityBoardDocument, pageId: string): SceneNode {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error('Committed connection Board is missing.')
  return page
}

function expectedRevision(args: JsonRecord, current: number): number {
  const value = args.expected_revision
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('connect_objects requires a non-negative expected_revision.')
  }
  if (value !== current) {
    throw new Error('Board revision is stale. Reacquire context before changing the Board.')
  }
  return value
}

export async function connectAuthorityObjects(options: {
  args: JsonRecord
  issueContext: IssueAuthorityContext
  resolved: ResolvedAuthorityContext
  store: LocalWorkspaceAuthorityStore
}): Promise<AuthorityConnectionOutcome> {
  const { args, issueContext, resolved, store } = options
  const { current, document, head, page } = resolved
  const requestId = requiredString(args, 'request_id')
  const input = parseConnectionInput(args)
  const taskId = optionalString(args, 'task_id')
  const traceId = optionalString(args, 'trace_id')
  const inputDigest = authorityMutationInputDigest('connect_objects', {
    input,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  })
  const matches = connectionRequestMatches(document, requestId)
  if (matches.length > 1) throw new Error(`Request "${requestId}" is ambiguous.`)
  if (matches.length === 1) {
    const match = matches[0]
    if (match.page.id !== page.id || match.receipt.inputDigest !== inputDigest) {
      throw new Error(`Request "${requestId}" was already used for a different mutation.`)
    }
    return {
      head,
      page,
      result: replayResult(document, head, page, match.receipt, issueContext)
    }
  }
  if (!current) {
    throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
  }
  const baseRevision = expectedRevision(args, head.revision)
  if (
    objectGraphConnectionsForNode(document.graph, page.id, input.sourceNodeId).length >=
    MAX_CONNECTIONS_PER_OBJECT
  ) {
    throw new Error('The Object Graph source endpoint has reached its connection limit.')
  }
  const connection = createConnection(input)
  if (!canAddObjectGraphConnection(document.graph, page.id, connection)) {
    throw new Error(
      'The Object Graph connection was refused. Confirm distinct current-page endpoints, supported ports, and that the same connection does not already exist.'
    )
  }
  const connections = objectGraphConnectionsOnPage(document.graph, page.id)
  setObjectGraphConnectionsOnPage(document.graph, page.id, [...connections, connection])
  const receipt: AuthorityConnectionReceipt = {
    appliedRevision: head.revision + 1,
    baseRevision,
    connection,
    inputDigest,
    pageId: page.id,
    requestId,
    route: 'connect_objects',
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {}),
    version: 1
  }
  addConnectionReceipt(committedPage(document, page.id), receipt)
  const mutationReceipt = await store.commit({
    document: writeAuthorityBoardDocument(document),
    expectedContentHash: head.contentHash,
    expectedRevision: head.revision,
    requestId,
    workspaceId: head.identity.workspaceId
  })
  const nextHead = await store.head()
  if (!nextHead) throw new Error('Committed connection authority head is missing.')
  const nextDocument = readAuthorityBoardDocument(nextHead.document)
  const nextPage = committedPage(nextDocument, page.id)
  const committed = objectGraphConnectionById(nextDocument.graph, nextPage.id, connection.id)
  if (!committed || !sameConnection(committed, connection)) {
    throw new Error('Committed Object Graph connection diverged from authority readback.')
  }
  return {
    head: nextHead,
    page: nextPage,
    result: {
      context: issueContext(nextHead, nextPage, nextDocument),
      execution_surface: EXECUTION_SURFACE,
      persistence: persistence(nextHead),
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      proof: {
        durable_readback: 'passed',
        normal_editor_undo: 'unavailable',
        pixels: 'not_evaluated',
        reason: 'no_live_runtime'
      },
      readback: {
        connection_liveness: { current: 'present', historical: 'applied' },
        object_graph_connection: committed
      },
      receipt: {
        ...mutationReceipt,
        idempotent_replay: false,
        input_digest: inputDigest,
        requestId,
        semantic_owner: { owner_id: committed.id, root_object_id: nextPage.id },
        status: 'applied'
      },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'no_live_runtime'
      }
    }
  }
}

export function verifyAuthorityConnectionRequest(
  document: AuthorityBoardDocument,
  pageId: string,
  requestId: string
): JsonRecord[] {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') return []
  return connectionReceiptsOnPage(page)
    .filter((receipt) => receipt.requestId === requestId)
    .map((receipt) => ({
      ...semanticReadback(document, pageId, receipt),
      receipt: {
        appliedRevision: receipt.appliedRevision,
        baseRevision: receipt.baseRevision,
        input_digest: receipt.inputDigest,
        requestId: receipt.requestId,
        status: 'applied'
      }
    }))
}
