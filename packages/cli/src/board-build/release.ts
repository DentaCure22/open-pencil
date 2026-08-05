import type { AppRpcTarget } from '#cli/app-client'

type BoardJsonObject = { [key: string]: unknown }

const OPTIONAL_LIVE_PROOF_KEYS = new Set([
  'code_object_interaction',
  'code_object_runtime',
  'normal_editor_undo',
  'pixels',
  'presentation',
  'runtime'
])

const OPTIONAL_LIVE_PROOF_REASONS = new Set(['code_object_runtime_unavailable', 'no_live_runtime'])

type BoardBuildReleaseStatus = 'ready' | 'stop' | 'unknown'

export type BoardBuildTarget = {
  content_document_id: string | null
  document_id: string | null
  page_id: string | null
  page_name: string | null
  runtime_instance_id: string | null
  workspace_id: string | null
}

export type BoardBuildNextTarget = {
  content_document_id: string
  document_id: string
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

export type BoardBuildReleaseSummary = {
  artifact_count: number | null
  connection_count: number | null
  contract: 'board-build-release/v1'
  message: string
  next_build_target: BoardBuildNextTarget | null
  proof_limitations: string[]
  request_id: string | null
  revision: number | null
  status: BoardBuildReleaseStatus
  target: BoardBuildTarget
}

export type BoardBuildReleaseEnvelope = {
  current_revision?: unknown
  release_summary: BoardBuildReleaseSummary
  error?: unknown
  failure_scope?: unknown
  fresh_context_handshake: unknown
  intent_compilation?: unknown
  next_action?: unknown
  next_build_target: BoardBuildNextTarget | null
  persistence: unknown
  proof: unknown
  recipe_compilation?: unknown
  receipt: unknown
  status: unknown
  target: BoardBuildReleaseSummary['target']
  timing: unknown
  trace?: unknown
}

function record(value: unknown): BoardJsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as BoardJsonObject)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function exactTarget(target: AppRpcTarget | undefined, result: BoardJsonObject) {
  const fallback = record(result.target)
  return {
    content_document_id: target?.contentDocumentId ?? stringValue(fallback?.content_document_id),
    document_id: target?.documentId ?? stringValue(fallback?.document_id),
    page_id: target?.pageId ?? stringValue(fallback?.page_id),
    page_name: target?.pageName ?? stringValue(fallback?.page_name),
    runtime_instance_id: target?.runtimeInstanceId ?? stringValue(fallback?.runtime_instance_id),
    workspace_id: target?.workspaceId ?? stringValue(fallback?.workspace_id)
  }
}

function exactTargetLabel(target: ReturnType<typeof exactTarget>): string {
  const page = target.page_name ?? target.page_id ?? 'unknown Board'
  const document = target.document_id ?? 'unknown document'
  return `${document} / ${page}`
}

function nextBuildTarget(
  persistence: BoardJsonObject | null,
  target: BoardBuildTarget
): BoardBuildNextTarget | null {
  if (persistence?.status !== 'durable') return null
  const authorityId = stringValue(persistence.authority_id)
  const contentDocumentId = target.content_document_id
  const documentId = target.document_id
  const pageId = target.page_id
  const workspaceId = target.workspace_id
  if (!authorityId || !contentDocumentId || !documentId || !pageId || !workspaceId) return null
  return {
    content_document_id: contentDocumentId,
    document_id: documentId,
    page_id: pageId,
    runtime_instance_id: authorityId.startsWith('local-authority:')
      ? authorityId
      : `local-authority:${authorityId}`,
    workspace_id: workspaceId
  }
}

function itemCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length
  const object = record(value)
  return object ? Object.keys(object).length : null
}

function artifactCount(result: BoardJsonObject, receipt: BoardJsonObject | null): number | null {
  for (const candidate of [result.owner_ids, receipt?.owner_ids, result.aliases]) {
    const count = itemCount(candidate)
    if (count !== null) return count
  }
  return stringValue(result.owner_id) ? 1 : null
}

