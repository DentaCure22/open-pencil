import type { AppRpcEnvelope } from '#cli/app-client'
import type { ExactFreshContextTarget } from '#cli/board-build/fresh-context'
import {
  acquireFreshBoardContext,
  assertFreshContextTarget as assertTarget,
  type BoardJsonObject,
  freshContextElapsed as elapsed,
  type FreshContextRequestOptions,
  isBoardJsonObject as isRecord
} from '#cli/fresh-context/shared'

export type FreshBoardEditLogicalArgs = {
  operation: BoardJsonObject
  request_id: string
  task_id?: string
  trace_id?: string
}

type FreshBoardEditExecution = {
  handshake: {
    contract: 'board-edit-fresh-context/v1'
    handshake_elapsed_ms: { board_change: number; board_context: number; total: number }
    semantic_rpc_calls: { board_change: 1; board_context: 1; total: 2 }
  }
  response: AppRpcEnvelope<BoardJsonObject>
}

const TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'runtime_instance_id',
  'workspace_id'
] as const
const BASE_FIELDS = new Set([...TARGET_FIELDS, 'context_token', 'contract', 'expected_revision'])
const CAPABILITY_BY_OPERATION = {
  'object.delete': 'board.change.object.delete',
  'object.duplicate': 'board.change.object.duplicate',
  'object.move': 'board.change.object.move',
  'object.resize': 'board.change.object.resize',
  'object.update': 'board.change.object.update'
} as const

function freshBase(
  context: BoardJsonObject,
  target: ExactFreshContextTarget,
  operation: BoardJsonObject
): BoardJsonObject {
  const kind = operation.kind
  if (typeof kind !== 'string' || !(kind in CAPABILITY_BY_OPERATION)) {
    throw new Error('Fresh Board edit has an unsupported operation kind.')
  }
  const capability = CAPABILITY_BY_OPERATION[kind as keyof typeof CAPABILITY_BY_OPERATION]
  if (!Array.isArray(context.capabilities) || !context.capabilities.includes(capability)) {
    throw new Error(`Fresh Board context lacks writer ${capability} capability.`)
  }
  if (!isRecord(context.board_build_base)) {
    throw new Error('Fresh Board context did not return board_build_base.')
  }
  const base = context.board_build_base
  const unsupported = Object.keys(base).filter((field) => !BASE_FIELDS.has(field))
  if (unsupported.length > 0) {
    throw new Error(
      `Fresh Board base contains unexpected fields: ${unsupported.sort().join(', ')}.`
    )
  }
  const mismatches = TARGET_FIELDS.filter((field) => base[field] !== target[field])
  if (mismatches.length > 0) {
    throw new Error(`Fresh Board base returned the wrong exact target: ${mismatches.join(', ')}.`)
  }
  if (base.contract !== 'board-build/v1')
    throw new Error('Fresh Board base has the wrong contract.')
  if (typeof base.context_token !== 'string' || !base.context_token.trim()) {
    throw new Error('Fresh Board base is missing a context token.')
  }
  if (
    typeof base.expected_revision !== 'number' ||
    !Number.isInteger(base.expected_revision) ||
    base.expected_revision < 0
  ) {
    throw new Error('Fresh Board base is missing a valid expected revision.')
  }
  return base
}

export async function editWithFreshContext(
  target: ExactFreshContextTarget,
  logical: FreshBoardEditLogicalArgs,
  options: FreshContextRequestOptions = {}
): Promise<FreshBoardEditExecution> {
  if (!isRecord(logical.operation)) throw new Error('Fresh Board edit operation must be an object.')
  if (!logical.request_id.trim()) throw new Error('Fresh Board edit request_id is required.')
  const { context, contextFinished, now, send, started } = await acquireFreshBoardContext(
    target,
    options
  )
  assertTarget(context.target, target, 'Fresh Board context')
  const base = freshBase(context.result, target, logical.operation)
  if (context.target.boardRevision !== base.expected_revision) {
    throw new Error('Fresh Board context target revision does not match its atomic base.')
  }
  const response = await send('board_change', { ...base, ...logical })
  const editFinished = now()
  assertTarget(response.target, target, 'Fresh Board edit')
  return {
    handshake: {
      contract: 'board-edit-fresh-context/v1',
      handshake_elapsed_ms: {
        board_change: elapsed(contextFinished, editFinished),
        board_context: elapsed(started, contextFinished),
        total: elapsed(started, editFinished)
      },
      semantic_rpc_calls: { board_change: 1, board_context: 1, total: 2 }
    },
    response
  }
}
