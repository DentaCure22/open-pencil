import {
  requestAutomationPersistence,
  type AutomationPersistenceResult,
  type AutomationPersistenceTransaction
} from '@/app/automation/bridge/persistence'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import type { EditorStore } from '@/app/editor/session'

import type { BoardBuildInput } from './types'

export type BoardBuildPersistence = (
  store: EditorStore,
  requestedSceneRevision: number,
  transaction?: AutomationPersistenceTransaction
) => Promise<AutomationPersistenceResult>

function sameRequestPersistenceAction(input: BoardBuildInput, result: UnknownRecord) {
  const context = isUnknownRecord(result.context) ? result.context : null
  const base =
    context && isUnknownRecord(context.board_build_base) ? context.board_build_base : null
  return {
    ...(base ? { base } : {}),
    command: 'board_build',
    instruction: base
      ? 'Replay this same build request with this returned base and the same request ID to retry persistence without duplicating the artifact.'
      : 'Reacquire Board context, then replay this same build request with the same request ID to retry persistence without duplicating the artifact.',
    request_id: input.requestId,
    requires_fresh_context: !base,
    retry_mutation: true
  }
}

function withUnknownPersistence(
  input: BoardBuildInput,
  result: UnknownRecord,
  persistence: AutomationPersistenceResult,
  mutation: 'applied' | 'no_change' | 'replayed'
): UnknownRecord {
  const status = isUnknownRecord(result.status) ? result.status : null
  if (status?.command !== 'completed') return { ...result, persistence }
  return {
    ...result,
    next_action: sameRequestPersistenceAction(input, result),
    persistence,
    proof: {
      reason: 'persistence_not_acknowledged',
      stage: 'persistence',
      status: 'partial'
    },
    status: {
      attention_required: true,
      command: 'unavailable',
      mutation,
      reason: 'persistence_not_acknowledged'
    }
  }
}

export async function withBoardBuildPersistence(options: {
  input: BoardBuildInput
  persist?: BoardBuildPersistence
  result: UnknownRecord
  target: AutomationTarget
  transaction?: AutomationPersistenceTransaction
}): Promise<UnknownRecord> {
  const status = isUnknownRecord(options.result.status) ? options.result.status : null
  const mutation = status?.mutation
  if (mutation === 'replayed' && status?.reason === 'historical_receipt_only') {
    return options.result
  }
  if (mutation !== 'applied' && mutation !== 'no_change' && mutation !== 'replayed') {
    return options.result
  }
  const persistence = options.persist
    ? await options.persist(
        options.target.store,
        options.target.store.state.sceneVersion,
        options.transaction
      )
    : await requestAutomationPersistence(
        options.target.store,
        options.target.store.state.sceneVersion,
        undefined,
        options.transaction
      )
  return persistence.status === 'durable'
    ? { ...options.result, persistence }
    : withUnknownPersistence(options.input, options.result, persistence, mutation)
}
