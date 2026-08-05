import type { EvaluationConfiguration } from './evaluation-config'
import type { PromptToBoardScenario } from './scenario-manifest'
import type { EvalTarget } from './schema'

const STRAIGHT_THROUGH_MODALITIES = new Set(['native_card', 'native_text', 'object_connection'])

type UnknownRecord = Record<string, unknown>

export type StraightThroughFallbackReason =
  | 'browser_required'
  | 'missing_exact_target'
  | 'missing_request_id'
  | 'not_artifact_success'
  | 'not_cold_measurement'
  | 'not_fresh_session'
  | 'not_opted_in'
  | 'output_schema_required'
  | 'release_not_ready'
  | 'resume_requested'
  | 'unsupported_modality'
  | 'visibility_required'

export type StraightThroughFailureReason =
  | 'artifact_ownership_mismatch'
  | 'artifact_ownership_missing'
  | 'command_not_completed'
  | 'invalid_envelope'
  | 'mutation_not_applied_or_replayed'
  | 'persistence_not_durable'
  | 'receipt_missing'
  | 'receipt_status_invalid'
  | 'release_contract_mismatch'
  | 'release_message_missing'
  | 'release_status_invalid'
  | 'request_id_mismatch'
  | 'revision_invalid'
  | 'revision_mismatch'
  | 'target_configuration_mismatch'
  | 'target_mismatch'

export interface StraightThroughRunInput {
  configuration: Readonly<EvaluationConfiguration>
  enabled: boolean
  exactTarget: Readonly<EvalTarget> | null
  outputSchemaPath?: string | null
  requestId: string | null
  resumeThreadId?: string | null
  scenario: Readonly<PromptToBoardScenario>
}

export interface StraightThroughEligible {
  expected_request_id: string
  expected_target: EvalTarget
  status: 'eligible'
}

export interface StraightThroughFallback {
  detail: string
  reason: StraightThroughFallbackReason
  status: 'fallback'
}

export interface StraightThroughFailure {
  detail: string
  reason: StraightThroughFailureReason
  status: 'fail'
}

export type StraightThroughEligibility =
  | StraightThroughEligible
  | StraightThroughFailure
  | StraightThroughFallback

export interface StraightThroughReleaseTarget extends EvalTarget {
  page_name: string | null
}

export interface StraightThroughReleaseSummary {
  artifact_count: number
  connection_count: number | null
  contract: 'board-build-release/v1'
  message: string
  proof_limitations: string[]
  request_id: string
  revision: number
  status: 'ready'
  target: StraightThroughReleaseTarget
}

export interface StraightThroughFinalPlan {
  action: 'release_and_terminate'
  contract: 'prompt-to-board-straight-through-final/v1'
  final_origin: 'board_build_release_summary'
  release_summary: StraightThroughReleaseSummary
  request_id: string
  revision: number
  target: EvalTarget
  text: string
}

export interface StraightThroughReleaseInput extends StraightThroughRunInput {
  envelope: unknown
}

export type StraightThroughReleaseDecision =
  | StraightThroughFailure
  | StraightThroughFallback
  | { plan: StraightThroughFinalPlan; status: 'release' }

function fallback(reason: StraightThroughFallbackReason, detail: string): StraightThroughFallback {
  return { detail, reason, status: 'fallback' }
}

function failure(reason: StraightThroughFailureReason, detail: string): StraightThroughFailure {
  return { detail, reason, status: 'fail' }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function sameTarget(left: Readonly<EvalTarget>, right: Readonly<EvalTarget>): boolean {
  return (
    left.content_document_id === right.content_document_id &&
    left.document_id === right.document_id &&
    left.page_id === right.page_id &&
    left.runtime_instance_id === right.runtime_instance_id &&
    left.workspace_id === right.workspace_id
  )
}

function configurationTarget(configuration: Readonly<EvaluationConfiguration>): EvalTarget {
  return {
    content_document_id: configuration.board.content_document_id,
    document_id: configuration.board.document_id,
    page_id: configuration.board.page_id,
    runtime_instance_id: configuration.board.runtime_instance_id,
    workspace_id: configuration.board.workspace_id
  }
}

function parseTarget(value: unknown): StraightThroughReleaseTarget | null {
  const candidate = record(value)
  if (!candidate) return null
  const contentDocumentId = nonEmptyString(candidate.content_document_id)
  const documentId = nonEmptyString(candidate.document_id)
  const pageId = nonEmptyString(candidate.page_id)
  const runtimeInstanceId = nonEmptyString(candidate.runtime_instance_id)
  const workspaceId = nonEmptyString(candidate.workspace_id)
  if (!contentDocumentId || !documentId || !pageId || !runtimeInstanceId || !workspaceId) {
    return null
  }
  const pageNameValue = candidate.page_name
  if (pageNameValue !== null && pageNameValue !== undefined && !nonEmptyString(pageNameValue)) {
    return null
  }
  return {
    content_document_id: contentDocumentId,
    document_id: documentId,
    page_id: pageId,
    page_name: nonEmptyString(pageNameValue),
    runtime_instance_id: runtimeInstanceId,
    workspace_id: workspaceId
  }
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const values = value.map(nonEmptyString)
  return values.every((item): item is string => item !== null) ? values : null
}

function ownerIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const ownerId = nonEmptyString(item)
      return ownerId ? [ownerId] : []
    })
  }
  const candidate = record(value)
  if (!candidate) return []
  return Object.values(candidate).flatMap((item) => {
    const ownerId = nonEmptyString(item)
    return ownerId ? [ownerId] : []
  })
}

