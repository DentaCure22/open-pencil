import {
  WorkspaceDomainError,
  type ExperienceProjectionPurpose,
  type KnowledgeWorkspace,
  type SurfaceRun,
  type WorkspaceObject,
  type WorkspaceObjectRevisionRef
} from '@/app/workspace'

export type ExperienceProjectionRole =
  | 'root-surface'
  | 'companion-surface'
  | 'intent'
  | 'evidence-manifest'
  | 'surface-binding'
  | 'decision-receipt'
  | 'learning-receipt'
  | 'action'
  | 'review-object'

export type ExperienceProjectionMember = WorkspaceObjectRevisionRef & {
  role: ExperienceProjectionRole
}

export type ExperienceComparisonResolution =
  | {
      basis: 'companion-surfaces' | 'renderer-mode'
      companionSurfaces: WorkspaceObjectRevisionRef[]
      modeId?: string
      status: 'available'
    }
  | {
      basis: 'none'
      companionSurfaces: []
      reason: 'no-companion-or-renderer-compare-mode'
      status: 'unavailable'
    }

export type ResolvedExperienceProjections = {
  availablePurposes: ExperienceProjectionPurpose[]
  comparison: ExperienceComparisonResolution
  members: Record<ExperienceProjectionPurpose, ExperienceProjectionMember[]>
  rootSurface: WorkspaceObjectRevisionRef
}

const PURPOSE_ORDER: ExperienceProjectionPurpose[] = ['focus', 'compare', 'knowledge', 'review']

export const EXPERIENCE_PROJECTION_DENSITY = {
  compare: { companions: 1, supports: 4, total: 8 },
  focus: { total: 3 },
  knowledge: { companions: 2, supports: 3, total: 8 },
  review: { companions: 1, receiptsOrActions: 1, reviews: 1, total: 6 }
} as const

function sameRef(left: WorkspaceObjectRevisionRef, right: WorkspaceObjectRevisionRef): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function exactObject(
  workspace: KnowledgeWorkspace,
  reference: WorkspaceObjectRevisionRef,
  expectedType?: WorkspaceObject['type']
): WorkspaceObject {
  if (!Object.hasOwn(workspace.objects, reference.objectId)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `experience projection references missing object ${reference.objectId}`
    )
  }
  const object = workspace.objects[reference.objectId]
  if (
    object.workspaceId !== workspace.id ||
    object.revision !== reference.revision ||
    (expectedType !== undefined && object.type !== expectedType)
  ) {
    const expectation = expectedType ? ` ${expectedType}` : ''
    throw new WorkspaceDomainError(
      'validation_failed',
      `experience projection requires exact${expectation} revision ${reference.objectId}@${reference.revision}`
    )
  }
  return object
}

function member(
  reference: WorkspaceObjectRevisionRef,
  role: ExperienceProjectionRole
): ExperienceProjectionMember {
  return { ...reference, role }
}

function currentRef(object: WorkspaceObject): WorkspaceObjectRevisionRef {
  return { objectId: object.id, revision: object.revision }
}

function uniqueMembers(entries: ExperienceProjectionMember[]): ExperienceProjectionMember[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.objectId)) return false
    seen.add(entry.objectId)
    return true
  })
}

function orderedObjects<T extends WorkspaceObject>(objects: T[]): T[] {
  return objects.toSorted((left, right) => {
    const time = left.createdAt.localeCompare(right.createdAt)
    return time === 0 ? left.id.localeCompare(right.id) : time
  })
}

function latestObjects<T extends WorkspaceObject>(objects: T[]): T[] {
  return objects.toSorted((left, right) => {
    const time = right.createdAt.localeCompare(left.createdAt)
    return time === 0 ? left.id.localeCompare(right.id) : time
  })
}

function sharedLineage(candidate: SurfaceRun, root: SurfaceRun): boolean {
  return (
    sameRef(candidate.intent, root.intent) &&
    sameRef(candidate.evidenceManifest, root.evidenceManifest)
  )
}

