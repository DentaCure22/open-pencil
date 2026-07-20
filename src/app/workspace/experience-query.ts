import type { WorkspaceObject } from './types'

export type ExperienceObject = Extract<
  WorkspaceObject,
  {
    type:
      | 'decision-receipt'
      | 'evidence-manifest'
      | 'intent-record'
      | 'learning-receipt'
      | 'surface-run'
  }
>

export function isExperienceObject(object: WorkspaceObject): object is ExperienceObject {
  return (
    object.type === 'intent-record' ||
    object.type === 'evidence-manifest' ||
    object.type === 'surface-run' ||
    object.type === 'decision-receipt' ||
    object.type === 'learning-receipt'
  )
}

export function experienceTitle(object: ExperienceObject): string {
  if (object.type === 'intent-record') return object.statement.slice(0, 120) || 'Intent'
  if (object.type === 'evidence-manifest') {
    return `Evidence snapshot · ${object.items.length} items`
  }
  if (object.type === 'surface-run') return object.name
  if (object.type === 'learning-receipt') return `Learning · ${object.outcome}`
  return `Decision · ${object.outcome.status}`
}

export function experienceSearchableText(object: ExperienceObject): string {
  const common = [object.id, object.type, object.tags.join(' ')]
  if (object.type === 'intent-record') {
    return [...common, object.statement, object.desiredOutcome, ...object.constraints].join(' ')
  }
  if (object.type === 'evidence-manifest') {
    return [
      ...common,
      object.status,
      ...object.items.flatMap((item) => [
        item.id,
        item.title,
        item.summary,
        item.sourceRef,
        item.truthScope,
        item.freshness
      ])
    ].join(' ')
  }
  if (object.type === 'surface-run') {
    return [
      ...common,
      object.name,
      object.status,
      object.form.rationale,
      ...object.recommendations.flatMap((item) => [
        item.title,
        item.rationale,
        item.tradeoff,
        item.uncertainty,
        item.status
      ])
    ].join(' ')
  }
  if (object.type === 'learning-receipt') {
    return [
      ...common,
      object.runId,
      object.formId,
      object.rendererId,
      object.executionKind,
      object.attestation.kind,
      object.attestation.attestedBy,
      object.attestation.authorityRef ?? '',
      object.attestation.sessionId ?? '',
      object.outcome,
      object.formDisposition,
      object.comparisonOutcome,
      object.comparisonBaseline?.kind ?? '',
      object.comparisonBaseline?.contentHash ?? '',
      ...(object.compositionEvaluations ?? []).flatMap((evaluation) => [
        evaluation.outcome,
        evaluation.primarySurface.objectId,
        evaluation.companionSurface.objectId,
        evaluation.relation.relationId
      ]),
      object.recordedBy,
      object.modelId ?? ''
    ].join(' ')
  }
  return [
    ...common,
    object.outcome.status,
    object.outcome.note ?? '',
    ...object.outcome.finalOrder
  ].join(' ')
}

export function experienceStatuses(object: ExperienceObject): string[] {
  if (object.type === 'evidence-manifest') return [object.status]
  if (object.type === 'surface-run') return [object.status]
  if (object.type === 'decision-receipt') return [object.outcome.status]
  if (object.type === 'learning-receipt') {
    return [object.outcome, object.formDisposition, object.attestation.kind]
  }
  return []
}

export function experienceSourceTargets(object: ExperienceObject): string[] {
  if (object.type === 'evidence-manifest') {
    return object.items.map((item) => item.sourceRef)
  }
  if (object.type === 'surface-run' || object.type === 'decision-receipt') {
    return [object.artifact.artifactId, object.artifact.boardId]
  }
  if (object.type === 'learning-receipt') {
    return [object.surfaceRun.objectId, object.decisionReceipt?.objectId ?? '']
  }
  return []
}
