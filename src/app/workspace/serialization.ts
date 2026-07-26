import { validateActionLifecycleObject } from './action-validation'
import { WorkspaceDomainError } from './errors'
import { validateLearningAttestation } from './learning-attestation'
import { migrateWorkspacePayload } from './migration'
import { WORKSPACE_SCHEMA_VERSION } from './types'
import type {
  KnowledgeWorkspace,
  SurfaceRun,
  WorkspaceObject,
  WorkspaceCodeObjectArtifactRevisionRef,
  WorkspaceObjectType,
  WorkspaceRelation,
  WorkspaceView
} from './types'

const OBJECT_TYPES: ReadonlySet<WorkspaceObjectType> = new Set([
  'document-block',
  'collection',
  'collection-record',
  'saved-view',
  'canvas-object',
  'graph-node',
  'graph-edge',
  'design-artifact',
  'review-object',
  'intent-record',
  'evidence-manifest',
  'surface-run',
  'decision-receipt',
  'learning-receipt',
  'action-proposal',
  'action-execution-receipt',
  'action-verification-receipt',
  'action-rollback-receipt'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value) {
    throw new WorkspaceDomainError('validation_failed', `${key} must be a non-empty string`)
  }
  return value
}

function assertNoInlineData(value: unknown, path = 'workspace'): void {
  if (typeof value === 'string' && value.startsWith('data:')) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${path} contains inline data; store captures as asset references instead`
    )
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoInlineData(child, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) assertNoInlineData(child, `${path}.${key}`)
}

function requireObjectReference(
  workspace: KnowledgeWorkspace,
  objectId: string,
  label: string
): void {
  if (!Object.hasOwn(workspace.objects, objectId)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} references missing object ${objectId}`
    )
  }
}

function requireObjectRevisionReference(
  workspace: KnowledgeWorkspace,
  reference: { objectId: string; revision: number },
  expectedType: WorkspaceObjectType,
  label: string
): WorkspaceObject {
  requireObjectReference(workspace, reference.objectId, label)
  const object = workspace.objects[reference.objectId]
  if (object.type !== expectedType || object.revision !== reference.revision) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} must reference exact ${expectedType} revision ${reference.revision}`
    )
  }
  return object
}

function requireUniqueStrings(values: string[], label: string): void {
  if (new Set(values).size !== values.length || values.some((value) => !value)) {
    throw new WorkspaceDomainError('validation_failed', `${label} must contain unique IDs`)
  }
}

function validateArtifactReference(
  artifact: WorkspaceCodeObjectArtifactRevisionRef,
  label: string
): void {
  if (
    artifact.kind !== 'code-object' ||
    !artifact.artifactId ||
    !artifact.boardId ||
    !artifact.sourceHash ||
    !Number.isInteger(artifact.boardRevision) ||
    artifact.boardRevision < 1 ||
    !Number.isInteger(artifact.boardSchemaVersion) ||
    artifact.boardSchemaVersion < 1
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} must identify one exact Code Object revision`
    )
  }
}

function validateEvidenceManifest(workspace: KnowledgeWorkspace, object: WorkspaceObject): void {
  if (object.type !== 'evidence-manifest') return
  requireObjectRevisionReference(workspace, object.intent, 'intent-record', `manifest ${object.id}`)
  requireUniqueStrings(
    object.items.map((item) => item.id),
    `manifest ${object.id} evidence items`
  )
  const receipt = object.collectionReceipt
  if (receipt) {
    requireUniqueStrings(receipt.grantedScopes, `manifest ${object.id} granted scopes`)
    requireUniqueStrings(
      receipt.providerRuns.map((run) => run.id),
      `manifest ${object.id} provider runs`
    )
    for (const run of receipt.providerRuns) {
      requireUniqueStrings(run.requestedScopes, `provider run ${run.id} requested scopes`)
      requireUniqueStrings(run.grantedScopes, `provider run ${run.id} granted scopes`)
      if (run.capabilities.externalWrites || run.capabilities.sourceWrites) {
        throw new WorkspaceDomainError(
          'validation_failed',
          `evidence provider run ${run.id} cannot declare write capabilities`
        )
      }
    }
  }
  for (const item of object.items) {
    if (item.access === 'redacted' && (item.summary || Object.keys(item.facts).length > 0)) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `redacted evidence ${item.id} cannot include summary or facts`
      )
    }
    if (
      item.providerRunId &&
      (!receipt || !receipt.providerRuns.some((run) => run.id === item.providerRunId))
    ) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `evidence ${item.id} references unavailable provider run ${item.providerRunId}`
      )
    }
    if (item.sourceObject) {
      requireObjectRevisionReference(
        workspace,
        item.sourceObject,
        workspace.objects[item.sourceObject.objectId]?.type ?? 'document-block',
        `evidence ${item.id}`
      )
    }
  }
}