function companionSurfaces(workspace: KnowledgeWorkspace, root: SurfaceRun): SurfaceRun[] {
  const relations = Object.values(workspace.relations).filter(
    (relation) => relation.lifecycle === 'active' && relation.relationType === 'companion-view-of'
  )
  const primaryIds = new Set<string>([root.id])
  for (const relation of relations) {
    if (relation.sourceId === root.id) primaryIds.add(relation.targetId)
  }
  const candidateIds = new Set<string>()
  for (const relation of relations) {
    if (primaryIds.has(relation.targetId)) candidateIds.add(relation.sourceId)
  }
  for (const primaryId of primaryIds) candidateIds.add(primaryId)
  candidateIds.delete(root.id)

  const candidates = [...candidateIds]
    .filter((id) => Object.hasOwn(workspace.objects, id))
    .map((id) => workspace.objects[id])
    .filter(
      (object): object is SurfaceRun =>
        object.type === 'surface-run' &&
        object.lifecycle === 'active' &&
        object.workspaceId === workspace.id &&
        sharedLineage(object, root)
    )
  return orderedObjects(candidates)
}

function exactBindings(
  workspace: KnowledgeWorkspace,
  surfaces: SurfaceRun[]
): WorkspaceObjectRevisionRef[] {
  const seen = new Set<string>()
  const bindings: WorkspaceObjectRevisionRef[] = []
  for (const surface of surfaces) {
    for (const reference of surface.bindings.objectRefs) {
      exactObject(workspace, reference)
      if (seen.has(reference.objectId)) continue
      seen.add(reference.objectId)
      bindings.push({ ...reference })
    }
  }
  return bindings
}

function receiptsForSurfaces(
  workspace: KnowledgeWorkspace,
  surfaces: SurfaceRun[]
): {
  decisions: Extract<WorkspaceObject, { type: 'decision-receipt' }>[]
  learning: Extract<WorkspaceObject, { type: 'learning-receipt' }>[]
} {
  const surfaceRefs = new Map(surfaces.map((surface) => [surface.id, currentRef(surface)]))
  const belongsToLineage = (
    object: Extract<WorkspaceObject, { type: 'decision-receipt' | 'learning-receipt' }>
  ) => {
    const surfaceRef = surfaceRefs.get(object.surfaceRun.objectId)
    return (
      surfaceRef !== undefined &&
      sameRef(surfaceRef, object.surfaceRun) &&
      surfaces.some(
        (surface) =>
          surface.id === object.surfaceRun.objectId &&
          sameRef(surface.intent, object.intent) &&
          sameRef(surface.evidenceManifest, object.evidenceManifest)
      )
    )
  }
  const active = Object.values(workspace.objects).filter(
    (object) => object.lifecycle === 'active' && object.workspaceId === workspace.id
  )
  return {
    decisions: orderedObjects(
      active.filter(
        (object): object is Extract<WorkspaceObject, { type: 'decision-receipt' }> =>
          object.type === 'decision-receipt' && belongsToLineage(object)
      )
    ),
    learning: orderedObjects(
      active.filter(
        (object): object is Extract<WorkspaceObject, { type: 'learning-receipt' }> =>
          object.type === 'learning-receipt' && belongsToLineage(object)
      )
    )
  }
}

type ExperienceActionObject = Extract<
  WorkspaceObject,
  {
    type:
      | 'action-proposal'
      | 'action-execution-receipt'
      | 'action-verification-receipt'
      | 'action-rollback-receipt'
  }
>

function actionsForDecisions(
  workspace: KnowledgeWorkspace,
  decisions: Extract<WorkspaceObject, { type: 'decision-receipt' }>[]
): ExperienceActionObject[] {
  const decisionRefs = new Set(decisions.map((decision) => `${decision.id}@${decision.revision}`))
  const proposals = Object.values(workspace.objects).filter(
    (object): object is Extract<WorkspaceObject, { type: 'action-proposal' }> =>
      object.type === 'action-proposal' &&
      object.lifecycle === 'active' &&
      object.workspaceId === workspace.id &&
      decisionRefs.has(`${object.decisionReceipt.objectId}@${object.decisionReceipt.revision}`)
  )
  const actions: ExperienceActionObject[] = [...proposals]
  for (const proposal of proposals) {
    for (const reference of [
      proposal.executionReceipt,
      proposal.verificationReceipt,
      proposal.rollbackReceipt
    ]) {
      if (!reference) continue
      const object = exactObject(workspace, reference)
      if (
        object.type === 'action-execution-receipt' ||
        object.type === 'action-verification-receipt' ||
        object.type === 'action-rollback-receipt'
      ) {
        actions.push(object)
      }
    }
  }
  return latestObjects(actions)
}

