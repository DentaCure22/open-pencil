import { objectGraphConnectionById, type ObjectGraphConnection } from '@open-pencil/scene-graph'

import {
  coalesceAutomationMutationRequest,
  enqueueAutomationMutation
} from '@/app/automation/bridge/mutation-queue'
import { requestAutomationPersistence } from '@/app/automation/bridge/persistence'
import {
  assertMutationRequestIdFresh,
  mutationRequestReceiptsById,
  mutationRequestSignature,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import {
  automationElapsedMs,
  automationNowMs,
  type AutomationStageTimings,
  withAutomationStageTiming
} from '@/app/automation/bridge/timing'
import { connectObjects } from '@/app/object-graph'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

import { waitForConnectionVisualProof, type ConnectionVisualProof } from './connect-visual-proof'
import { requiredString, trimmedString } from './input'
import { requestNodes } from './native/text'
import { assertSafeConnectObjectsIntent, parseConnectObjectsInputStructure } from './object-graph'

type BoardContext = { boardRevision: number }
type PresentationResult = {
  acknowledged: boolean
  intersection?: Array<{ viewport: 'inside' | 'outside' | 'partial' }>
}
type StoredConnection = ObjectGraphConnection & { pageId: string }

type ConnectionPresentation = {
  frame: PresentationResult
  visual?: ConnectionVisualProof
  visualError?: string
}

type ConnectHandlerOptions = {
  issueContext: (target: AutomationTarget) => unknown
  presentationFrame: (target: AutomationTarget, objectIds: string[]) => Promise<PresentationResult>
  requireContext: (
    target: AutomationTarget,
    rawArgs: unknown
  ) => { args: UnknownRecord; context: BoardContext }
}

function visualProofAcknowledged(proof: ConnectionVisualProof): boolean {
  return proof.status === 'rendered'
}

function connectionPresentationReason(
  presentation: ConnectionPresentation
):
  | 'connector_endpoints_not_visible'
  | 'connector_presentation_not_acknowledged'
  | 'connector_visual_not_acknowledged'
  | 'connector_visual_proof_failed'
  | null {
  if (!presentation.frame.acknowledged) return 'connector_presentation_not_acknowledged'
  if (
    !presentation.frame.intersection ||
    presentation.frame.intersection.length !== 2 ||
    presentation.frame.intersection.some(({ viewport }) => viewport === 'outside')
  ) {
    return 'connector_endpoints_not_visible'
  }
  if (presentation.visualError || !presentation.visual) return 'connector_visual_proof_failed'
  return visualProofAcknowledged(presentation.visual) ? null : 'connector_visual_not_acknowledged'
}

function connectionNextAction(requestId: string) {
  return {
    command: 'board_verify',
    instruction:
      'Reacquire Board context and verify this same connection request ID. Do not retry the mutation with a new request ID.',
    request_id: requestId,
    requires_fresh_context: true,
    retry_mutation: false
  } as const
}

async function connectionPresentation(
  target: AutomationTarget,
  connection: ObjectGraphConnection,
  presentationFrame: ConnectHandlerOptions['presentationFrame']
): Promise<ConnectionPresentation> {
  let frame: PresentationResult
  try {
    frame = await presentationFrame(target, [connection.sourceNodeId, connection.targetNodeId])
  } catch {
    frame = { acknowledged: false }
  }
  try {
    return {
      frame,
      visual: await waitForConnectionVisualProof(target.store.graph, target.pageId, connection)
    }
  } catch (error) {
    return {
      frame,
      visualError: error instanceof Error ? error.message : String(error)
    }
  }
}

function existingReceipt(
  target: AutomationTarget,
  requestId: string
): MutationRequestReceipt | null {
  const stored = mutationRequestReceiptsById(target, requestId)
  const native = requestNodes(target, requestId)
  if (stored.length + native.length > 1) {
    throw new Error(`Request "${requestId}" has duplicate stored mutation receipts.`)
  }
  if (native.length === 1) {
    throw new Error(`Request "${requestId}" was already used for a different mutation.`)
  }
  return stored[0] ?? null
}

function requiredExpectedRevision(args: UnknownRecord, context: BoardContext): number {
  const value = args.expected_revision
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('connect_objects requires a non-negative expected_revision.')
  }
  if (value !== context.boardRevision) {
    throw new Error('Board revision is stale. Reacquire context before changing the Board.')
  }
  return value
}

function replayConnectionLiveStatus(
  target: AutomationTarget,
  connection: ObjectGraphConnection | null,
  expected: StoredConnection | null
): 'diverged' | 'missing' | 'present' {
  if (!connection) return 'missing'
  return expected && sameConnectionIntent(target.pageId, connection, expected)
    ? 'present'
    : 'diverged'
}

