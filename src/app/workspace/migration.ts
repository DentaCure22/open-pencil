import { WorkspaceDomainError } from './errors'
import { WORKSPACE_SCHEMA_VERSION } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasSessionProof(attestation: Record<string, unknown> | null): boolean {
  if (!attestation) return false
  return (
    typeof attestation.proofDigest === 'string' &&
    typeof attestation.sessionStartedAt === 'string' &&
    Number.isInteger(attestation.interactionCount) &&
    Number(attestation.interactionCount) >= 1
  )
}

function hasStringFields(
  record: Record<string, unknown> | null,
  fields: string[]
): boolean {
  return Boolean(
    record && fields.every((field) => typeof record[field] === 'string')
  )
}

function completeReference(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    hasStringFields(value, ['objectId']) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) > 0
  )
}

function completeArtifact(value: unknown): boolean {
  return Boolean(
    isRecord(value) &&
    hasStringFields(value, ['artifactId', 'boardId', 'kind', 'sourceHash']) &&
    Number.isInteger(value.boardRevision) &&
    Number(value.boardRevision) > 0 &&
    Number.isInteger(value.boardSchemaVersion) &&
    Number(value.boardSchemaVersion) > 0
  )
}

function completeTaskInteraction(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.before) || !isRecord(value.after))
    return false
  const before = value.before
  const after = value.after
  const revisions = ['artifactRevision', 'surfaceRevision']
  return Boolean(
    hasStringFields(value, [
      'eventId',
      'frameId',
      'kind',
      'occurredAt',
      'surfaceRunId',
    ]) &&
    ['keydown', 'pointerdown'].includes(String(value.kind)) &&
    revisions.every(
      (field) =>
        Number.isInteger(before[field]) &&
        Number(before[field]) > 0 &&
        Number.isInteger(after[field]) &&
        Number(after[field]) > 0
    )
  )
}

function completeFamilyMember(
  value: unknown,
  index: number,
  interactions: unknown[]
): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.surfaceRun) ||
    !isRecord(value.artifact)
  ) {
    return false
  }
  const surfaceRun = value.surfaceRun
  const artifact = value.artifact
  const surfaceRunId = surfaceRun.objectId
  const boardId = artifact.boardId
  return Boolean(
    value.surfaceIndex === index &&
    completeReference(value.surfaceRun) &&
    completeArtifact(value.artifact) &&
    interactions.some(
      (interaction) =>
        isRecord(interaction) &&
        interaction.surfaceRunId === surfaceRunId &&
        interaction.frameId === boardId
    )
  )
}

function completeFamilyHeader(
  scope: Record<string, unknown> | null,
  family: Record<string, unknown> | null,
  members: unknown[]
): boolean {
  if (!scope || !family) return false
  return Boolean(
    scope.kind === 'experience-family' &&
    scope.schemaVersion === 1 &&
    family.complete === true &&
    family.schemaVersion === 1 &&
    hasStringFields(family, [
      'compositionId',
      'recipeDigest',
      'familyDigest',
    ]) &&
    Number(family.surfaceCount) === members.length &&
    members.length > 0
  )
}

function completeFamilyPrimary(
  primary: Record<string, unknown> | null,
  target: Record<string, unknown>
): boolean {
  if (
    !primary ||
    !isRecord(primary.surfaceRun) ||
    !isRecord(primary.artifact) ||
    !isRecord(target.surfaceRun) ||
    !isRecord(target.artifact)
  ) {
    return false
  }
  return (
    primary.surfaceRun.objectId === target.surfaceRun.objectId &&
    primary.artifact.boardId === target.artifact.boardId
  )
}

function completeFinalFamily(
  finalFamily: Record<string, unknown> | null,
  memberCount: number
): boolean {
  if (!finalFamily || !Array.isArray(finalFamily.members)) return false
  return (
    typeof finalFamily.familyDigest === 'string' &&
    finalFamily.members.length === memberCount
  )
}

function completeFamilyClaim(
  claim: Record<string, unknown>,
  target: Record<string, unknown>,
  interactions: unknown[]
): boolean {
  if (claim.version !== 2) return true
  const scope = isRecord(claim.scope) ? claim.scope : null
  const family = isRecord(scope?.family) ? scope.family : null
  const primary = isRecord(family?.primary) ? family.primary : null
  const members = Array.isArray(family?.members) ? family.members : []
  const finalFamily = isRecord(claim.finalFamily) ? claim.finalFamily : null
  return Boolean(
    completeFamilyHeader(scope, family, members) &&
    members.every((member, index) =>
      completeFamilyMember(member, index, interactions)
    ) &&
    completeFamilyPrimary(primary, target) &&
    completeFinalFamily(finalFamily, members.length)
  )
}

