import { mutationRequestLedgerState } from '@/app/automation/bridge/request-receipts'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'

import { buildMetadata } from './metadata'
import { optionalBuildString as optionalString } from './parse'
import type { BoardBuildInput } from './types'

export function sameRequestVerifyAction(input: BoardBuildInput) {
  return {
    command: 'board_verify',
    instruction:
      'Reacquire Board context, then verify this same request ID. Do not retry the mutation with a new request ID.',
    request_id: input.requestId,
    requires_fresh_context: true,
    retry_mutation: false
  }
}

function nativeChangePartialProof(changed: UnknownRecord): {
  reason: string
  stage: 'presentation' | 'verification'
} | null {
  const presentation = isUnknownRecord(changed.presentation) ? changed.presentation : null
  if (presentation?.acknowledged === false) {
    return { reason: 'presentation_not_acknowledged', stage: 'presentation' }
  }
  const visual = isUnknownRecord(changed.visual) ? changed.visual : null
  const verification = isUnknownRecord(visual?.verification) ? visual.verification : null
  if (verification && verification.status !== 'passed') {
    return { reason: 'visual_verification_not_passed', stage: 'verification' }
  }
  return null
}

type NativeChangeOwnerProof =
  | { ownerId: string }
  | { reason: 'semantic_owner_id_conflict' | 'semantic_owner_id_missing' }

function nativeChangeOwnerProof(
  target: AutomationTarget,
  input: BoardBuildInput,
  changed: UnknownRecord
): NativeChangeOwnerProof {
  const receipt = isUnknownRecord(changed.receipt) ? changed.receipt : null
  const semanticOwner = isUnknownRecord(receipt?.semantic_owner) ? receipt.semantic_owner : null
  const readback = isUnknownRecord(changed.readback) ? changed.readback : null
  const graph = isUnknownRecord(readback?.graph) ? readback.graph : null
  const card = isUnknownRecord(readback?.card) ? readback.card : null
  const cardOwner = isUnknownRecord(card?.owner) ? card.owner : null
  const requestState = mutationRequestLedgerState(target, input.requestId)
  const ledgerOwnerId =
    requestState.status === 'stored' ? optionalString(requestState.receipt.objectIds[0]) : undefined
  const ownerIds = new Set(
    [
      optionalString(semanticOwner?.owner_id),
      optionalString(graph?.id),
      optionalString(cardOwner?.id),
      ledgerOwnerId
    ].filter((ownerId): ownerId is string => ownerId !== undefined)
  )
  if (ownerIds.size === 0) return { reason: 'semantic_owner_id_missing' }
  if (ownerIds.size > 1) return { reason: 'semantic_owner_id_conflict' }
  const ownerId = ownerIds.values().next().value
  return typeof ownerId === 'string' ? { ownerId } : { reason: 'semantic_owner_id_missing' }
}

function nativeChangeMutation(status: UnknownRecord | null): 'applied' | 'replayed' | null {
  return status?.mutation === 'applied' || status?.mutation === 'replayed' ? status.mutation : null
}

export function normalizeNativeChangeResult(
  target: AutomationTarget,
  input: BoardBuildInput,
  changed: UnknownRecord,
  routeId: 'native-card/v1' | 'native-text/v1'
) {
  const build = buildMetadata(input, routeId, 'board_change')
  const receipt = isUnknownRecord(changed.receipt) ? changed.receipt : null
  const status = isUnknownRecord(changed.status) ? changed.status : null
  const mutation = nativeChangeMutation(status)
  const knownMutation = mutation !== null
  const ownerProof = knownMutation ? nativeChangeOwnerProof(target, input, changed) : null
  if (ownerProof && 'reason' in ownerProof) {
    return {
      ...changed,
      build,
      next_action: sameRequestVerifyAction(input),
      proof: { reason: ownerProof.reason, stage: 'readback', status: 'error' },
      status: {
        ...status,
        attention_required: true,
        command: 'unavailable',
        mutation,
        reason: ownerProof.reason
      }
    }
  }
  const ownerId = ownerProof && 'ownerId' in ownerProof ? ownerProof.ownerId : undefined
  const normalized: UnknownRecord = { ...changed, ...(ownerId ? { owner_id: ownerId } : {}) }
  if (!receipt || !knownMutation) return { ...normalized, build }

  const partial = nativeChangePartialProof(normalized)
  if (partial) {
    return {
      ...normalized,
      build,
      next_action: sameRequestVerifyAction(input),
      proof: {
        reason: partial.reason,
        stage: partial.stage,
        status: 'partial'
      },
      status: {
        ...status,
        attention_required: true,
        command: 'unavailable',
        reason: partial.reason
      }
    }
  }
  if (
    isUnknownRecord(normalized.proof) ||
    status?.attention_required === true ||
    status?.command !== 'completed'
  ) {
    return { ...normalized, build, next_action: sameRequestVerifyAction(input) }
  }
  return { ...normalized, build }
}