function receiptOwnerIds(receipt: UnknownRecord): string[] {
  const semanticOwner = record(receipt.semantic_owner)
  const owners = [
    ...ownerIds(receipt.owner_ids),
    ...ownerIds(semanticOwner?.owner_ids),
    nonEmptyString(receipt.owner_id),
    nonEmptyString(semanticOwner?.owner_id)
  ].filter((item): item is string => item !== null)
  return [...new Set(owners)]
}

function aliasedString(recordValue: UnknownRecord, camel: string, snake: string): string | null {
  const camelValue = nonEmptyString(recordValue[camel])
  const snakeValue = nonEmptyString(recordValue[snake])
  return camelValue && snakeValue && camelValue !== snakeValue ? null : (camelValue ?? snakeValue)
}

function aliasedRevision(recordValue: UnknownRecord, camel: string, snake: string): number | null {
  const camelValue =
    recordValue[camel] === undefined ? undefined : nonNegativeInteger(recordValue[camel])
  const snakeValue =
    recordValue[snake] === undefined ? undefined : nonNegativeInteger(recordValue[snake])
  if (camelValue === null || snakeValue === null) return null
  if (camelValue !== undefined && snakeValue !== undefined && camelValue !== snakeValue) return null
  return camelValue ?? snakeValue ?? null
}

export function evaluateStraightThroughEligibility(
  input: StraightThroughRunInput
): StraightThroughEligibility {
  if (!input.enabled) return fallback('not_opted_in', 'Straight-through release is not enabled.')
  if (input.scenario.expected_outcome !== 'artifact_success') {
    return fallback('not_artifact_success', 'The scenario does not expect an artifact success.')
  }
  if (input.scenario.session_mode !== 'fresh') {
    return fallback('not_fresh_session', 'Warm scenarios require the normal resumable runner.')
  }
  if (!input.configuration.measurement_class.endsWith('_cold')) {
    return fallback('not_cold_measurement', 'Warm measurement classes require the normal runner.')
  }
  if (input.resumeThreadId?.trim()) {
    return fallback('resume_requested', 'A resumed Codex thread cannot terminate straight through.')
  }
  if (input.configuration.browser.required) {
    return fallback('browser_required', 'Browser-required runs need independent visible proof.')
  }
  if (input.scenario.visibility === 'required') {
    return fallback('visibility_required', 'The scenario requires visible proof.')
  }
  if (
    input.scenario.modalities.length === 0 ||
    input.scenario.modalities.some((modality) => !STRAIGHT_THROUGH_MODALITIES.has(modality))
  ) {
    return fallback(
      'unsupported_modality',
      'Only native text/cards and their ordinary Object Graph connections are eligible for straight-through release.'
    )
  }
  if (!input.exactTarget) {
    return fallback('missing_exact_target', 'Straight-through release requires an exact target.')
  }
  const requestId = nonEmptyString(input.requestId)
  if (!requestId) {
    return fallback('missing_request_id', 'Straight-through release requires a request ID.')
  }
  if (input.outputSchemaPath?.trim()) {
    return fallback(
      'output_schema_required',
      'A model-authored output schema requires the normal final-generation path.'
    )
  }
  if (!sameTarget(input.exactTarget, configurationTarget(input.configuration))) {
    return failure(
      'target_configuration_mismatch',
      'The exact target does not match the frozen evaluation configuration.'
    )
  }
  return {
    expected_request_id: requestId,
    expected_target: structuredClone(input.exactTarget),
    status: 'eligible'
  }
}

