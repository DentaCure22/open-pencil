import type { WorkspaceObject } from './types'

export type ActionLifecycleObject = Extract<
  WorkspaceObject,
  {
    type:
      | 'action-execution-receipt'
      | 'action-proposal'
      | 'action-rollback-receipt'
      | 'action-verification-receipt'
  }
>

export function isActionLifecycleObject(object: WorkspaceObject): object is ActionLifecycleObject {
  return (
    object.type === 'action-proposal' ||
    object.type === 'action-execution-receipt' ||
    object.type === 'action-verification-receipt' ||
    object.type === 'action-rollback-receipt'
  )
}

export function actionLifecycleTitle(object: ActionLifecycleObject): string {
  if (object.type === 'action-proposal') return object.name
  if (object.type === 'action-execution-receipt') return `Execution · ${object.status}`
  if (object.type === 'action-rollback-receipt') return `Rollback · ${object.status}`
  return `Verification · ${object.outcome}`
}

export function actionLifecycleSearchableText(object: ActionLifecycleObject): string {
  const common = [object.id, object.type, object.tags.join(' ')]
  if (object.type === 'action-proposal') {
    return [
      ...common,
      object.name,
      object.status,
      object.authorization.status,
      ...object.requestedCapabilities.requiredScopes,
      ...object.steps.flatMap((step) => [
        step.description,
        step.operation,
        step.target.kind,
        step.target.label,
        step.target.ref,
        step.target.connectorId ?? ''
      ])
    ].join(' ')
  }
  if (object.type === 'action-execution-receipt') {
    return [
      ...common,
      object.status,
      object.executorId,
      ...object.results.flatMap((result) => [
        result.stepId,
        result.targetRef,
        result.status,
        result.error ?? ''
      ])
    ].join(' ')
  }
  if (object.type === 'action-rollback-receipt') {
    return [
      ...common,
      object.status,
      object.rolledBackBy,
      object.reason,
      ...object.authorization.grantedScopes,
      ...object.results.flatMap((result) => [
        result.stepId,
        result.targetRef,
        result.status,
        result.error ?? ''
      ])
    ].join(' ')
  }
  return [
    ...common,
    object.outcome,
    object.verifiedBy,
    ...object.checks.flatMap((check) => [
      check.kind,
      check.targetRef,
      check.evidenceRef,
      check.resultDigest
    ])
  ].join(' ')
}

export function actionLifecycleStatuses(object: ActionLifecycleObject): string[] {
  if (object.type === 'action-proposal') return [object.status, object.authorization.status]
  if (object.type === 'action-execution-receipt') return [object.status]
  if (object.type === 'action-rollback-receipt') return [object.status]
  return [object.outcome]
}

export function actionLifecycleSourceTargets(object: ActionLifecycleObject): string[] {
  if (object.type === 'action-proposal') return object.steps.map((step) => step.target.ref)
  if (object.type === 'action-execution-receipt') {
    return object.results.map((result) => result.targetRef)
  }
  if (object.type === 'action-rollback-receipt') {
    return object.results.map((result) => result.targetRef)
  }
  return object.checks.flatMap((check) => [check.targetRef, check.evidenceRef])
}
