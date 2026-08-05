import type { nodeSummary } from '../board-tools/readback'
import { isUnknownRecord } from '../target'

export type CodeObjectMutationIdentity = {
  expected_revision: number
  request_id: string
  task_id?: string
  trace_id?: string
}

export type CodeObjectNextAction = {
  command: 'board_verify'
  instruction: string
  request_id: string
  requires_fresh_context: true
  retry_mutation: false
}

export type CodeObjectRuntimeProof = {
  error?: string
  reason: 'runtime_mount_or_render_timeout' | 'runtime_render_failed'
  stage: 'runtime_render'
  status: 'error' | 'partial'
}

export type CodeObjectRuntimeReadback = {
  error?: string
  generation: number | null
  mounted: boolean
  status: 'error' | 'rendered' | 'timeout'
}

export type CodeObjectReadback<TComponent, TExpected> = {
  component?: TComponent
  expected: TExpected
  frame?: ReturnType<typeof nodeSummary>
  reconciliation: {
    reasons: string[]
    status: 'current' | 'diverged' | 'missing'
  }
  runtime?: CodeObjectRuntimeReadback
}

export type CodeObjectResultStatus<TMutation extends string> = {
  attention_required: boolean
  command: 'completed' | 'refused' | 'unavailable'
  mutation: TMutation
  reason?: string
}

export type CodeObjectSemanticOwner = { owner_id: string; root_object_id: string }

export function boundedCodeObjectString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing "${field}".`)
  const normalized = value.trim()
  if (normalized.length > maximum) {
    throw new Error(`Code Object ${field} must contain at most ${maximum} characters.`)
  }
  return normalized
}

export function boundedCodeObjectNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Code Object ${field} must be a finite number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`Code Object ${field} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

export function plainCodeObjectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isUnknownRecord(value)) throw new Error(`Code Object ${field} must be an object.`)
  return structuredClone(value)
}

export function optionalCodeObjectString(
  value: unknown,
  field: string,
  maximum: number
): string | undefined {
  return value === undefined ? undefined : boundedCodeObjectString(value, field, maximum)
}

export function optionalCodeObjectAttribution(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeCodeObjectMutation(
  value: unknown,
  operation: 'create' | 'refine'
): CodeObjectMutationIdentity {
  if (!isUnknownRecord(value)) {
    throw new Error(`Code Object ${operation} requires mutation identity.`)
  }
  const expectedRevision = value.expected_revision
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw new Error(`Code Object ${operation} requires a non-negative mutation.expected_revision.`)
  }
  const taskId = optionalCodeObjectAttribution(value.task_id)
  const traceId = optionalCodeObjectAttribution(value.trace_id)
  return {
    expected_revision: expectedRevision,
    request_id: boundedCodeObjectString(value.request_id, 'mutation.request_id', 240),
    ...(taskId ? { task_id: taskId } : {}),
    ...(traceId ? { trace_id: traceId } : {})
  }
}