function validateProposalLineage(surface: SurfaceRun): void {
  const hasProposalLineage = Boolean(
    surface.formChoice.proposalDigest ||
    surface.formChoice.proposalId ||
    surface.formChoice.proposalOrigin
  )
  if (
    hasProposalLineage &&
    (!surface.formChoice.proposalDigest?.startsWith('fnv1a-') ||
      !surface.formChoice.proposalId ||
      !['agent', 'human'].includes(surface.formChoice.proposalOrigin ?? ''))
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `surface ${surface.id} must preserve complete experience proposal lineage`
    )
  }
}

function validateCompositionLineage(surface: SurfaceRun): void {
  const composition = surface.formChoice.composition
  if (!composition) return
  if (
    composition.schemaVersion !== 1 ||
    !composition.id ||
    !composition.instanceId ||
    !composition.recipeDigest.startsWith('fnv1a-') ||
    !['primary', 'support'].includes(composition.role) ||
    !Number.isInteger(composition.surfaceCount) ||
    composition.surfaceCount < 1 ||
    composition.surfaceCount > 4 ||
    !Number.isInteger(composition.surfaceIndex) ||
    composition.surfaceIndex < 0 ||
    composition.surfaceIndex >= composition.surfaceCount ||
    (composition.role === 'primary' && composition.surfaceIndex !== 0) ||
    (composition.role === 'support' && composition.surfaceIndex === 0)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `surface ${surface.id} must preserve complete bounded composition lineage`
    )
  }
}

function validateSurfaceRun(workspace: KnowledgeWorkspace, object: WorkspaceObject): void {
  if (object.type !== 'surface-run') return
  validateArtifactReference(object.artifact, `surface ${object.id} artifact`)
  requireObjectRevisionReference(workspace, object.intent, 'intent-record', `surface ${object.id}`)
  const manifest = requireObjectRevisionReference(
    workspace,
    object.evidenceManifest,
    'evidence-manifest',
    `surface ${object.id}`
  )
  if (manifest.type !== 'evidence-manifest') return
  if (!object.rendererId || !object.formChoice.rationale || object.modes.length === 0) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `surface ${object.id} must record its renderer, form rationale, and modes`
    )
  }
  validateProposalLineage(object)
  validateCompositionLineage(object)
  requireUniqueStrings(
    object.modes.map((mode) => mode.id),
    `surface ${object.id} modes`
  )
  for (const mode of object.modes) {
    if (
      mode.rendererViewId !== undefined &&
      !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(mode.rendererViewId)
    ) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `surface ${object.id} mode ${mode.id} rendererViewId must be a bounded renderer target`
      )
    }
  }
  requireUniqueStrings(object.bindings.evidenceItemIds, `surface ${object.id} evidence bindings`)
  requireUniqueStrings(object.bindings.viewIds, `surface ${object.id} view bindings`)
  for (const reference of object.bindings.objectRefs) {
    requireObjectRevisionReference(
      workspace,
      reference,
      workspace.objects[reference.objectId]?.type ?? 'document-block',
      `surface ${object.id} binding`
    )
  }
  requireUniqueStrings(
    object.recommendations.map((recommendation) => recommendation.id),
    `surface ${object.id} recommendations`
  )
  const evidenceIds = new Set(manifest.items.map((item) => item.id))
  for (const recommendation of object.recommendations) {
    requireUniqueStrings(recommendation.evidenceItemIds, `recommendation ${recommendation.id}`)
    if (recommendation.evidenceItemIds.some((id) => !evidenceIds.has(id))) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `recommendation ${recommendation.id} cites evidence outside manifest ${manifest.id}`
      )
    }
  }
  if (
    object.capabilities.externalWrites ||
    object.capabilities.networkAccess ||
    object.capabilities.sourceWrites
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `interactive surface ${object.id} must remain read-only`
    )
  }
}

