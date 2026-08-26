import type { SceneNode } from '@open-pencil/scene-graph'

import {
  enqueueAutomationMutation,
  type AutomationMutationOutcome
} from '@/app/automation/bridge/mutation-queue'
import {
  assertMutationRequestIdFresh,
  mutationRequestLedgerError,
  mutationRequestLedgerState,
  mutationRequestSignature,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget, UnknownRecord } from '@/app/automation/bridge/target'

import { requiredString, trimmedString } from '../input'
import { requestNodes } from './receipts'

export type NativeBoardContext = {
  boardRevision: number
  selectedIds: string[]
}

export type NativeMutationIdentity = {
  inputDigest: string
  requestId: string
  route: 'board_change'
  taskId?: string
  traceId?: string
}

export type NativeMutationState = 'applied' | 'replayed'

export type NativeMutationGuard = { anchorId: string; kind: 'anchor' } | { kind: 'free' }

export type NativeMutationHandlerOptions<TPresentation> = {
  issueContext: (target: AutomationTarget) => unknown
  presentationFrame: (target: AutomationTarget, objectIds: string[]) => Promise<TPresentation>
  requireContext: (
    target: AutomationTarget,
    rawArgs: unknown
  ) => { args: UnknownRecord; context: NativeBoardContext }
}

type NativeMutationProof = {
  error?: string
  reason?: string
  stage: string
  status: 'error' | 'partial'
}

type NativeMutationReceiptInput = {
  expectedRevision: number
  intent: NativeMutationIdentity
  objectIds: string[]
  result?: unknown
  target: AutomationTarget
}

type EnqueueNativeMutationInput<T> = {
  args: UnknownRecord
  context: NativeBoardContext
  existing: SceneNode | null
  guard: NativeMutationGuard
  intent: NativeMutationIdentity
  run: (expectedRevision: number) => Promise<T> | T
  target: AutomationTarget
  toolArgs: UnknownRecord
}