function replayConnectionReason(
  liveStatus: 'diverged' | 'missing' | 'present',
  presentation: ConnectionPresentation | null
): string | undefined {
  if (liveStatus === 'missing') return 'historical_receipt_only'
  if (liveStatus === 'diverged') return 'historical_receipt_diverged'
  return presentation ? (connectionPresentationReason(presentation) ?? undefined) : undefined
}

async function replayConnection(
  target: AutomationTarget,
  receipt: MutationRequestReceipt,
  issueContext: ConnectHandlerOptions['issueContext'],
  presentationFrame: ConnectHandlerOptions['presentationFrame']
): Promise<Record<string, unknown>> {
  const connectionId = receipt.semanticIds[0]
  const connection = connectionId
    ? objectGraphConnectionById(target.store.graph, target.pageId, connectionId)
    : null
  const expected = storedConnection(receipt.result)
  const liveStatus = replayConnectionLiveStatus(target, connection, expected)
  const presentation =
    connection && liveStatus === 'present'
      ? await connectionPresentation(target, connection, presentationFrame)
      : null
  const reason = replayConnectionReason(liveStatus, presentation)
  const current = liveStatus === 'present' && !reason
  return {
    context: issueContext(target),
    ...(!current ? { next_action: connectionNextAction(receipt.requestId) } : {}),
    ...(presentation ? { presentation: presentation.frame } : {}),
    readback: {
      connection_liveness: {
        current: liveStatus,
        historical: 'applied'
      },
      object_graph_connection: connection ?? { id: connectionId, missing: true },
      ...(presentation?.visual ? { object_graph_visual: presentation.visual } : {}),
      ...(presentation?.visualError ? { object_graph_visual_error: presentation.visualError } : {})
    },
    receipt: {
      ...receipt.mutationReceipt,
      historical_only: liveStatus !== 'present',
      historical_status: 'applied',
      idempotent_replay: true,
      input_digest: receipt.inputDigest,
      live_status: liveStatus,
      product_grade_path: true
    },
    status: {
      action: 'none',
      attention_required: !current,
      command: current ? 'completed' : 'unavailable',
      mutation: 'replayed',
      ...(reason ? { reason } : {})
    }
  }
}

function storedConnection(value: unknown): StoredConnection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<StoredConnection>
  return typeof candidate.automatic === 'boolean' &&
    typeof candidate.id === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.label === 'string' &&
    typeof candidate.pageId === 'string' &&
    Array.isArray(candidate.permissions) &&
    candidate.permissions.every(
      (permission) => permission === 'target.action.execute' || permission === 'target.data.write'
    ) &&
    candidate.schemaVersion === 1 &&
    typeof candidate.sourceNodeId === 'string' &&
    typeof candidate.sourcePort === 'string' &&
    typeof candidate.targetNodeId === 'string' &&
    typeof candidate.targetPort === 'string'
    ? (candidate as StoredConnection)
    : null
}

function sameConnectionIntent(
  pageId: string,
  current: ObjectGraphConnection,
  expected: StoredConnection
): boolean {
  return (
    pageId === expected.pageId &&
    current.automatic === expected.automatic &&
    current.id === expected.id &&
    current.kind === expected.kind &&
    current.label === expected.label &&
    current.permissions.length === expected.permissions.length &&
    current.permissions.every((permission, index) => permission === expected.permissions[index]) &&
    current.sourceNodeId === expected.sourceNodeId &&
    current.sourcePort === expected.sourcePort &&
    current.targetNodeId === expected.targetNodeId &&
    current.targetPort === expected.targetPort
  )
}

async function withConnectionPersistence(
  target: AutomationTarget,
  requestId: string,
  result: UnknownRecord
): Promise<UnknownRecord> {
  const status = isUnknownRecord(result.status) ? result.status : null
  const mutation = status?.mutation
  if (mutation !== 'applied' && mutation !== 'replayed') {
    return result
  }
  const persistence = await requestAutomationPersistence(
    target.store,
    target.store.state.sceneVersion
  )
  if (persistence.status === 'durable') return { ...result, persistence }
  return {
    ...result,
    next_action: {
      command: 'board_verify',
      instruction:
        'Reacquire Board context, verify this same request ID, then reopen the exact Board before claiming persistence. Do not retry with a new request ID.',
      request_id: requestId,
      requires_fresh_context: true,
      retry_mutation: false
    },
    persistence,
    proof: {
      reason: 'persistence_not_acknowledged',
      stage: 'persistence',
      status: 'partial'
    },
    status: {
      ...status,
      attention_required: true,
      command: 'unavailable',
      mutation,
      reason: 'persistence_not_acknowledged'
    }
  }
}