function validateDecisionReceipt(workspace: KnowledgeWorkspace, object: WorkspaceObject): void {
  if (object.type !== 'decision-receipt') return
  validateArtifactReference(object.artifact, `receipt ${object.id} artifact`)
  requireObjectRevisionReference(workspace, object.intent, 'intent-record', `receipt ${object.id}`)
  requireObjectRevisionReference(
    workspace,
    object.evidenceManifest,
    'evidence-manifest',
    `receipt ${object.id}`
  )
  const surface = requireObjectRevisionReference(
    workspace,
    object.surfaceRun,
    'surface-run',
    `receipt ${object.id}`
  )
  if (surface.type !== 'surface-run' || surface.status !== 'decided') {
    throw new WorkspaceDomainError(
      'validation_failed',
      `receipt ${object.id} requires a decided surface run`
    )
  }
  if (
    surface.artifact.artifactId !== object.artifact.artifactId ||
    surface.artifact.boardId !== object.artifact.boardId ||
    surface.artifact.boardRevision !== object.artifact.boardRevision ||
    surface.artifact.boardSchemaVersion !== object.artifact.boardSchemaVersion ||
    surface.artifact.kind !== object.artifact.kind ||
    surface.artifact.sourceHash !== object.artifact.sourceHash
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `receipt ${object.id} artifact must match its surface run`
    )
  }
  const recommendationIds = new Set(surface.recommendations.map((item) => item.id))
  requireUniqueStrings(object.outcome.finalOrder, `receipt ${object.id} final order`)
  if (object.outcome.finalOrder.some((id) => !recommendationIds.has(id))) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `receipt ${object.id} references an unknown recommendation`
    )
  }
  if (
    object.outcome.finalOrder.length !== recommendationIds.size ||
    JSON.stringify(object.corrections) !== JSON.stringify(surface.interactions)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `receipt ${object.id} must preserve the exact final surface order and corrections`
    )
  }
  const outcomeIds = [
    ...object.outcome.selectedRecommendationIds,
    ...object.outcome.rejectedRecommendationIds
  ]
  requireUniqueStrings(outcomeIds, `receipt ${object.id} selected and rejected recommendations`)
  if (
    outcomeIds.length !== recommendationIds.size ||
    outcomeIds.some((id) => !recommendationIds.has(id))
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `receipt ${object.id} outcome must classify every final recommendation exactly once`
    )
  }
}

function learningReceiptSurface(workspace: KnowledgeWorkspace, object: WorkspaceObject) {
  if (object.type !== 'learning-receipt') return null
  const intent = requireObjectRevisionReference(
    workspace,
    object.intent,
    'intent-record',
    `learning receipt ${object.id}`
  )
  const evidence = requireObjectRevisionReference(
    workspace,
    object.evidenceManifest,
    'evidence-manifest',
    `learning receipt ${object.id}`
  )
  const surface = requireObjectRevisionReference(
    workspace,
    object.surfaceRun,
    'surface-run',
    `learning receipt ${object.id}`
  )
  if (
    intent.type !== 'intent-record' ||
    evidence.type !== 'evidence-manifest' ||
    surface.type !== 'surface-run'
  ) {
    return null
  }
  return surface
}

function validateLearningDecision(
  workspace: KnowledgeWorkspace,
  object: Extract<WorkspaceObject, { type: 'learning-receipt' }>
): Extract<WorkspaceObject, { type: 'decision-receipt' }> | undefined {
  if (!object.decisionReceipt) return undefined
  const decision = requireObjectRevisionReference(
    workspace,
    object.decisionReceipt,
    'decision-receipt',
    `learning receipt ${object.id}`
  )
  if (
    decision.type !== 'decision-receipt' ||
    decision.surfaceRun.objectId !== object.surfaceRun.objectId ||
    decision.surfaceRun.revision !== object.surfaceRun.revision
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} decision must match its exact surface run`
    )
  }
  return decision
}

function validateLearningQualitativeFeedback(
  object: Extract<WorkspaceObject, { type: 'learning-receipt' }>
): void {
  const feedback = object.qualitativeFeedback
  if (!feedback) return
  const lists = [feedback.strengths, feedback.frictions, feedback.suggestedChanges]
  if (
    typeof feedback.summary !== 'string' ||
    !feedback.summary.trim() ||
    feedback.summary.length > 2_000 ||
    lists.some(
      (values) =>
        !Array.isArray(values) ||
        values.length > 20 ||
        values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 500)
    )
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} qualitative feedback is invalid`
    )
  }
  requireUniqueStrings(feedback.strengths, `learning receipt ${object.id} strengths`)
  requireUniqueStrings(feedback.frictions, `learning receipt ${object.id} frictions`)
  requireUniqueStrings(feedback.suggestedChanges, `learning receipt ${object.id} suggested changes`)
}