function exactReviews(
  workspace: KnowledgeWorkspace,
  lineageObjects: WorkspaceObject[]
): Extract<WorkspaceObject, { type: 'review-object' }>[] {
  const exactRevisions = new Map(lineageObjects.map((object) => [object.id, object.revision]))
  return orderedObjects(
    Object.values(workspace.objects).filter(
      (object): object is Extract<WorkspaceObject, { type: 'review-object' }> =>
        object.type === 'review-object' &&
        object.lifecycle === 'active' &&
        object.workspaceId === workspace.id &&
        object.attachedObjectIds.some(
          (objectId) => exactRevisions.get(objectId) === object.attachedRevisions[objectId]
        )
    )
  )
}

function objectsForMembers(
  workspace: KnowledgeWorkspace,
  members: ExperienceProjectionMember[]
): WorkspaceObject[] {
  return members.map((entry) => exactObject(workspace, entry))
}

function supportMember(object: WorkspaceObject): ExperienceProjectionMember | null {
  if (object.type === 'decision-receipt') return member(currentRef(object), 'decision-receipt')
  if (object.type === 'learning-receipt') return member(currentRef(object), 'learning-receipt')
  if (object.type === 'review-object') return member(currentRef(object), 'review-object')
  if (
    object.type === 'action-proposal' ||
    object.type === 'action-execution-receipt' ||
    object.type === 'action-verification-receipt' ||
    object.type === 'action-rollback-receipt'
  ) {
    return member(currentRef(object), 'action')
  }
  return null
}

function latestSupportMembers(
  objects: WorkspaceObject[],
  limit: number
): ExperienceProjectionMember[] {
  return latestObjects(objects)
    .map(supportMember)
    .filter((entry): entry is ExperienceProjectionMember => entry !== null)
    .slice(0, limit)
}

/**
 * Resolves bounded, deterministic projections for one exact SurfaceRun lineage.
 * The result never scans unrelated objects into a projection: discovered objects
 * must be exact surface bindings, exact receipts, exact review attachments, or
 * active companion relations that preserve the same intent and evidence refs.
 */