export function createAutomationConnectObjectsHandler(options: ConnectHandlerOptions) {
  return async function connect(target: AutomationTarget, rawArgs: unknown) {
    const startedAt = automationNowMs()
    const stages: AutomationStageTimings = {}
    const preflightStartedAt = automationNowMs()
    const { args, context } = options.requireContext(target, rawArgs)
    if (!canWriteSmylrProductionDocument(target.store)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
      )
    }
    const requestId = requiredString(args, 'request_id')
    const input = parseConnectObjectsInputStructure(args)
    const route = 'connect_objects'
    const taskId = trimmedString(args, 'task_id')
    const traceId = trimmedString(args, 'trace_id')
    const inputDigest = await mutationRequestSignature(route, {
      input,
      ...(taskId ? { taskId } : {}),
      ...(traceId ? { traceId } : {})
    })
    stages.preflight_ms = automationElapsedMs(preflightStartedAt)
    const result = await coalesceAutomationMutationRequest({
      inputDigest,
      requestId,
      run: async () => {
        const stored = existingReceipt(target, requestId)
        if (stored) {
          if (stored.inputDigest !== inputDigest || stored.route !== route) {
            throw new Error(`Request "${requestId}" was already used for a different mutation.`)
          }
          const replayStartedAt = automationNowMs()
          const replay = await replayConnection(
            target,
            stored,
            options.issueContext,
            options.presentationFrame
          )
          stages.replay_reconciliation_ms = automationElapsedMs(replayStartedAt)
          return withConnectionPersistence(target, requestId, replay)
        }

        assertSafeConnectObjectsIntent(input)

        const expectedRevision = requiredExpectedRevision(args, context)
        if (target.store.state.sceneVersion !== context.boardRevision) {
          throw new Error('Board revision is stale. Reacquire context before changing the Board.')
        }
        const mutationStartedAt = automationNowMs()
        const outcome = await enqueueAutomationMutation({
          metadata: {
            expectedRevision,
            requestId,
            ...(taskId ? { taskId } : {}),
            ...(traceId ? { traceId } : {})
          },
          target,
          toolArgs: {
            kind: input.kind,
            source_id: input.sourceNodeId,
            target_id: input.targetNodeId
          },
          toolName: 'connect_objects',
          run: async () => {
            assertMutationRequestIdFresh(target, requestId)
            reserveMutationRequest(target, {
              inputDigest,
              requestId,
              route,
              version: 1
            })
            const connection = connectObjects(target.store, input)
            if (!connection) {
              throw new Error(
                'The Object Graph connection was refused. Confirm distinct current-page endpoints, supported ports, and that the same connection does not already exist.'
              )
            }
            try {
              recordMutationRequestReceipt(target, {
                inputDigest,
                mutationReceipt: {
                  appliedRevision: target.store.state.sceneVersion + 1,
                  enqueuedRevision: expectedRevision,
                  expectedRevision,
                  requestId,
                  status: 'applied',
                  touchedProperties: [`${target.pageId}:*`],
                  ...(taskId ? { taskId } : {}),
                  ...(traceId ? { traceId } : {})
                },
                objectIds: [connection.sourceNodeId, connection.targetNodeId],
                requestId,
                result: { ...connection, pageId: target.pageId },
                route,
                semanticIds: [connection.id],
                ...(taskId ? { taskId } : {}),
                ...(traceId ? { traceId } : {}),
                version: 1
              })
            } catch (error) {
              target.store.undo.undo()
              throw error
            }
            return { connection }
          }
        })
        stages.mutation_ms = automationElapsedMs(mutationStartedAt)
        if (outcome.status === 'rejected') {
          return {
            receipt: outcome.receipt,
            status: {
              attention_required: true,
              command: 'refused',
              mutation: 'not_applied'
            }
          }
        }
        const presentationStartedAt = automationNowMs()
        const presentation = await connectionPresentation(
          target,
          outcome.value.connection,
          options.presentationFrame
        )
        stages.presentation_ms = automationElapsedMs(presentationStartedAt)
        const presentationReason = connectionPresentationReason(presentation)
        return withConnectionPersistence(target, requestId, {
          context: options.issueContext(target),
          ...(presentationReason ? { next_action: connectionNextAction(requestId) } : {}),
          presentation: presentation.frame,
          readback: {
            object_graph_connection: outcome.value.connection,
            ...(presentation.visual ? { object_graph_visual: presentation.visual } : {}),
            ...(presentation.visualError
              ? { object_graph_visual_error: presentation.visualError }
              : {})
          },
          receipt: {
            ...outcome.receipt,
            history_label: `Connect objects with ${outcome.value.connection.kind}`,
            idempotent_replay: false,
            product_grade_path: true,
            semantic_owner: {
              owner_id: outcome.value.connection.id,
              root_object_id: target.pageId
            }
          },
          ...(presentationReason
            ? {
                proof: {
                  reason: presentationReason,
                  stage: 'presentation',
                  status: 'partial'
                }
              }
            : {}),
          status: {
            attention_required: Boolean(presentationReason),
            command: presentationReason ? 'unavailable' : 'completed',
            mutation: 'applied',
            ...(presentationReason ? { reason: presentationReason } : {})
          }
        })
      },
      target
    })
    return withAutomationStageTiming(result, startedAt, stages)
  }
}
