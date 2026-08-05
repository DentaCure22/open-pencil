import {
  getAppToken,
  rpcEnvelopeExact,
  type AppRpcEnvelope,
  type AppRpcTarget
} from '#cli/app-client'
import type { ExactFreshContextTarget } from '#cli/board-build/fresh-context'

type BoardJsonObject = { [key: string]: unknown }

export type FreshBoardReadLogicalArgs = {
  limit?: number
  object_ids?: string[]
  projection?: 'detail' | 'geometry' | 'id_only' | 'summary'
  query?: BoardJsonObject
  scope: 'objects' | 'page' | 'query' | 'selection'
  sort?: 'document' | 'name' | 'x' | 'y'
  token_budget?: number
}

export type BoardReadRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<BoardJsonObject>>

type FreshBoardReadOptions = {
  now?: () => number
  send?: BoardReadRpcSender
}

const TARGET_ACCESSORS = {
  content_document_id: (target: AppRpcTarget) => target.contentDocumentId,
  document_id: (target: AppRpcTarget) => target.documentId,
  page_id: (target: AppRpcTarget) => target.pageId,
  runtime_instance_id: (target: AppRpcTarget) => target.runtimeInstanceId,
  workspace_id: (target: AppRpcTarget) => target.workspaceId
} as const

function isRecord(value: unknown): value is BoardJsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function exactContextToken(
  response: AppRpcEnvelope<BoardJsonObject>,
  expected: ExactFreshContextTarget
): string {
  const actual = response.target
  if (!actual || !Number.isInteger(actual.boardRevision) || actual.boardRevision < 0) {
    throw new Error('Fresh Board context did not return an exact target and revision.')
  }
  const mismatches = Object.entries(TARGET_ACCESSORS)
    .filter(([field, accessor]) => accessor(actual) !== expected[field as keyof typeof expected])
    .map(([field]) => field)
  if (mismatches.length > 0) {
    throw new Error(
      `Fresh Board context returned the wrong exact target: ${mismatches.join(', ')}.`
    )
  }
  if (!isRecord(response.result)) throw new Error('Fresh Board context did not return an object.')
  const token = response.result.context_token
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Fresh Board context did not return a context token.')
  }
  return token.trim()
}

function elapsed(started: number, finished: number): number {
  const duration = finished - started
  return Number.isFinite(duration) ? Math.round(Math.max(0, duration) * 100) / 100 : 0
}

export async function readWithFreshContext(
  target: ExactFreshContextTarget,
  logical: FreshBoardReadLogicalArgs,
  options: FreshBoardReadOptions = {}
) {
  const send = options.send ?? rpcEnvelopeExact<BoardJsonObject>
  const now = options.now ?? (() => performance.now())
  if (!options.send) await getAppToken()
  const started = now()
  const context = await send('board_context', target)
  const contextFinished = now()
  const response = await send('board_read', {
    ...target,
    context_token: exactContextToken(context, target),
    ...logical
  })
  const readFinished = now()
  return {
    handshake: {
      contract: 'board-read-fresh-context/v1' as const,
      handshake_elapsed_ms: {
        board_context: elapsed(started, contextFinished),
        board_read: elapsed(contextFinished, readFinished),
        total: elapsed(started, readFinished)
      },
      semantic_rpc_calls: { board_context: 1 as const, board_read: 1 as const, total: 2 as const }
    },
    response
  }
}