function validateLearningComparisonBaseline(
  object: Extract<WorkspaceObject, { type: 'learning-receipt' }>,
  surface: SurfaceRun
): void {
  const baseline = object.comparisonBaseline
  if (
    baseline &&
    (!baseline.contentHash.startsWith('fnv1a-') ||
      baseline.intent.objectId !== surface.intent.objectId ||
      baseline.intent.revision !== surface.intent.revision ||
      baseline.evidenceManifest.objectId !== surface.evidenceManifest.objectId ||
      baseline.evidenceManifest.revision !== surface.evidenceManifest.revision ||
      !baseline.reviewedAt ||
      baseline.reviewedAt > object.recordedAt)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} has an invalid comparison baseline`
    )
  }
}

function validateLearningCompositionEvaluations(
  workspace: KnowledgeWorkspace,
  object: Extract<WorkspaceObject, { type: 'learning-receipt' }>,
  surface: SurfaceRun
): void {
  const evaluations = object.compositionEvaluations
  if (!evaluations) return
  const relationIds = evaluations.map((evaluation) => evaluation.relation.relationId)
  requireUniqueStrings(relationIds, `learning receipt ${object.id} composition relations`)
  for (const evaluation of evaluations) {
    const relation = Object.values(workspace.relations).find(
      (candidate) => candidate.id === evaluation.relation.relationId
    )
    const primary = requireObjectRevisionReference(
      workspace,
      evaluation.primarySurface,
      'surface-run',
      `learning receipt ${object.id} composition primary`
    )
    const companion = requireObjectRevisionReference(
      workspace,
      evaluation.companionSurface,
      'surface-run',
      `learning receipt ${object.id} composition companion`
    )
    const sharedLineage =
      primary.type === 'surface-run' &&
      companion.type === 'surface-run' &&
      primary.intent.objectId === companion.intent.objectId &&
      primary.intent.revision === companion.intent.revision &&
      primary.evidenceManifest.objectId === companion.evidenceManifest.objectId &&
      primary.evidenceManifest.revision === companion.evidenceManifest.revision
    if (!relation) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `learning receipt ${object.id} references a missing companion relation`
      )
    }
    if (
      relation.lifecycle !== 'active' ||
      relation.relationType !== 'companion-view-of' ||
      relation.revision !== evaluation.relation.revision ||
      relation.sourceId !== evaluation.companionSurface.objectId ||
      relation.targetId !== evaluation.primarySurface.objectId ||
      (surface.id !== evaluation.primarySurface.objectId &&
        surface.id !== evaluation.companionSurface.objectId) ||
      !sharedLineage ||
      !['helped', 'duplicated', 'distracted'].includes(evaluation.outcome) ||
      !evaluation.reviewedAt ||
      evaluation.reviewedAt > object.recordedAt
    ) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `learning receipt ${object.id} has an invalid companion composition evaluation`
      )
    }
  }
}

function validateLearningReceipt(workspace: KnowledgeWorkspace, object: WorkspaceObject): void {
  if (object.type !== 'learning-receipt') return
  validateLearningAttestation({
    attestation: object.attestation,
    executionKind: object.executionKind,
    receiptId: object.id,
    recordedAt: object.recordedAt,
    recordedBy: object.recordedBy
  })
  const surface = learningReceiptSurface(workspace, object)
  if (!surface) return
  validateLearningComparisonBaseline(object, surface)
  validateLearningCompositionEvaluations(workspace, object, surface)
  if (
    surface.intent.objectId !== object.intent.objectId ||
    surface.intent.revision !== object.intent.revision ||
    surface.evidenceManifest.objectId !== object.evidenceManifest.objectId ||
    surface.evidenceManifest.revision !== object.evidenceManifest.revision ||
    surface.rendererId !== object.rendererId
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} must preserve its surface lineage and renderer`
    )
  }
  if (!Number.isInteger(object.repairCount) || object.repairCount < 0) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} repair count must be a non-negative integer`
    )
  }
  if (!object.runId || !object.recordedAt || !object.recordedBy || !object.occurredAt) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} requires run and recording identity`
    )
  }
  const decision = validateLearningDecision(workspace, object)
  const requiresDecidedOutcome =
    object.durableOutcome || (object.executionKind === 'human' && object.outcome === 'passed')
  if (requiresDecidedOutcome && (!decision || surface.status !== 'decided')) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${object.id} requires an exact decided surface and decision receipt`
    )
  }
  validateLearningQualitativeFeedback(object)
}

function validateObjectEntry(
  workspace: KnowledgeWorkspace,
  id: string,
  object: WorkspaceObject
): void {
  if (id !== object.id || !OBJECT_TYPES.has(object.type)) {
    throw new WorkspaceDomainError('validation_failed', `invalid workspace object entry ${id}`)
  }
  if (
    object.workspaceId !== workspace.id ||
    object.documentId !== workspace.documentId ||
    object.pageId !== workspace.pageId
  ) {
    throw new WorkspaceDomainError('scope_conflict', `object ${id} has mismatched workspace scope`)
  }
  if (object.type === 'collection-record' || object.type === 'saved-view') {
    requireObjectReference(workspace, object.collectionId, object.type)
    if (workspace.objects[object.collectionId].type !== 'collection') {
      throw new WorkspaceDomainError(
        'validation_failed',
        `${object.type} ${id} references a non-collection object`
      )
    }
  }
  if (object.type === 'graph-edge') {
    requireObjectReference(workspace, object.sourceId, `graph edge ${id}`)
    requireObjectReference(workspace, object.targetId, `graph edge ${id}`)
  }
  validateEvidenceManifest(workspace, object)
  validateSurfaceRun(workspace, object)
  validateDecisionReceipt(workspace, object)
  validateLearningReceipt(workspace, object)
  validateActionLifecycleObject(workspace, object)
}

function validateRelationEntry(
  workspace: KnowledgeWorkspace,
  id: string,
  relation: WorkspaceRelation
): void {
  if (id !== relation.id || relation.workspaceId !== workspace.id) {
    throw new WorkspaceDomainError('scope_conflict', `relation ${id} has mismatched scope`)
  }
  requireObjectReference(workspace, relation.sourceId, `relation ${id}`)
  requireObjectReference(workspace, relation.targetId, `relation ${id}`)
}

function validateViewEntry(workspace: KnowledgeWorkspace, id: string, view: WorkspaceView): void {
  if (id !== view.id || view.workspaceId !== workspace.id) {
    throw new WorkspaceDomainError('scope_conflict', `view ${id} has mismatched scope`)
  }
}

function validateWorkspaceHeader(workspace: KnowledgeWorkspace): void {
  if (!workspace.id || !workspace.documentId || !workspace.pageId) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'workspace id, documentId, and pageId are required'
    )
  }
  if (!Number.isInteger(workspace.revision) || workspace.revision < 0) {
    throw new WorkspaceDomainError('validation_failed', 'workspace revision must be non-negative')
  }
}

export function validateKnowledgeWorkspace(workspace: KnowledgeWorkspace): void {
  validateWorkspaceHeader(workspace)
  for (const [id, object] of Object.entries(workspace.objects)) {
    validateObjectEntry(workspace, id, object)
  }
  for (const [id, relation] of Object.entries(workspace.relations)) {
    validateRelationEntry(workspace, id, relation)
  }
  for (const [id, view] of Object.entries(workspace.views)) {
    validateViewEntry(workspace, id, view)
  }
  assertNoInlineData(workspace)
}

export function serializeWorkspace(workspace: KnowledgeWorkspace): string {
  validateKnowledgeWorkspace(workspace)
  return JSON.stringify(workspace)
}

/**
 * Copy JSON-backed workspace data without retaining Vue proxy wrappers.
 *
 * Workspace records use the same JSON boundary for persistence, so this is
 * safer than structuredClone when a component receives reactive workspace
 * arrays or objects.
 */
export function cloneWorkspaceData<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function deserializeWorkspace(serialized: string): KnowledgeWorkspace {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new WorkspaceDomainError('validation_failed', 'workspace payload is not valid JSON')
  }
  if (!isRecord(parsed)) {
    throw new WorkspaceDomainError('validation_failed', 'workspace payload must be an object')
  }
  requireString(parsed, 'id')
  requireString(parsed, 'documentId')
  requireString(parsed, 'pageId')
  const supportedSchemaVersions = new Set([
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    WORKSPACE_SCHEMA_VERSION
  ])
  if (!supportedSchemaVersions.has(parsed.schemaVersion as number)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `unsupported workspace schema version ${String(parsed.schemaVersion)}`
    )
  }
  if (!isRecord(parsed.objects) || !isRecord(parsed.relations) || !isRecord(parsed.views)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'workspace objects, relations, and views must be records'
    )
  }
  const migrated = migrateWorkspacePayload(parsed)
  const workspace = migrated as KnowledgeWorkspace
  validateKnowledgeWorkspace(workspace)
  return workspace
}