function completeObservedEnvelope(
  proof: Record<string, unknown>,
  claim: Record<string, unknown>,
  publicKey: Record<string, unknown> | null,
  interactions: unknown[],
  attestation: Record<string, unknown>
): boolean {
  return Boolean(
    proof.algorithm === 'ECDSA-P256-SHA256' &&
    hasStringFields(proof, ['claimDigest', 'signature']) &&
    publicKey?.kty === 'EC' &&
    publicKey.crv === 'P-256' &&
    hasStringFields(publicKey, ['x', 'y']) &&
    hasStringFields(claim, [
      'actorId',
      'fieldSessionId',
      'decisionReceiptId',
      'occurredAt',
      'recordedAt',
      'reviewDigest',
      'runId',
      'surfaceRunId',
      'taskInteractionDigest',
    ]) &&
    claim.dataPolicy === 'phi-free-declared-v1' &&
    Number.isInteger(claim.finalSurfaceRevision) &&
    Number(claim.finalSurfaceRevision) > 0 &&
    Number(claim.taskInteractionCount) === interactions.length &&
    Number(attestation.interactionCount) === interactions.length
  )
}

function hasCompleteObservedProof(
  attestation: Record<string, unknown>
): boolean {
  if (attestation.kind !== 'observed-session') return true
  const proof = isRecord(attestation.proof) ? attestation.proof : null
  const claim = isRecord(proof?.claim) ? proof.claim : null
  const publicKey = isRecord(proof?.publicKey) ? proof.publicKey : null
  const target = isRecord(claim?.target) ? claim.target : null
  const interactions = Array.isArray(proof?.taskInteractions)
    ? proof.taskInteractions
    : []
  if (!proof || !claim || !target || interactions.length === 0) return false
  return Boolean(
    completeObservedEnvelope(
      proof,
      claim,
      publicKey,
      interactions,
      attestation
    ) &&
    completeObservedTarget(target) &&
    completeObservedInteractions(interactions) &&
    completeFamilyClaim(claim, target, interactions)
  )
}

function completeObservedTarget(target: Record<string, unknown>): boolean {
  return Boolean(
    completeReference(target.intent) &&
    completeReference(target.evidenceManifest) &&
    completeReference(target.surfaceRun) &&
    completeArtifact(target.artifact)
  )
}

function completeObservedInteractions(interactions: unknown[]): boolean {
  return interactions.every(completeTaskInteraction)
}

function migrateLearningReceipt(value: Record<string, unknown>): void {
  if (value.type !== 'learning-receipt') return
  const attestation = isRecord(value.attestation) ? value.attestation : null
  const independentlyAttested =
    attestation?.kind === 'authenticated-session' ||
    attestation?.kind === 'observed-session'
  if (
    attestation &&
    (!independentlyAttested ||
      (hasSessionProof(attestation) && hasCompleteObservedProof(attestation)))
  ) {
    return
  }
  value.attestation = {
    attestedAt: typeof value.recordedAt === 'string' ? value.recordedAt : '',
    attestedBy: typeof value.recordedBy === 'string' ? value.recordedBy : '',
    kind: value.executionKind === 'human' ? 'self-report' : 'automated-run',
  }
}

function migrateSurfaceRun(value: Record<string, unknown>): void {
  if (value.type !== 'surface-run') return
  const intent = isRecord(value.intent) ? value.intent : null
  const evidenceManifest = isRecord(value.evidenceManifest)
    ? value.evidenceManifest
    : null
  if (!isRecord(value.bindings)) {
    value.bindings = {
      evidenceItemIds: [],
      objectRefs: [intent, evidenceManifest].filter(Boolean),
      viewIds: [],
    }
  }
  if (!isRecord(value.formChoice)) {
    const form = isRecord(value.form) ? value.form : {}
    value.formChoice = {
      consideredRendererIds: ['weekly-decision-v1', 'plain-prose'],
      rationale:
        typeof form.rationale === 'string'
          ? form.rationale
          : 'Migrated from the original weekly decision renderer.',
    }
  }
  if (typeof value.jobKind !== 'string') value.jobKind = 'decide'
  if (!Array.isArray(value.modes)) {
    value.modes = [
      { id: 'mode-focus', kind: 'focus', label: 'Focus' },
      { id: 'mode-review', kind: 'review', label: 'Review' },
    ]
  }
  if (typeof value.rendererId !== 'string')
    value.rendererId = 'weekly-decision-v1'
}

export function migrateWorkspacePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const migrated = structuredClone(payload)
  if (!isRecord(migrated.objects)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'workspace objects must remain a record during migration'
    )
  }
  migrated.schemaVersion = WORKSPACE_SCHEMA_VERSION
  for (const value of Object.values(migrated.objects)) {
    if (!isRecord(value)) continue
    migrateLearningReceipt(value)
    migrateSurfaceRun(value)
  }
  return migrated
}
