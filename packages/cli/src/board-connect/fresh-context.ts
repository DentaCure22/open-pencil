import { getAppToken, rpcEnvelopeExact, type AppRpcEnvelope } from '#cli/app-client'
import {
  resolveExactVisibleTopLevelObjectId,
  type ExactFreshContextTarget
} from '#cli/board-build/fresh-context'
import {
  assertFreshContextTarget as assertExactTarget,
  type BoardJsonObject,
  freshContextElapsed as elapsed,
  type FreshContextMetrics,
  isBoardJsonObject
} from '#cli/fresh-context/shared'

export type FreshBoardConnectLogicalArgs = {
  automatic?: boolean
  kind: 'action' | 'data' | 'visual'
  label?: string
  request_id: string
  source_id: string
  source_port?: string
  target_id: string
  target_port?: string
  task_id?: string
  trace_id?: string
}

export type BoardConnectRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<BoardJsonObject>>

export type FreshBoardConnectHandshake = {
  contract: 'board-connect-fresh-context/v2'
  handshake_elapsed_ms: FreshContextMetrics<'connect_objects'>
  resolved_source_object_id?: string
  resolved_target_object_id?: string
  semantic_rpc_calls: FreshContextMetrics<'connect_objects'>
  stale_recovery_count: 0 | 1
}

export type FreshBoardConnectExecution = {
  handshake: FreshBoardConnectHandshake
  response: AppRpcEnvelope<BoardJsonObject>
}

type MonotonicClock = () => number

export type FreshBoardConnectOptions = {
  now?: MonotonicClock
  send?: BoardConnectRpcSender
  sourceName?: string
  targetName?: string
}

type FreshConnectObjectsBase = {
  base: BoardJsonObject
  expectedRevision: number
}

const TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'runtime_instance_id',
  'workspace_id'
] as const
const CONNECT_OBJECTS_BASE_FIELDS = new Set([
  ...TARGET_FIELDS,
  'context_token',
  'expected_revision'
])
const LOGICAL_FIELDS = new Set([
  'automatic',
  'kind',
  'label',
  'request_id',
  'source_id',
  'source_port',
  'target_id',
  'target_port',
  'task_id',
  'trace_id'
])
const CONNECTION_KINDS = new Set(['action', 'data', 'visual'])
const CONNECTION_PORT_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u
const CONNECT_CAPABILITY = 'board.change.object_graph.connect'

function assertSupportedFields(
  value: BoardJsonObject,
  supported: Set<string>,
  label: string
): void {
  const unexpected = Object.keys(value).filter((field) => !supported.has(field))
  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains unexpected or authority fields: ${unexpected.sort().join(', ')}.`
    )
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Fresh-context ${field} must be a non-empty string.`)
  }
  return value.trim()
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, field)
}

function connectionKind(value: unknown): FreshBoardConnectLogicalArgs['kind'] {
  const kind = requiredString(value, 'kind')
  if (!CONNECTION_KINDS.has(kind)) {
    throw new Error('Fresh-context kind must be visual, data, or action.')
  }
  return kind as FreshBoardConnectLogicalArgs['kind']
}

function connectionPort(
  value: unknown,
  field: string
): FreshBoardConnectLogicalArgs['source_port'] {
  const port = optionalString(value, field)
  if (port && !CONNECTION_PORT_PATTERN.test(port)) {
    throw new Error(`Fresh-context ${field} must be a side or stable named port ID.`)
  }
  return port
}

export function normalizeFreshBoardConnectLogical(value: unknown): FreshBoardConnectLogicalArgs {
  if (!isBoardJsonObject(value)) {
    throw new Error('Fresh-context logical connector payload must be an object.')
  }
  assertSupportedFields(value, LOGICAL_FIELDS, 'Fresh-context logical connector payload')
  if (value.automatic !== undefined && typeof value.automatic !== 'boolean') {
    throw new Error('Fresh-context automatic must be a boolean.')
  }
  const kind = connectionKind(value.kind)
  if (kind === 'visual' && value.automatic === true) {
    throw new Error('Fresh-context visual connections cannot be automatic.')
  }
  if (kind !== 'visual' && typeof value.automatic !== 'boolean') {
    throw new Error(
      'Fresh-context data and action connections require explicit automatic true or false.'
    )
  }
  const sourceId = requiredString(value.source_id, 'source_id')
  const targetId = requiredString(value.target_id, 'target_id')
  if (sourceId === targetId) {
    throw new Error('Fresh-context source_id and target_id must identify different objects.')
  }
  const label = optionalString(value.label, 'label')
  if (label && label.length > 80) {
    throw new Error('Fresh-context label exceeds 80 characters.')
  }
  const sourcePort = connectionPort(value.source_port, 'source_port')
  const targetPort = connectionPort(value.target_port, 'target_port')
  const taskId = optionalString(value.task_id, 'task_id')
  const traceId = optionalString(value.trace_id, 'trace_id')
  return {
    ...(typeof value.automatic === 'boolean' ? { automatic: value.automatic } : {}),
    kind,
    ...(label ? { label } : {}),
    request_id: requiredString(value.request_id, 'request_id'),
    source_id: sourceId,
    ...(sourcePort ? { source_port: sourcePort } : {}),
    target_id: targetId,
    ...(targetPort ? { target_port: targetPort } : {}),
    ...(taskId ? { task_id: taskId } : {}),
    ...(traceId ? { trace_id: traceId } : {})
  }
}