export function automationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameSelection(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function nativeMutationProofResult(options: {
  evidence?: UnknownRecord
  mutation: NativeMutationState
  proof?: NativeMutationProof
  receipt: UnknownRecord
  reason: string
  requestId: string
}): Record<string, unknown> {
  return {
    ...options.evidence,
    next_action: {
      command: 'board_verify',
      instruction:
        'Reacquire Board context, then verify this same request ID. Do not retry the mutation with a new request ID.',
      request_id: options.requestId,
      requires_fresh_context: true,
      retry_mutation: false
    },
    ...(options.proof ? { proof: options.proof } : {}),
    receipt: options.receipt,
    status: {
      attention_required: true,
      command: 'unavailable',
      mutation: options.mutation,
      reason: options.reason
    }
  }
}

export async function nativeMutationIdentity(
  args: UnknownRecord,
  signatureInput: UnknownRecord
): Promise<NativeMutationIdentity> {
  const requestId = requiredString(args, 'request_id')
  const taskId = trimmedString(args, 'task_id')
  const traceId = trimmedString(args, 'trace_id')
  const route = 'board_change'
  const inputDigest = await mutationRequestSignature(route, {
    ...signatureInput,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  })
  return {
    inputDigest,
    requestId,
    route,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
}

export function matchingNativeRequestNode(
  target: AutomationTarget,
  intent: NativeMutationIdentity,
  receiptMatches: (node: SceneNode) => boolean
): SceneNode | null {
  const nodes = requestNodes(target, intent.requestId)
  if (nodes.length > 1) {
    throw new Error(
      `Request "${intent.requestId}" is ambiguous: ${nodes.map((node) => node.id).join(', ')}.`
    )
  }
  const node = nodes.at(0)
  if (!node) return null
  if (!receiptMatches(node)) {
    throw new Error(
      `Request "${intent.requestId}" has an incomplete or conflicting native receipt.`
    )
  }
  return node
}

export function readyNativeMutationLedger(
  target: AutomationTarget,
  intent: NativeMutationIdentity
) {
  const ledger = mutationRequestLedgerState(target, intent.requestId)
  if (ledger.status === 'stored') {
    if (
      ledger.receipt.route !== intent.route ||
      ledger.receipt.inputDigest !== intent.inputDigest
    ) {
      throw new Error(`Request "${intent.requestId}" was already used for a different mutation.`)
    }
    return ledger
  }
  if (ledger.status !== 'missing') {
    throw mutationRequestLedgerError(intent.requestId, ledger.status)
  }
  return ledger
}

export function assertNoUnstoredNativeEvidence(
  existing: SceneNode | null,
  requestId: string
): void {
  if (!existing) return
  throw new Error(
    `Request "${requestId}" has native evidence but no durable ledger receipt; mutation is blocked.`
  )
}

export function validateNativeMutationContext(
  target: AutomationTarget,
  args: UnknownRecord,
  context: NativeBoardContext,
  guard: NativeMutationGuard
): number {
  const value = args.expected_revision
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('board_change requires a non-negative expected_revision.')
  }
  if (
    value !== context.boardRevision ||
    target.store.state.sceneVersion !== context.boardRevision
  ) {
    throw new Error('Board revision is stale. Reacquire context before changing the Board.')
  }
  if (guard.kind === 'anchor' && !sameSelection(context.selectedIds, [guard.anchorId])) {
    throw new Error('The context must contain exactly the requested anchor selection.')
  }
  return value
}

export function assertNativeMutationReady(
  target: AutomationTarget,
  intent: NativeMutationIdentity,
  guard: NativeMutationGuard
): void {
  assertMutationRequestIdFresh(target, intent.requestId)
  if (
    guard.kind === 'anchor' &&
    !sameSelection([...target.store.state.selectedIds], [guard.anchorId])
  ) {
    throw new Error('The anchor must remain the singleton selection until creation applies.')
  }
}

export function reserveNativeMutation(
  target: AutomationTarget,
  intent: NativeMutationIdentity
): void {
  reserveMutationRequest(target, {
    inputDigest: intent.inputDigest,
    requestId: intent.requestId,
    route: intent.route,
    version: 1
  })
}

export function nativeMutationMetadata(intent: NativeMutationIdentity, expectedRevision: number) {
  return {
    expectedRevision,
    requestId: intent.requestId,
    ...(intent.taskId ? { taskId: intent.taskId } : {}),
    ...(intent.traceId ? { traceId: intent.traceId } : {})
  }
}

export function enqueueNativeArtifactMutation<T>(
  input: EnqueueNativeMutationInput<T>
): Promise<AutomationMutationOutcome<T>> {
  assertNoUnstoredNativeEvidence(input.existing, input.intent.requestId)
  const expectedRevision = validateNativeMutationContext(
    input.target,
    input.args,
    input.context,
    input.guard
  )
  return enqueueAutomationMutation({
    metadata: nativeMutationMetadata(input.intent, expectedRevision),
    run: () => input.run(expectedRevision),
    target: input.target,
    toolArgs: input.toolArgs,
    toolName: 'board_change'
  })
}

export function storeNativeMutationReceipt(input: NativeMutationReceiptInput): void {
  try {
    recordMutationRequestReceipt(input.target, {
      inputDigest: input.intent.inputDigest,
      mutationReceipt: {
        appliedRevision: input.target.store.state.sceneVersion + 1,
        enqueuedRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        requestId: input.intent.requestId,
        status: 'applied',
        touchedProperties: [`${input.target.pageId}:*`],
        ...(input.intent.taskId ? { taskId: input.intent.taskId } : {}),
        ...(input.intent.traceId ? { traceId: input.intent.traceId } : {})
      },
      objectIds: input.objectIds,
      requestId: input.intent.requestId,
      ...(input.result === undefined ? {} : { result: input.result }),
      route: input.intent.route,
      semanticIds: [],
      ...(input.intent.taskId ? { taskId: input.intent.taskId } : {}),
      ...(input.intent.traceId ? { traceId: input.intent.traceId } : {}),
      version: 1
    })
  } catch (error) {
    input.target.store.undo.undo()
    throw error
  }
}

export function replayNativeMutationReceipt(
  receipt: MutationRequestReceipt,
  ownerId?: string
): UnknownRecord {
  return {
    ...receipt.mutationReceipt,
    historical_only: !ownerId,
    idempotent_replay: true,
    input_digest: receipt.inputDigest,
    product_grade_path: true,
    ...(ownerId ? { semantic_owner: { owner_id: ownerId, root_object_id: ownerId } } : {})
  }
}
