import { WorkspaceDomainError } from './errors'
import type {
  ExperienceFamilyMemberV1,
  LearningAttestation,
  LearningAttestationKind,
  LearningExecutionKind,
  ObservedSessionClaim,
  ObservedSessionTaskInteraction,
} from './types'

const ATTESTATION_KINDS: ReadonlySet<LearningAttestationKind> = new Set([
  'authenticated-session',
  'automated-run',
  'observed-session',
  'self-report',
])

export type LearningAttestationContext = {
  attestation: LearningAttestation
  executionKind: LearningExecutionKind
  receiptId: string
  recordedAt: string
  recordedBy: string
}

function hasVerifiedSessionProof(attestation: LearningAttestation): boolean {
  const interactionCount = attestation.interactionCount ?? 0
  const minimumInteractions = attestation.kind === 'observed-session' ? 1 : 3
  return Boolean(
    attestation.sessionId &&
    attestation.authorityRef &&
    attestation.proofDigest?.startsWith('sha256:') &&
    attestation.sessionStartedAt &&
    Number.isInteger(attestation.interactionCount) &&
    interactionCount >= minimumInteractions &&
    attestation.sessionStartedAt <= attestation.attestedAt
  )
}

function hasCompleteReference(
  reference: { objectId: string; revision: number } | undefined
) {
  return Boolean(
    reference?.objectId &&
    Number.isInteger(reference.revision) &&
    reference.revision > 0
  )
}

function hasCompleteTarget(attestation: LearningAttestation): boolean {
  const target = attestation.proof?.claim.target
  const artifact = target?.artifact
  return Boolean(
    hasCompleteReference(target?.intent) &&
    hasCompleteReference(target?.evidenceManifest) &&
    hasCompleteReference(target?.surfaceRun) &&
    artifact?.artifactId &&
    artifact.boardId &&
    Number.isInteger(artifact.boardRevision) &&
    artifact.boardRevision > 0 &&
    Number.isInteger(artifact.boardSchemaVersion) &&
    artifact.boardSchemaVersion > 0 &&
    artifact.sourceHash
  )
}

function interactionTargetMatches(
  claim: ObservedSessionClaim,
  interaction: ObservedSessionTaskInteraction,
  familyMember?: ExperienceFamilyMemberV1
): boolean {
  if (claim.version === 2) {
    return interaction.frameId === familyMember?.artifact.boardId
  }
  return (
    interaction.frameId === claim.target.artifact.boardId &&
    interaction.surfaceRunId === claim.target.surfaceRun.objectId
  )
}

function interactionEnvelopeMatches(
  attestation: LearningAttestation,
  interaction: ObservedSessionTaskInteraction,
  eventIds: ReadonlySet<string>
): boolean {
  return Boolean(
    interaction.eventId &&
    !eventIds.has(interaction.eventId) &&
    ['keydown', 'pointerdown'].includes(interaction.kind) &&
    interaction.occurredAt >= (attestation.sessionStartedAt ?? '') &&
    interaction.occurredAt <= attestation.attestedAt
  )
}

function interactionRevisionMatches(
  interaction: ObservedSessionTaskInteraction,
  expectedBefore: ObservedSessionTaskInteraction['before']
): boolean {
  return (
    interaction.before.artifactRevision === expectedBefore.artifactRevision &&
    interaction.before.surfaceRevision === expectedBefore.surfaceRevision &&
    interaction.after.artifactRevision > interaction.before.artifactRevision &&
    interaction.after.surfaceRevision > interaction.before.surfaceRevision
  )
}

function hasCompleteTaskInteractions(
  attestation: LearningAttestation
): boolean {
  const proof = attestation.proof
  const claim = proof?.claim
  const interactions = proof?.taskInteractions ?? []
  if (
    !claim ||
    interactions.length < 1 ||
    interactions.length !== claim.taskInteractionCount ||
    interactions.length !== attestation.interactionCount
  ) {
    return false
  }
  const eventIds = new Set<string>()
  const familyMembers = new Map(
    (claim.version === 2 ? claim.scope.family.members : []).map((member) => [
      member.surfaceRun.objectId,
      member,
    ])
  )
  const previousBySurface = new Map<string, (typeof interactions)[number]>()
  const valid = interactions.every((interaction) => {
    const member = familyMembers.get(interaction.surfaceRunId)
    const previousForSurface = previousBySurface.get(interaction.surfaceRunId)
    const expectedBefore = previousForSurface?.after ?? {
      artifactRevision:
        member?.artifact.boardRevision ?? claim.target.artifact.boardRevision,
      surfaceRevision:
        member?.surfaceRun.revision ?? claim.target.surfaceRun.revision,
    }
    const interactionValid = Boolean(
      interactionEnvelopeMatches(attestation, interaction, eventIds) &&
      interactionTargetMatches(claim, interaction, member) &&
      interactionRevisionMatches(interaction, expectedBefore)
    )
    eventIds.add(interaction.eventId)
    previousBySurface.set(interaction.surfaceRunId, interaction)
    return interactionValid
  })
  if (!valid || claim.version !== 2) return valid
  return claim.scope.family.members.every((member) => {
    const memberInteractions = interactions.filter(
      (interaction) => interaction.surfaceRunId === member.surfaceRun.objectId
    )
    const last = memberInteractions.at(-1)
    const final = claim.finalFamily.members.find(
      (candidate) => candidate.surfaceRunId === member.surfaceRun.objectId
    )
    return Boolean(
      last &&
      final &&
      final.taskInteractionCount === memberInteractions.length &&
      final.finalArtifactRevision === last.after.artifactRevision &&
      final.finalSurfaceRevision === last.after.surfaceRevision
    )
  })
}

