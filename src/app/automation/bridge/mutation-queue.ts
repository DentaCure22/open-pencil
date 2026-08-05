import type { SceneNode } from '@open-pencil/scene-graph'

import type { AutomationTarget } from '@/app/automation/bridge/target'

export type AutomationMutationMetadata = {
  expectedRevision?: number
  requestId?: string
  taskId?: string
  traceId?: string
}

export type AutomationMutationReceipt = {
  appliedRevision: number
  enqueuedRevision: number
  expectedRevision?: number
  reason?: 'stale_board_revision' | 'superseded_by_newer_request' | 'touched_property_changed'
  requestId: string
  status: 'applied' | 'rejected'
  taskId?: string
  touchedProperties: string[]
  traceId?: string
}

type MutationJob = {
  fingerprints: Map<string, string>
  metadata: AutomationMutationMetadata
  requestId: string
  started: boolean
  supersededBy?: string
  touchedProperties: string[]
}

type MutationQueueState = {
  pending: MutationJob[]
  tail: Promise<void>
}

type AutomationMutationRevisionPolicy = 'exact' | 'rebase_create_only'

type InFlightMutationRequest = {
  inputDigest: string
  promise: Promise<unknown>
}

export type AutomationMutationOutcome<T> =
  | { receipt: AutomationMutationReceipt; status: 'applied'; value: T }
  | { receipt: AutomationMutationReceipt; status: 'rejected' }

const mutationQueues = new Map<string, MutationQueueState>()
let inFlightMutationRequests = new WeakMap<
  AutomationTarget['store'],
  Map<string, InFlightMutationRequest>
>()

function queueKey(target: AutomationTarget) {
  return `${target.documentId}:${target.pageId}`
}

function queueFor(target: AutomationTarget) {
  const key = queueKey(target)
  const existing = mutationQueues.get(key)
  if (existing) return existing
  const created: MutationQueueState = { pending: [], tail: Promise.resolve() }
  mutationQueues.set(key, created)
  return created
}

function splitPropertyPath(path: string) {
  const separator = path.lastIndexOf(':')
  return [path.slice(0, separator), path.slice(separator + 1)] as const
}

function overlaps(left: string[], right: string[]) {
  return left.some((leftPath) =>
    right.some((rightPath) => {
      const [leftNode, leftProperty] = splitPropertyPath(leftPath)
      const [rightNode, rightProperty] = splitPropertyPath(rightPath)
      return (
        leftNode === rightNode &&
        (leftProperty === '*' || rightProperty === '*' || leftProperty === rightProperty)
      )
    })
  )
}