function releaseReceipt(
  result: BoardJsonObject,
  receipt: BoardJsonObject | null
): BoardJsonObject | null {
  if (!receipt) return null
  if (itemCount(receipt.owner_ids) !== null) return receipt
  if (itemCount(result.owner_ids) !== null) {
    return { ...receipt, owner_ids: structuredClone(result.owner_ids) }
  }
  const ownerId = stringValue(result.owner_id)
  return ownerId ? { ...receipt, owner_ids: { artifact: ownerId } } : receipt
}

function connectionCount(result: BoardJsonObject, receipt: BoardJsonObject | null): number | null {
  for (const candidate of [result.connection_ids, receipt?.connection_ids]) {
    const count = itemCount(candidate)
    if (count !== null) return count
  }
  const readback = record(result.readback)
  const plan = record(readback?.plan)
  return itemCount(readback?.object_graph_connections ?? plan?.connections)
}

function finalRevision(
  result: BoardJsonObject,
  receipt: BoardJsonObject | null,
  persistence: BoardJsonObject | null,
  target: AppRpcTarget | undefined
): number | null {
  for (const candidate of [
    result.final_revision,
    receipt?.appliedRevision,
    receipt?.applied_revision,
    persistence?.authority_revision,
    target?.boardRevision
  ]) {
    const revision = numberValue(candidate)
    if (revision !== null) return revision
  }
  return null
}

function proofLimitations(result: BoardJsonObject): string[] {
  const limitations = new Set<string>()
  const proof = record(result.proof)
  if (proof) {
    for (const key of Object.keys(proof).sort()) {
      const value = proof[key]
      if (value === 'passed' || value === 'current' || value === 'durable' || value === true) {
        continue
      }
      if (
        OPTIONAL_LIVE_PROOF_KEYS.has(key) &&
        (value === 'not_evaluated' || value === 'unavailable')
      ) {
        continue
      }
      if (key === 'reason' && typeof value === 'string' && OPTIONAL_LIVE_PROOF_REASONS.has(value)) {
        continue
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        limitations.add(`${key}:${String(value)}`)
      }
    }
  } else if (
    stringValue(result.failure_scope) !== 'pre_mutation' ||
    stringValue(record(result.status)?.mutation) !== 'not_applied'
  ) {
    limitations.add('proof:not_reported')
  }
  const presentation = record(result.presentation)
  const presentationReason = stringValue(presentation?.reason)
  if (
    presentation &&
    presentation.acknowledged !== true &&
    (!presentationReason || !OPTIONAL_LIVE_PROOF_REASONS.has(presentationReason))
  ) {
    limitations.add(`presentation:${stringValue(presentation.status) ?? 'not_acknowledged'}`)
  }
  return [...limitations].sort()
}

function releaseProof(value: unknown): unknown {
  const proof = record(value)
  if (!proof) return value ?? null
  const compact = Object.fromEntries(
    Object.entries(proof).filter(([key, entry]) => {
      if (
        OPTIONAL_LIVE_PROOF_KEYS.has(key) &&
        (entry === 'not_evaluated' || entry === 'unavailable')
      ) {
        return false
      }
      return !(
        key === 'reason' &&
        typeof entry === 'string' &&
        OPTIONAL_LIVE_PROOF_REASONS.has(entry)
      )
    })
  )
  return Object.keys(compact).length > 0 ? compact : null
}

function countLabel(count: number | null, singular: string, plural: string): string {
  if (count === null) return `an unreported number of ${plural}`
  return `${count} ${count === 1 ? singular : plural}`
}

function isConclusiveSuccess(options: {
  command: string | null
  mutation: string | null
  persistence: BoardJsonObject | null
  readback: BoardJsonObject | null
  receipt: BoardJsonObject | null
  revision: number | null
}): boolean {
  const receiptStatus = stringValue(options.receipt?.status)
  return (
    options.command === 'completed' &&
    (options.mutation === 'applied' || options.mutation === 'replayed') &&
    options.receipt !== null &&
    (receiptStatus === null || receiptStatus === 'applied' || receiptStatus === 'committed') &&
    options.persistence?.status === 'durable' &&
    options.readback !== null &&
    Object.keys(options.readback).length > 0 &&
    options.revision !== null
  )
}