export function resolveExperienceProjections(
  workspace: KnowledgeWorkspace,
  rootReference: WorkspaceObjectRevisionRef
): ResolvedExperienceProjections {
  const resolvedRoot = exactObject(workspace, rootReference, 'surface-run')
  if (resolvedRoot.type !== 'surface-run') {
    throw new WorkspaceDomainError(
      'validation_failed',
      'experience projection root is not a surface'
    )
  }
  const root = resolvedRoot
  const intent = exactObject(workspace, root.intent, 'intent-record')
  const evidence = exactObject(workspace, root.evidenceManifest, 'evidence-manifest')
  const companions = companionSurfaces(workspace, root)
  const compareCompanions = companions.slice(0, EXPERIENCE_PROJECTION_DENSITY.compare.companions)
  const knowledgeCompanions = companions.slice(
    0,
    EXPERIENCE_PROJECTION_DENSITY.knowledge.companions
  )
  const reviewCompanions = companions.slice(0, EXPERIENCE_PROJECTION_DENSITY.review.companions)
  const compareSurfaces = [root, ...compareCompanions]
  const knowledgeSurfaces = [root, ...knowledgeCompanions]
  const reviewSurfaces = [root, ...reviewCompanions]
  const compareBindings = exactBindings(workspace, compareSurfaces)
  const knowledgeBindings = exactBindings(workspace, knowledgeSurfaces)
  const reviewBindings = exactBindings(workspace, reviewSurfaces)
  const knowledgeReceipts = receiptsForSurfaces(workspace, knowledgeSurfaces)
  const knowledgeActions = actionsForDecisions(workspace, knowledgeReceipts.decisions)
  const reviewReceipts = receiptsForSurfaces(workspace, reviewSurfaces)
  const reviewActions = actionsForDecisions(workspace, reviewReceipts.decisions)
  const compareLineageMembers = uniqueMembers([
    member(currentRef(root), 'root-surface'),
    ...compareCompanions.map((surface) => member(currentRef(surface), 'companion-surface')),
    member(currentRef(intent), 'intent'),
    member(currentRef(evidence), 'evidence-manifest'),
    ...compareBindings.map((reference) => member(reference, 'surface-binding'))
  ])
  const compareReviews = exactReviews(
    workspace,
    objectsForMembers(workspace, compareLineageMembers)
  )
  const knowledgeLineageMembers = uniqueMembers([
    member(currentRef(root), 'root-surface'),
    ...knowledgeCompanions.map((surface) => member(currentRef(surface), 'companion-surface')),
    member(currentRef(intent), 'intent'),
    member(currentRef(evidence), 'evidence-manifest'),
    ...knowledgeBindings.map((reference) => member(reference, 'surface-binding')),
    ...knowledgeReceipts.decisions.map((receipt) =>
      member(currentRef(receipt), 'decision-receipt')
    ),
    ...knowledgeReceipts.learning.map((receipt) => member(currentRef(receipt), 'learning-receipt')),
    ...knowledgeActions.map((action) => member(currentRef(action), 'action'))
  ])
  const knowledgeReviews = exactReviews(
    workspace,
    objectsForMembers(workspace, knowledgeLineageMembers)
  )
  const reviewLineageMembers = uniqueMembers([
    member(currentRef(root), 'root-surface'),
    ...reviewCompanions.map((surface) => member(currentRef(surface), 'companion-surface')),
    member(currentRef(intent), 'intent'),
    member(currentRef(evidence), 'evidence-manifest'),
    ...reviewBindings.map((reference) => member(reference, 'surface-binding')),
    ...reviewReceipts.decisions.map((receipt) => member(currentRef(receipt), 'decision-receipt')),
    ...reviewReceipts.learning.map((receipt) => member(currentRef(receipt), 'learning-receipt')),
    ...reviewActions.map((action) => member(currentRef(action), 'action'))
  ])
  const reviewReviews = exactReviews(workspace, objectsForMembers(workspace, reviewLineageMembers))

  const compareMode = root.modes.find((mode) => mode.kind === 'compare')
  let comparison: ExperienceComparisonResolution
  if (compareCompanions.length > 0) {
    comparison = {
      basis: 'companion-surfaces',
      companionSurfaces: compareCompanions.map(currentRef),
      modeId: compareMode?.id,
      status: 'available'
    }
  } else if (compareMode) {
    comparison = {
      basis: 'renderer-mode',
      companionSurfaces: [],
      modeId: compareMode.id,
      status: 'available'
    }
  } else {
    comparison = {
      basis: 'none',
      companionSurfaces: [],
      reason: 'no-companion-or-renderer-compare-mode',
      status: 'unavailable'
    }
  }

  const focus = uniqueMembers([
    member(currentRef(root), 'root-surface'),
    member(currentRef(intent), 'intent'),
    member(currentRef(evidence), 'evidence-manifest')
  ])
  const compare =
    comparison.status === 'available'
      ? uniqueMembers([
          member(currentRef(root), 'root-surface'),
          ...compareCompanions.map((surface) => member(currentRef(surface), 'companion-surface')),
          member(currentRef(intent), 'intent'),
          member(currentRef(evidence), 'evidence-manifest'),
          ...uniqueMembers([
            ...compareBindings.map((reference) => member(reference, 'surface-binding')),
            ...latestObjects(compareReviews).map((review) =>
              member(currentRef(review), 'review-object')
            )
          ])
            .filter((entry) => entry.objectId !== intent.id && entry.objectId !== evidence.id)
            .slice(0, EXPERIENCE_PROJECTION_DENSITY.compare.supports)
        ])
      : []
  const knowledgeSupports = latestSupportMembers(
    [
      ...knowledgeReceipts.decisions,
      ...knowledgeReceipts.learning,
      ...knowledgeActions,
      ...knowledgeReviews
    ],
    EXPERIENCE_PROJECTION_DENSITY.knowledge.supports
  )
  const knowledge = uniqueMembers([
    member(currentRef(intent), 'intent'),
    member(currentRef(evidence), 'evidence-manifest'),
    member(currentRef(root), 'root-surface'),
    ...knowledgeCompanions.map((surface) => member(currentRef(surface), 'companion-surface')),
    ...knowledgeSupports
  ])
  const latestReviewReceiptOrAction = latestSupportMembers(
    [...reviewReceipts.decisions, ...reviewReceipts.learning, ...reviewActions],
    EXPERIENCE_PROJECTION_DENSITY.review.receiptsOrActions
  )
  const latestReview = latestSupportMembers(
    reviewReviews,
    EXPERIENCE_PROJECTION_DENSITY.review.reviews
  )
  const review = uniqueMembers([
    member(currentRef(root), 'root-surface'),
    ...reviewCompanions.map((surface) => member(currentRef(surface), 'companion-surface')),
    member(currentRef(intent), 'intent'),
    member(currentRef(evidence), 'evidence-manifest'),
    ...latestReviewReceiptOrAction,
    ...latestReview
  ])
  const availablePurposes = PURPOSE_ORDER.filter(
    (purpose) => purpose !== 'compare' || comparison.status === 'available'
  )

  return {
    availablePurposes,
    comparison,
    members: { compare, focus, knowledge, review },
    rootSurface: { ...rootReference }
  }
}
