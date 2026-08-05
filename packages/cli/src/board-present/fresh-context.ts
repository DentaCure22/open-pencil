import { rpcEnvelopeLiveExact, type AppRpcEnvelope, type AppRpcTarget } from '#cli/app-client'
import type { ExactFreshContextTarget, PersistedBoardTarget } from '#cli/board-build/fresh-context'

type BoardJsonObject = { [key: string]: unknown }

export type FreshBoardPresentLogicalArgs = {
  object_ids: string[]
}

export type BoardPresentRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<BoardJsonObject>>

type FreshContextCallCounts = {
  board_context: 1
  board_present: 1
  total: 2
}

type FreshContextTiming = {
  board_context: number
  board_present: number
  total: number
}

export type FreshBoardPresentHandshake = {
  contract: 'board-present-fresh-context/v2'
  handshake_elapsed_ms: FreshContextTiming
  semantic_rpc_calls: FreshContextCallCounts
}

export type FreshBoardPresentExecution = {
  handshake: FreshBoardPresentHandshake
  response: AppRpcEnvelope<BoardJsonObject>
}

type MonotonicClock = () => number

export type FreshBoardPresentOptions = {
  now?: MonotonicClock
  send?: BoardPresentRpcSender
}

const TARGET_FIELDS = ['content_document_id', 'document_id', 'page_id', 'workspace_id'] as const

function isBoardJsonObject(value: unknown): value is BoardJsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function liveExactTarget(
  actual: AppRpcTarget | undefined,
  expected: PersistedBoardTarget,
  label: string
): ExactFreshContextTarget {
  if (!actual) throw new Error(`${label} did not return an exact target.`)
  if (!Number.isInteger(actual.boardRevision) || actual.boardRevision < 0) {
    throw new Error(`${label} did not return a valid integer Board revision.`)
  }
  const values: Record<(typeof TARGET_FIELDS)[number], string | undefined> = {
    content_document_id: actual.contentDocumentId,
    document_id: actual.documentId,
    page_id: actual.pageId,
    workspace_id: actual.workspaceId
  }
  const mismatches = TARGET_FIELDS.filter((field) => values[field] !== expected[field])
  if (mismatches.length > 0) {
    throw new Error(`${label} returned the wrong exact target: ${mismatches.join(', ')}.`)
  }
  const runtimeInstanceId = actual.runtimeInstanceId?.trim()
  if (!runtimeInstanceId) {
    throw new Error(`${label} did not return a live runtime instance.`)
  }
  return {
    ...expected,
    runtime_instance_id: runtimeInstanceId
  }
}

export function normalizeFreshBoardPresentLogical(value: unknown): FreshBoardPresentLogicalArgs {
  if (!isBoardJsonObject(value) || !Array.isArray(value.object_ids)) {
    throw new Error('Fresh-context Board presentation requires an object_ids array.')
  }
  const objectIds = value.object_ids
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  const uniqueObjectIds = [...new Set(objectIds)]
  if (uniqueObjectIds.length === 0 || uniqueObjectIds.length > 100) {
    throw new Error('Fresh-context object_ids must contain from 1 to 100 unique IDs.')
  }
  if (uniqueObjectIds.length !== value.object_ids.length) {
    throw new Error('Fresh-context object_ids must contain unique non-empty strings.')
  }
  return { object_ids: uniqueObjectIds }
}

function contextToken(context: unknown): string {
  if (!isBoardJsonObject(context)) {
    throw new Error('Fresh Board context did not return an object.')
  }
  if (!Array.isArray(context.capabilities) || !context.capabilities.includes('board.present')) {
    throw new Error('Fresh Board context lacks board.present capability.')
  }
  if (typeof context.context_token !== 'string' || !context.context_token.trim()) {
    throw new Error('Fresh Board context did not return a context token.')
  }
  return context.context_token.trim()
}

function elapsed(started: number, finished: number): number {
  const duration = finished - started
  if (!Number.isFinite(duration)) return 0
  return Math.round(Math.max(0, duration) * 100) / 100
}

export async function presentWithFreshContext(
  target: PersistedBoardTarget,
  logical: FreshBoardPresentLogicalArgs,
  options: FreshBoardPresentOptions = {}
): Promise<FreshBoardPresentExecution> {
  const normalizedLogical = normalizeFreshBoardPresentLogical(logical)
  const send = options.send ?? rpcEnvelopeLiveExact<BoardJsonObject>
  const now = options.now ?? (() => performance.now())
  const started = now()
  const context = await send('board_context', target)
  const contextFinished = now()
  const liveTarget = liveExactTarget(context.target, target, 'Fresh Board context')
  const response = await send('board_present', {
    ...liveTarget,
    context_token: contextToken(context.result),
    ...normalizedLogical
  })
  const presentFinished = now()
  const responseTarget = liveExactTarget(response.target, target, 'Board presentation')
  if (responseTarget.runtime_instance_id !== liveTarget.runtime_instance_id) {
    throw new Error('Board presentation returned the wrong live runtime instance.')
  }
  return {
    handshake: {
      contract: 'board-present-fresh-context/v2',
      handshake_elapsed_ms: {
        board_context: elapsed(started, contextFinished),
        board_present: elapsed(contextFinished, presentFinished),
        total: elapsed(started, presentFinished)
      },
      semantic_rpc_calls: { board_context: 1, board_present: 1, total: 2 }
    },
    response
  }
}
