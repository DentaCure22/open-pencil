import type { AutomationMutationMetadata, AutomationMutationReceipt } from '../mutation-queue'
import { mutationRequestLedgerError, mutationRequestLedgerState } from '../request-receipts'
import type { AutomationTarget } from '../target'
import type {
  CodeObjectNextAction,
  CodeObjectRuntimeProof,
  CodeObjectSemanticOwner
} from './contract'

type CodeObjectMutationIntent = {
  inputDigest: string
  requestId: string
  route: string
  taskId?: string
  traceId?: string
}

export function readyCodeObjectLedger(target: AutomationTarget, intent: CodeObjectMutationIntent) {
  const state = mutationRequestLedgerState(target, intent.requestId)
  if (state.status === 'stored') {
    if (state.receipt.route !== intent.route || state.receipt.inputDigest !== intent.inputDigest) {
      throw new Error(`Request "${intent.requestId}" was already used for a different mutation.`)
    }
    return state
  }
  if (state.status !== 'missing') throw mutationRequestLedgerError(intent.requestId, state.status)
  return state
}

export function codeObjectMutationMetadata(
  intent: CodeObjectMutationIntent,
  expectedRevision: number
): AutomationMutationMetadata {
  const metadata: AutomationMutationMetadata = { expectedRevision, requestId: intent.requestId }
  if (intent.taskId) metadata.taskId = intent.taskId
  if (intent.traceId) metadata.traceId = intent.traceId
  return metadata
}

export function codeObjectSemanticOwner(ownerId: string): CodeObjectSemanticOwner {
  return { owner_id: ownerId, root_object_id: ownerId }
}

export function appliedCodeObjectReceipt(
  receipt: AutomationMutationReceipt,
  intent: CodeObjectMutationIntent,
  ownerId: string,
  historyLabel: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...receipt,
    history_label: historyLabel,
    idempotent_replay: false,
    input_digest: intent.inputDigest,
    ...extra,
    product_grade_path: true,
    semantic_owner: codeObjectSemanticOwner(ownerId)
  }
}

export function appliedCodeObjectResult<
  TReadback extends { reconciliation: { status: string } },
  TExtra extends Record<string, unknown>
>(options: {
  extra: TExtra
  failure: { proof?: CodeObjectRuntimeProof; reason: string }
  nextAction: CodeObjectNextAction
  ownerId: string
  readback: TReadback
  receipt: Record<string, unknown>
}) {
  const current = options.readback.reconciliation.status === 'current'
  return {
    ...(!current ? { next_action: options.nextAction } : {}),
    owner_id: options.ownerId,
    ...options.extra,
    readback: { code_object: options.readback },
    receipt: options.receipt,
    semantic_owner: codeObjectSemanticOwner(options.ownerId),
    ...(!current && options.failure.proof ? { proof: options.failure.proof } : {}),
    status: current
      ? ({ attention_required: false, command: 'completed', mutation: 'applied' } as const)
      : ({
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: options.failure.reason
        } as const)
  }
}
