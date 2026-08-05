import type { ObjectGraphConnectionKind, ObjectGraphPortSide } from '@open-pencil/scene-graph'

import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'
import type { ConnectObjectsInput } from '@/app/object-graph'

import { requiredString, trimmedString } from './input'

const CONNECT_OBJECTS_FIELDS = new Set([
  'automatic',
  'content_document_id',
  'context_token',
  'document_id',
  'expected_revision',
  'kind',
  'label',
  'page_id',
  'request_id',
  'runtime_instance_id',
  'source_id',
  'source_port',
  'target_id',
  'target_port',
  'task_id',
  'trace_id',
  'workspace_id'
])

function rejectUnsupportedFields(value: UnknownRecord): void {
  const unsupported = Object.keys(value)
    .filter((field) => !CONNECT_OBJECTS_FIELDS.has(field))
    .sort()
  if (unsupported.length === 0) return
  throw new Error(`connect_objects received unsupported fields: ${unsupported.join(', ')}.`)
}

function connectionKind(value: string): ObjectGraphConnectionKind {
  if (value === 'action' || value === 'data' || value === 'visual') return value
  throw new Error('connect_objects kind must be "visual", "data", or "action".')
}

const PORT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u

function connectionPort(
  value: string | undefined,
  field: string
): {
  id?: string
  side?: ObjectGraphPortSide
} {
  if (value === undefined) return {}
  if (
    value === 'auto' ||
    value === 'bottom' ||
    value === 'left' ||
    value === 'right' ||
    value === 'top'
  ) {
    return { side: value }
  }
  if (PORT_ID_PATTERN.test(value)) return { id: value, side: 'auto' }
  throw new Error(`${field} must be a side or stable named port ID.`)
}

export function parseConnectObjectsInputStructure(value: unknown): ConnectObjectsInput {
  if (!isUnknownRecord(value)) throw new Error('connect_objects arguments must be an object.')
  rejectUnsupportedFields(value)
  if (value.automatic !== undefined && typeof value.automatic !== 'boolean') {
    throw new Error('connect_objects automatic must be a boolean.')
  }
  const kind = connectionKind(requiredString(value, 'kind'))
  const label = trimmedString(value, 'label')
  const sourcePort = connectionPort(trimmedString(value, 'source_port'), 'source_port')
  const targetPort = connectionPort(trimmedString(value, 'target_port'), 'target_port')
  return {
    ...(typeof value.automatic === 'boolean' ? { automatic: value.automatic } : {}),
    kind,
    ...(label ? { label } : {}),
    sourceNodeId: requiredString(value, 'source_id'),
    ...(sourcePort.side ? { sourcePort: sourcePort.side } : {}),
    ...(sourcePort.id ? { sourcePortId: sourcePort.id } : {}),
    targetNodeId: requiredString(value, 'target_id'),
    ...(targetPort.side ? { targetPort: targetPort.side } : {}),
    ...(targetPort.id ? { targetPortId: targetPort.id } : {})
  }
}

export function assertSafeConnectObjectsIntent(input: ConnectObjectsInput): void {
  if (input.kind === 'visual' && input.automatic === true) {
    throw new Error(
      'connect_objects visual connections cannot be automatic. Omit automatic or set it to false.'
    )
  }
  if (input.kind !== 'visual' && typeof input.automatic !== 'boolean') {
    throw new Error(
      'connect_objects requires explicit automatic true or false for data and action connections.'
    )
  }
}

export function parseConnectObjectsInput(value: unknown): ConnectObjectsInput {
  const input = parseConnectObjectsInputStructure(value)
  assertSafeConnectObjectsIntent(input)
  return input
}