function freshConnectObjectsBase(
  context: unknown,
  target: ExactFreshContextTarget
): FreshConnectObjectsBase {
  if (!isBoardJsonObject(context)) {
    throw new Error('Fresh Board context did not return an object.')
  }
  if (!Array.isArray(context.capabilities) || !context.capabilities.includes(CONNECT_CAPABILITY)) {
    throw new Error(
      'Fresh Board context lacks writer board.change.object_graph.connect capability.'
    )
  }
  const value = context.connect_objects_base
  if (!isBoardJsonObject(value)) {
    throw new Error('Fresh Board context did not return connect_objects_base.')
  }
  assertSupportedFields(value, CONNECT_OBJECTS_BASE_FIELDS, 'Fresh connect_objects_base')
  const mismatches = TARGET_FIELDS.filter((field) => value[field] !== target[field])
  if (mismatches.length > 0) {
    throw new Error(
      `Fresh Board context returned connect_objects_base for the wrong exact target: ${mismatches.join(', ')}.`
    )
  }
  if (typeof value.context_token !== 'string' || !value.context_token.trim()) {
    throw new Error('Fresh Board context returned connect_objects_base without a context token.')
  }
  if (
    typeof value.expected_revision !== 'number' ||
    !Number.isInteger(value.expected_revision) ||
    value.expected_revision < 0
  ) {
    throw new Error('Fresh Board context returned connect_objects_base without a valid revision.')
  }
  return { base: value, expectedRevision: value.expected_revision }
}

function isConclusiveStaleContext(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Board context is stale. Reacquire context; do not retarget the operation.') ||
    /^Expected revision \d+, current revision is \d+$/.test(message)
  )
}

function withResolvedNames(
  logical: FreshBoardConnectLogicalArgs,
  context: unknown,
  target: ExactFreshContextTarget,
  options: FreshBoardConnectOptions
): {
  logical: FreshBoardConnectLogicalArgs
  resolvedSourceId?: string
  resolvedTargetId?: string
} {
  const sourceName = options.sourceName?.trim()
  const targetName = options.targetName?.trim()
  const resolvedSourceId = sourceName
    ? resolveExactVisibleTopLevelObjectId(context, target.page_id, sourceName, '--source-name')
    : undefined
  const resolvedTargetId = targetName
    ? resolveExactVisibleTopLevelObjectId(context, target.page_id, targetName, '--target-name')
    : undefined
  const resolved = {
    ...logical,
    ...(resolvedSourceId ? { source_id: resolvedSourceId } : {}),
    ...(resolvedTargetId ? { target_id: resolvedTargetId } : {})
  }
  if (resolved.source_id === resolved.target_id) {
    throw new Error('Fresh-context resolved source and target must identify different objects.')
  }
  return { logical: resolved, resolvedSourceId, resolvedTargetId }
}

export async function connectWithFreshContext(
  target: ExactFreshContextTarget,
  logical: FreshBoardConnectLogicalArgs,
  options: FreshBoardConnectOptions = {}
): Promise<FreshBoardConnectExecution> {
  const normalizedLogical = normalizeFreshBoardConnectLogical(logical)
  const send = options.send ?? rpcEnvelopeExact<BoardJsonObject>
  const now = options.now ?? (() => performance.now())
  if (!options.send) await getAppToken()
  const started = now()
  let connectElapsed = 0
  let contextElapsed = 0
  let connectCalls = 0
  let contextCalls = 0
  let phaseStarted = started
  let resolvedSourceId: string | undefined
  let resolvedTargetId: string | undefined

  for (const attempt of [0, 1] as const) {
    const contextStarted = phaseStarted
    const context = await send('board_context', target)
    const contextFinished = now()
    contextCalls += 1
    contextElapsed += elapsed(contextStarted, contextFinished)
    assertExactTarget(context.target, target, 'Fresh Board context')
    const { base, expectedRevision } = freshConnectObjectsBase(context.result, target)
    if (context.target.boardRevision !== expectedRevision) {
      throw new Error(
        'Fresh Board context target revision does not match connect_objects_base.expected_revision.'
      )
    }
    const resolved = withResolvedNames(normalizedLogical, context.result, target, options)
    resolvedSourceId = resolved.resolvedSourceId ?? resolvedSourceId
    resolvedTargetId = resolved.resolvedTargetId ?? resolvedTargetId
    const connectStarted = contextFinished
    try {
      connectCalls += 1
      const response = await send('connect_objects', { ...resolved.logical, base })
      const connectFinished = now()
      connectElapsed += elapsed(connectStarted, connectFinished)
      assertExactTarget(response.target, target, 'Fresh Object Graph connection')
      return {
        handshake: {
          contract: 'board-connect-fresh-context/v2',
          handshake_elapsed_ms: {
            board_context: Math.round(contextElapsed * 100) / 100,
            connect_objects: Math.round(connectElapsed * 100) / 100,
            total: elapsed(started, connectFinished)
          },
          ...(resolvedSourceId ? { resolved_source_object_id: resolvedSourceId } : {}),
          ...(resolvedTargetId ? { resolved_target_object_id: resolvedTargetId } : {}),
          semantic_rpc_calls: {
            board_context: contextCalls,
            connect_objects: connectCalls,
            total: contextCalls + connectCalls
          },
          stale_recovery_count: attempt
        },
        response
      }
    } catch (error) {
      const connectFinished = now()
      connectElapsed += elapsed(connectStarted, connectFinished)
      phaseStarted = connectFinished
      if (attempt === 0 && isConclusiveStaleContext(error)) continue
      throw error
    }
  }

  throw new Error('Fresh Object Graph connection exhausted its bounded stale-context recovery.')
}
