import {
  dogfoodRunFromLearningReceipt,
  evaluateComposedExperienceFieldGate,
} from '@/app/proving-gates'
import {
  WorkspaceDomainError,
  type KnowledgeWorkspace,
  type LearningCompositionEvaluation,
  type LearningReceipt,
  type SurfaceRun,
  type WorkspaceObject,
  type WorkspaceObjectRevisionRef,
} from '@/app/workspace'
import type { ResolvedLearningComposition } from './types'

function sameReference(
  left: WorkspaceObjectRevisionRef,
  right: WorkspaceObjectRevisionRef
): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function surfaceById(
  workspace: KnowledgeWorkspace,
  surfaceRunId: string
): SurfaceRun {
  const surface = workspace.objects[surfaceRunId] as WorkspaceObject | undefined
  if (surface?.type !== 'surface-run') {
    throw new WorkspaceDomainError('not_found', `surface run ${surfaceRunId}`)
  }
  return surface
}

function exactSurfaceRef(surface: SurfaceRun): WorkspaceObjectRevisionRef {
  return { objectId: surface.id, revision: surface.revision }
}

export function resolveLearningComposition(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun
): ResolvedLearningComposition[] {
  return Object.values(workspace.relations)
    .filter(
      (relation) =>
        relation.lifecycle === 'active' &&
        relation.relationType === 'companion-view-of' &&
        (relation.sourceId === surface.id || relation.targetId === surface.id)
    )
    .map((relation) => {
      const primary = surfaceById(workspace, relation.targetId)
      const companion = surfaceById(workspace, relation.sourceId)
      if (
        !sameReference(primary.intent, companion.intent) ||
        !sameReference(primary.evidenceManifest, companion.evidenceManifest)
      ) {
        throw new WorkspaceDomainError(
          'reconstruction_conflict',
          `companion relation ${relation.id} does not preserve shared intent and evidence lineage`
        )
      }
      return {
        companion,
        companionRef: exactSurfaceRef(companion),
        primary,
        primaryRef: exactSurfaceRef(primary),
        relation,
      }
    })
    .sort((left, right) => left.relation.id.localeCompare(right.relation.id))
}

export function compositionFieldGateFor(workspace: KnowledgeWorkspace) {
  const runs = Object.values(workspace.objects)
    .filter(
      (object): object is LearningReceipt => object.type === 'learning-receipt'
    )
    .map(dogfoodRunFromLearningReceipt)
  return evaluateComposedExperienceFieldGate(runs)
}

export function verifiedCompositionFieldGateFor(
  workspace: KnowledgeWorkspace,
  verifiedReceiptIds: ReadonlySet<string>
) {
  const runs = Object.values(workspace.objects)
    .filter(
      (object): object is LearningReceipt =>
        object.type === 'learning-receipt' && object.lifecycle === 'active'
    )
    .map((receipt) => ({
      ...dogfoodRunFromLearningReceipt(receipt),
      attestationVerified: verifiedReceiptIds.has(receipt.id),
      familyAttestationVerified: Boolean(
        verifiedReceiptIds.has(receipt.id) &&
        receipt.attestation.proof?.claim.version === 2
      ),
    }))
  return evaluateComposedExperienceFieldGate(runs)
}

function sameCompositionEvaluation(
  resolved: ResolvedLearningComposition,
  evaluation: LearningCompositionEvaluation
): boolean {
  return (
    sameReference(resolved.primaryRef, evaluation.primarySurface) &&
    sameReference(resolved.companionRef, evaluation.companionSurface) &&
    resolved.relation.id === evaluation.relation.relationId &&
    resolved.relation.revision === evaluation.relation.revision
  )
}

export function requireExactCompositionEvaluations(
  composition: ResolvedLearningComposition[],
  evaluations: LearningCompositionEvaluation[] | undefined,
  recordedAt: string
): void {
  const provided = evaluations ?? []
  if (
    provided.length !== composition.length ||
    composition.some(
      (resolved) =>
        !provided.some((evaluation) =>
          sameCompositionEvaluation(resolved, evaluation)
        )
    ) ||
    provided.some(
      (evaluation) =>
        !evaluation.reviewedAt ||
        evaluation.reviewedAt > recordedAt ||
        !['helped', 'duplicated', 'distracted'].includes(evaluation.outcome)
    )
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'composition evaluation must cover the exact current companion surfaces and relation revisions'
    )
  }
}