function hasCompleteFamilyClaim(attestation: LearningAttestation): boolean {
  const claim = attestation.proof?.claim
  if (claim?.version !== 2) return true
  const family = claim.scope.family
  return Boolean(
    family.compositionId &&
    family.recipeDigest.startsWith('fnv1a-') &&
    family.familyDigest.startsWith('fnv1a-') &&
    family.surfaceCount === family.members.length &&
    family.supports.length === family.surfaceCount - 1 &&
    family.relations.length === family.supports.length &&
    family.primary.surfaceIndex === 0 &&
    claim.target.surfaceRun.objectId === family.primary.surfaceRun.objectId &&
    claim.target.surfaceRun.revision === family.primary.surfaceRun.revision &&
    claim.target.artifact.boardId === family.primary.artifact.boardId &&
    claim.finalFamily.familyDigest.startsWith('fnv1a-') &&
    claim.finalFamily.members.length === family.surfaceCount
  )
}

function hasCompleteObservedClaim(
  attestation: LearningAttestation,
  claim: ObservedSessionClaim | undefined
): boolean {
  if (!claim) return false
  const identifiersComplete = [
    claim.actorId,
    claim.fieldSessionId,
    claim.decisionReceiptId,
    claim.occurredAt,
    claim.recordedAt,
    claim.runId,
    claim.surfaceRunId,
    claim.taskInteractionDigest,
  ].every(Boolean)
  const revisionsComplete =
    Number.isInteger(claim.finalSurfaceRevision) &&
    claim.finalSurfaceRevision > 0 &&
    Number.isInteger(claim.taskInteractionCount)
  const digestsComplete =
    claim.reviewDigest.startsWith('sha256:') &&
    claim.taskInteractionDigest.startsWith('sha256:')
  return Boolean(
    identifiersComplete &&
    revisionsComplete &&
    digestsComplete &&
    claim.surfaceRunId === claim.target.surfaceRun.objectId &&
    claim.actorId === attestation.attestedBy &&
    hasCompleteTarget(attestation) &&
    hasCompleteFamilyClaim(attestation) &&
    hasCompleteTaskInteractions(attestation)
  )
}

function hasCompleteObservedPublicKey(
  attestation: LearningAttestation
): boolean {
  const proof = attestation.proof
  const publicKey = proof?.publicKey
  return Boolean(
    proof?.algorithm === 'ECDSA-P256-SHA256' &&
    proof.claimDigest.startsWith('sha256:') &&
    proof.signature &&
    publicKey?.kty === 'EC' &&
    publicKey.crv === 'P-256' &&
    publicKey.x &&
    publicKey.y
  )
}

function hasCompleteObservedProof(attestation: LearningAttestation): boolean {
  return (
    hasCompleteObservedPublicKey(attestation) &&
    hasCompleteObservedClaim(attestation, attestation.proof?.claim)
  )
}

export function validateLearningAttestation(
  context: LearningAttestationContext
): void {
  const { attestation, executionKind, receiptId, recordedAt, recordedBy } =
    context
  if (!ATTESTATION_KINDS.has(attestation.kind)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${receiptId} has an unknown attestation kind`
    )
  }
  if (!attestation.attestedAt || !attestation.attestedBy) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${receiptId} requires attestation identity and time`
    )
  }
  if (
    (executionKind === 'automated' && attestation.kind !== 'automated-run') ||
    (executionKind === 'human' && attestation.kind === 'automated-run')
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${receiptId} execution and attestation conflict`
    )
  }
  const independentlyAttested =
    attestation.kind === 'authenticated-session' ||
    attestation.kind === 'observed-session'
  if (independentlyAttested && !hasVerifiedSessionProof(attestation)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${attestation.kind} attestation requires a verified session proof and observed interaction evidence`
    )
  }
  if (
    attestation.kind === 'observed-session' &&
    !hasCompleteObservedProof(attestation)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'observed-session attestation requires complete durable signed proof material'
    )
  }
  const locallyAttested =
    attestation.kind === 'self-report' || attestation.kind === 'automated-run'
  if (
    locallyAttested &&
    (attestation.attestedBy !== recordedBy ||
      attestation.attestedAt !== recordedAt)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${attestation.kind} attestation must match the recording identity and time`
    )
  }
}