export function planStraightThroughRelease(
  input: StraightThroughReleaseInput
): StraightThroughReleaseDecision {
  const eligibility = evaluateStraightThroughEligibility(input)
  if (eligibility.status !== 'eligible') return eligibility

  const envelope = record(input.envelope)
  const summary = record(envelope?.release_summary)
  if (!envelope || !summary) {
    return failure('invalid_envelope', 'The Board release envelope or release_summary is missing.')
  }
  if (summary.contract !== 'board-build-release/v1') {
    return failure('release_contract_mismatch', 'The Board release contract is unsupported.')
  }
  if (summary.status === 'stop' || summary.status === 'unknown') {
    return fallback('release_not_ready', `The Board release status is ${String(summary.status)}.`)
  }
  if (summary.status !== 'ready') {
    return failure('release_status_invalid', 'The Board release status is invalid.')
  }

  const status = record(envelope.status)
  if (status?.command !== 'completed') {
    return failure('command_not_completed', 'The Board command did not complete.')
  }
  if (status.mutation !== 'applied' && status.mutation !== 'replayed') {
    return failure(
      'mutation_not_applied_or_replayed',
      'The Board mutation is neither applied nor replayed.'
    )
  }
  const persistence = record(envelope.persistence)
  if (persistence?.status !== 'durable') {
    return failure('persistence_not_durable', 'The Board result is not durably persisted.')
  }
  const receipt = record(envelope.receipt)
  if (!receipt) return failure('receipt_missing', 'The Board mutation receipt is missing.')
  if (receipt.status !== 'applied' && receipt.status !== 'committed') {
    return failure(
      'receipt_status_invalid',
      'The Board mutation receipt is not applied or committed.'
    )
  }

  const receiptRequestId = aliasedString(receipt, 'requestId', 'request_id')
  const summaryRequestId = nonEmptyString(summary.request_id)
  if (
    !receiptRequestId ||
    !summaryRequestId ||
    receiptRequestId !== summaryRequestId ||
    receiptRequestId !== eligibility.expected_request_id
  ) {
    return failure(
      'request_id_mismatch',
      'The release summary, receipt, and frozen request ID do not match.'
    )
  }

  const summaryTarget = parseTarget(summary.target)
  const envelopeTarget = parseTarget(envelope.target)
  if (
    !summaryTarget ||
    !envelopeTarget ||
    !sameTarget(summaryTarget, eligibility.expected_target) ||
    !sameTarget(envelopeTarget, eligibility.expected_target)
  ) {
    return failure(
      'target_mismatch',
      'The release summary or envelope target does not match the frozen exact target.'
    )
  }

  const summaryRevision = nonNegativeInteger(summary.revision)
  const receiptRevision = aliasedRevision(receipt, 'appliedRevision', 'applied_revision')
  const persistenceRevisionValue = persistence.authority_revision
  const persistenceRevision =
    persistenceRevisionValue === undefined
      ? undefined
      : nonNegativeInteger(persistenceRevisionValue)
  if (summaryRevision === null || receiptRevision === null || persistenceRevision === null) {
    return failure('revision_invalid', 'The release revision evidence is missing or invalid.')
  }
  if (
    summaryRevision !== receiptRevision ||
    (persistenceRevision !== undefined && persistenceRevision !== summaryRevision)
  ) {
    return failure(
      'revision_mismatch',
      'The release summary, receipt, and persistence revisions do not agree.'
    )
  }

  const artifacts = nonNegativeInteger(summary.artifact_count)
  const connections =
    summary.connection_count === null ? null : nonNegativeInteger(summary.connection_count)
  const owners = receiptOwnerIds(receipt)
  if (artifacts === null || artifacts === 0 || owners.length === 0) {
    return failure(
      'artifact_ownership_missing',
      'The ready release does not contain nonempty artifact ownership.'
    )
  }
  if (artifacts !== owners.length) {
    return failure(
      'artifact_ownership_mismatch',
      'The artifact count does not match the receipt ownership count.'
    )
  }
  if (connections === null && summary.connection_count !== null) {
    return failure('invalid_envelope', 'The release connection count is invalid.')
  }

  const message = nonEmptyString(summary.message)
  if (!message) return failure('release_message_missing', 'The deterministic final is empty.')
  const limitations = stringList(summary.proof_limitations)
  if (!limitations) {
    return failure('invalid_envelope', 'The release proof limitations are invalid.')
  }

  const releaseSummary: StraightThroughReleaseSummary = {
    artifact_count: artifacts,
    connection_count: connections,
    contract: 'board-build-release/v1',
    message,
    proof_limitations: [...limitations],
    request_id: summaryRequestId,
    revision: summaryRevision,
    status: 'ready',
    target: summaryTarget
  }
  return {
    plan: {
      action: 'release_and_terminate',
      contract: 'prompt-to-board-straight-through-final/v1',
      final_origin: 'board_build_release_summary',
      release_summary: releaseSummary,
      request_id: summaryRequestId,
      revision: summaryRevision,
      target: structuredClone(eligibility.expected_target),
      text: message
    },
    status: 'release'
  }
}
