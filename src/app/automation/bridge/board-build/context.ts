import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'

import { isSelfContainedCreatePlan } from './plan'
import type { BoardBuildInput } from './types'

function selectionIds(readback: UnknownRecord): string[] {
  if (!Array.isArray(readback.nodes)) return []
  return readback.nodes.flatMap((node) => {
    if (!isUnknownRecord(node) || typeof node.id !== 'string' || node.missing === true) return []
    return [node.id]
  })
}

export function assertCurrentBuildContext(
  input: BoardBuildInput,
  current: UnknownRecord,
  storedReplay = false
): void {
  if (storedReplay) return
  if (
    current.board_revision !== input.expectedRevision &&
    !(input.plan !== undefined && isSelfContainedCreatePlan(input))
  ) {
    throw new Error('Board revision is stale. Reacquire context before building on the Board.')
  }
  const expectedSelectionId = 'recipe' in input ? input.anchorId : undefined
  if (!expectedSelectionId) return
  const selected = selectionIds(current)
  if (selected.length !== 1 || selected[0] !== expectedSelectionId) {
    throw new Error('The requested owner or anchor must remain the singleton Board selection.')
  }
}