export function boardBuildReleaseSummary(
  result: BoardJsonObject,
  target: AppRpcTarget | undefined
): BoardBuildReleaseSummary {
  const status = record(result.status)
  const mutation = stringValue(status?.mutation)
  const command = stringValue(status?.command)
  const receipt = record(result.receipt) ?? record(result.mutation_receipt)
  const persistence = record(result.persistence)
  const readback = record(result.readback)
  const resolvedTarget = exactTarget(target, result)
  const artifacts = artifactCount(result, receipt)
  const connections = connectionCount(result, receipt)
  const revision = finalRevision(result, receipt, persistence, target)
  const requestId =
    stringValue(receipt?.requestId) ??
    stringValue(receipt?.request_id) ??
    stringValue(record(result.next_action)?.request_id)
  const limitations = proofLimitations(result)
  const failureScope = stringValue(result.failure_scope)
  const conclusiveSuccess = isConclusiveSuccess({
    command,
    mutation,
    persistence,
    readback,
    receipt,
    revision
  })

  if (conclusiveSuccess) {
    const exactConnectionCount = connections ?? 0
    const limitationText = limitations.length > 0 ? ` Proof limits: ${limitations.join(', ')}.` : ''
    return {
      artifact_count: artifacts,
      connection_count: exactConnectionCount,
      contract: 'board-build-release/v1',
      message: `Board build ${mutation} durably on ${exactTargetLabel(resolvedTarget)}: ${countLabel(artifacts, 'artifact', 'artifacts')} and ${countLabel(exactConnectionCount, 'connection', 'connections')} at revision ${String(revision)}.${limitationText}`,
      next_build_target: nextBuildTarget(persistence, resolvedTarget),
      proof_limitations: limitations,
      request_id: requestId,
      revision,
      status: 'ready',
      target: resolvedTarget
    }
  }

  const reason = stringValue(record(result.error)?.message) ?? stringValue(status?.reason)
  if (
    mutation === 'not_applied' &&
    (command !== 'unavailable' || failureScope === 'pre_mutation')
  ) {
    return {
      artifact_count: 0,
      connection_count: 0,
      contract: 'board-build-release/v1',
      message: `Board build stopped without mutation on ${exactTargetLabel(resolvedTarget)}${reason ? `: ${reason}` : '.'}`,
      next_build_target: null,
      proof_limitations: limitations,
      request_id: requestId,
      revision,
      status: 'stop',
      target: resolvedTarget
    }
  }

  return {
    artifact_count: artifacts,
    connection_count: connections,
    contract: 'board-build-release/v1',
    message: `Board build outcome is unknown on ${exactTargetLabel(resolvedTarget)}; do not claim success or start a new mutation. Recover the same request ID.`,
    next_build_target: null,
    proof_limitations: limitations,
    request_id: requestId,
    revision,
    status: 'unknown',
    target: resolvedTarget
  }
}

export function withBoardBuildReleaseSummary(
  result: BoardJsonObject,
  target: AppRpcTarget | undefined
): BoardJsonObject & { release_summary: BoardBuildReleaseSummary } {
  return { ...result, release_summary: boardBuildReleaseSummary(result, target) }
}

export function boardBuildReleaseEnvelope(
  result: BoardJsonObject,
  target: AppRpcTarget | undefined
): BoardBuildReleaseEnvelope {
  const releaseSummary = boardBuildReleaseSummary(result, target)
  const receipt = releaseReceipt(result, record(result.receipt) ?? record(result.mutation_receipt))
  return {
    ...(result.current_revision === undefined ? {} : { current_revision: result.current_revision }),
    release_summary: releaseSummary,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.failure_scope === undefined ? {} : { failure_scope: result.failure_scope }),
    fresh_context_handshake: result.fresh_context_handshake ?? null,
    ...(result.intent_compilation === undefined
      ? {}
      : { intent_compilation: result.intent_compilation }),
    ...(result.next_action === undefined ? {} : { next_action: result.next_action }),
    next_build_target: releaseSummary.next_build_target,
    persistence: result.persistence ?? null,
    proof: releaseProof(result.proof),
    ...(result.recipe_compilation === undefined
      ? {}
      : { recipe_compilation: result.recipe_compilation }),
    receipt,
    status: result.status ?? null,
    target: releaseSummary.target,
    timing: result.timing ?? null,
    ...(result.trace === undefined ? {} : { trace: result.trace })
  }
}
