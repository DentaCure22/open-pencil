import {
  getAppToken,
  rpcEnvelopeExact,
  type AppRpcEnvelope,
  type AppRpcTarget
} from '#cli/app-client'

export type BoardJsonObject = { [key: string]: unknown }

export type ExactFreshContextTarget = {
  content_document_id: string
  document_id: string
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

export type PersistedBoardTarget = Omit<ExactFreshContextTarget, 'runtime_instance_id'>
export type FreshContextTarget = PersistedBoardTarget & { runtime_instance_id?: string }
export type FreshContextMetrics<Command extends string> = {
  board_context: number
  total: number
} & Record<Command, number>
export type FreshContextRequestOptions = {
  now?: () => number
  send?: (
    command: string,
    args: Record<string, unknown>
  ) => Promise<AppRpcEnvelope<BoardJsonObject>>
}

const TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'runtime_instance_id',
  'workspace_id'
] as const
const PERSISTED_TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'workspace_id'
] as const

export function isBoardJsonObject(value: unknown): value is BoardJsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function assertFreshContextTarget(
  actual: AppRpcTarget | undefined,
  expected: FreshContextTarget,
  label: string
): asserts actual is AppRpcTarget {
  if (!actual) throw new Error(`${label} did not return an exact target.`)
  if (!Number.isInteger(actual.boardRevision) || actual.boardRevision < 0) {
    throw new Error(`${label} did not return a valid integer Board revision.`)
  }
  const values: Record<(typeof TARGET_FIELDS)[number], string | undefined> = {
    content_document_id: actual.contentDocumentId,
    document_id: actual.documentId,
    page_id: actual.pageId,
    runtime_instance_id: actual.runtimeInstanceId,
    workspace_id: actual.workspaceId
  }
  const fields = expected.runtime_instance_id ? TARGET_FIELDS : PERSISTED_TARGET_FIELDS
  const mismatches = fields.filter((field) => values[field] !== expected[field])
  if (mismatches.length > 0) {
    throw new Error(`${label} returned the wrong exact target: ${mismatches.join(', ')}.`)
  }
}

export function freshContextElapsed(started: number, finished: number): number {
  const duration = finished - started
  if (!Number.isFinite(duration)) return 0
  return Math.round(Math.max(0, duration) * 100) / 100
}

export async function acquireFreshBoardContext(
  target: ExactFreshContextTarget,
  options: FreshContextRequestOptions
) {
  const send = options.send ?? rpcEnvelopeExact<BoardJsonObject>
  const now = options.now ?? (() => performance.now())
  if (!options.send) await getAppToken()
  const started = now()
  const context = await send('board_context', target)
  return { context, contextFinished: now(), now, send, started }
}