function stableValue(value: unknown) {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function propertyFingerprint(target: AutomationTarget, path: string) {
  const [nodeId, property] = splitPropertyPath(path)
  const node = target.store.graph.getNode(nodeId)
  if (!node) return 'missing'
  if (property === '*') return stableValue(node)
  return stableValue(node[property as keyof SceneNode])
}

function captureFingerprints(target: AutomationTarget, paths: string[]) {
  return new Map(paths.map((path) => [path, propertyFingerprint(target, path)]))
}

function fingerprintsChanged(target: AutomationTarget, job: MutationJob) {
  return job.touchedProperties.some(
    (path) => propertyFingerprint(target, path) !== job.fingerprints.get(path)
  )
}

function updateNodeProperties(args: Record<string, unknown>) {
  const aliases: Record<string, string> = {
    corner_radius: 'cornerRadius',
    flow_direction: 'layoutDirection',
    font_size: 'fontSize',
    font_weight: 'fontWeight',
    height: 'size',
    text_direction: 'textDirection',
    width: 'size'
  }
  return Object.keys(args)
    .filter((key) => key !== 'id' && args[key] !== undefined)
    .map((key) => aliases[key] ?? key)
}

export function automationMutationPropertyPaths(
  target: AutomationTarget,
  toolName: string,
  args: Record<string, unknown>
) {
  const nodeId = typeof args.id === 'string' ? args.id : null
  if (nodeId && (toolName === 'set_fill' || toolName === 'set_image_fill')) {
    return [`${nodeId}:fills`]
  }
  if (nodeId && toolName === 'set_stroke') return [`${nodeId}:strokes`]
  if (nodeId && toolName === 'update_node') {
    const properties = [...new Set(updateNodeProperties(args))]
    return properties.length > 0
      ? properties.map((property) => `${nodeId}:${property}`)
      : [`${nodeId}:*`]
  }
  if (nodeId) return [`${nodeId}:*`]
  return [`${target.pageId}:*`]
}

function receipt(
  target: AutomationTarget,
  job: MutationJob,
  enqueuedRevision: number,
  status: AutomationMutationReceipt['status'],
  reason?: AutomationMutationReceipt['reason']
): AutomationMutationReceipt {
  return {
    appliedRevision: target.store.state.sceneVersion,
    enqueuedRevision,
    ...(job.metadata.expectedRevision === undefined
      ? {}
      : { expectedRevision: job.metadata.expectedRevision }),
    ...(reason ? { reason } : {}),
    requestId: job.requestId,
    status,
    ...(job.metadata.taskId ? { taskId: job.metadata.taskId } : {}),
    touchedProperties: job.touchedProperties,
    ...(job.metadata.traceId ? { traceId: job.metadata.traceId } : {})
  }
}

export async function enqueueAutomationMutation<T>(options: {
  metadata?: AutomationMutationMetadata
  revisionPolicy?: AutomationMutationRevisionPolicy
  run: () => Promise<T> | T
  target: AutomationTarget
  touchedProperties?: string[]
  toolArgs: Record<string, unknown>
  toolName: string
}): Promise<AutomationMutationOutcome<T>> {
  const { metadata = {}, revisionPolicy = 'exact', run, target, toolArgs, toolName } = options
  const queue = queueFor(target)
  const enqueuedRevision = target.store.state.sceneVersion
  const requestId = metadata.requestId ?? globalThis.crypto.randomUUID()
  const touchedProperties = options.touchedProperties
    ? [...new Set(options.touchedProperties)]
    : automationMutationPropertyPaths(target, toolName, toolArgs)
  const job: MutationJob = {
    fingerprints: captureFingerprints(target, touchedProperties),
    metadata,
    requestId,
    started: false,
    touchedProperties
  }

  for (const pending of queue.pending) {
    if (!pending.started && overlaps(pending.touchedProperties, touchedProperties)) {
      pending.supersededBy = requestId
    }
  }
  queue.pending.push(job)

  const execute = async (): Promise<AutomationMutationOutcome<T>> => {
    job.started = true
    try {
      if (job.supersededBy) {
        return {
          receipt: receipt(
            target,
            job,
            enqueuedRevision,
            'rejected',
            'superseded_by_newer_request'
          ),
          status: 'rejected'
        }
      }
      if (
        metadata.expectedRevision !== undefined &&
        metadata.expectedRevision !== enqueuedRevision &&
        revisionPolicy === 'exact'
      ) {
        return {
          receipt: receipt(target, job, enqueuedRevision, 'rejected', 'stale_board_revision'),
          status: 'rejected'
        }
      }
      if (fingerprintsChanged(target, job)) {
        return {
          receipt: receipt(target, job, enqueuedRevision, 'rejected', 'touched_property_changed'),
          status: 'rejected'
        }
      }
      const value = await run()
      return {
        receipt: receipt(target, job, enqueuedRevision, 'applied'),
        status: 'applied',
        value
      }
    } finally {
      queue.pending = queue.pending.filter((candidate) => candidate !== job)
    }
  }

  const outcome = queue.tail.then(execute, execute)
  queue.tail = outcome.then(
    () => undefined,
    () => undefined
  )
  return outcome
}

export async function coalesceAutomationMutationRequest<T>(options: {
  inputDigest: string
  requestId: string
  run: () => Promise<T> | T
  target: AutomationTarget
}): Promise<T> {
  const { inputDigest, requestId, run, target } = options
  let pending = inFlightMutationRequests.get(target.store)
  if (!pending) {
    pending = new Map()
    inFlightMutationRequests.set(target.store, pending)
  }
  const concurrent = pending.get(requestId)
  if (concurrent) {
    if (concurrent.inputDigest !== inputDigest) {
      throw new Error(`Request "${requestId}" is already applying a different mutation.`)
    }
    return concurrent.promise as Promise<T>
  }
  const promise = Promise.resolve().then(run)
  pending.set(requestId, { inputDigest, promise })
  try {
    return await promise
  } finally {
    if (pending.get(requestId)?.promise === promise) pending.delete(requestId)
  }
}

export function resetAutomationMutationQueuesForTests() {
  mutationQueues.clear()
  inFlightMutationRequests = new WeakMap()
}
