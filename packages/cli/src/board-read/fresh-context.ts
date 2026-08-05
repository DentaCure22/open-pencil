import type { AppRpcEnvelope } from '#cli/app-client'
import type { ExactFreshContextTarget } from '#cli/board-build/fresh-context'
import {
  acquireFreshBoardContext,
  assertFreshContextTarget,
  type BoardJsonObject,
  freshContextElapsed as elapsed,
  type FreshContextRequestOptions,
  isBoardJsonObject as isRecord
} from '#cli/fresh-context/shared'

export type FreshBoardReadLogicalArgs = {
  limit?: number
  object_ids?: string[]
  projection?: 'detail' | 'geometry' | 'id_only' | 'summary'
  query?: BoardJsonObject
  scope: 'objects' | 'page' | 'query' | 'selection'
  sort?: 'document' | 'name' | 'x' | 'y'
  token_budget?: number
}

function exactContextToken(
  response: AppRpcEnvelope<BoardJsonObject>,
  expected: ExactFreshContextTarget
): string {
  assertFreshContextTarget(response.target, expected, 'Fresh Board context')
  if (!isRecord(response.result)) throw new Error('Fresh Board context did not return an object.')
  const token = response.result.context_token
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Fresh Board context did not return a context token.')
  }
  return token.trim()
}

export async function readWithFreshContext(
  target: ExactFreshContextTarget,
  logical: FreshBoardReadLogicalArgs,
  options: FreshContextRequestOptions = {}
) {
  const { context, contextFinished, now, send, started } = await acquireFreshBoardContext(
    target,
    options
  )
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
