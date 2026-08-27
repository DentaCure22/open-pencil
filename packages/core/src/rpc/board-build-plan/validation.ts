import { hasPlacementTarget } from './artifacts'
import { boardBuildPlanLayoutMembers } from './layout'
import type {
  BoardBuildPlanArtifact,
  BoardBuildPlanComposition,
  BoardBuildPlanLayout,
  BoardBuildPlanOperation
} from './types'

export function assertTransactionRevertIsolation(
  operations: readonly BoardBuildPlanOperation[],
  artifactCount: number,
  hasComposition: boolean
): void {
  const transactionRevertCount = operations.filter(
    (operation) => operation.kind === 'transaction.revert'
  ).length
  if (
    transactionRevertCount > 0 &&
    (transactionRevertCount !== 1 || operations.length !== 1 || artifactCount > 0 || hasComposition)
  ) {
    throw new Error('transaction.revert must be the only effect in a Board plan.')
  }
}

export function deletedObjectIds(
  operations: readonly BoardBuildPlanOperation[]
): ReadonlySet<string> {
  const deleted = new Set<string>()
  for (const [index, operation] of operations.entries()) {
    if (!('object_id' in operation)) continue
    if (deleted.has(operation.object_id)) {
      throw new Error(`plan.operations[${index}] targets an object after deleting it.`)
    }
    if (
      operation.kind === 'object.move' &&
      'relative_to' in operation &&
      deleted.has(operation.relative_to.object_id)
    ) {
      throw new Error(
        `plan.operations[${index}].relative_to references an object deleted by the same plan.`
      )
    }
    if (operation.kind === 'object.delete') deleted.add(operation.object_id)
  }
  return deleted
}

function artifactReferencedObjectIds(artifact: BoardBuildPlanArtifact): string[] {
  const objectIds: Array<string | undefined> = [
    artifact.anchor && 'object_id' in artifact.anchor ? artifact.anchor.object_id : undefined,
    artifact.recipe.placement?.target?.kind === 'relative'
      ? artifact.recipe.placement.target.object_id
      : undefined,
    artifact.recipe.kind === 'native_diagram' ? artifact.recipe.owner_id : undefined,
    artifact.recipe.kind === 'canonical_object' ? artifact.recipe.source_object_id : undefined
  ]
  return objectIds.filter((objectId): objectId is string => Boolean(objectId))
}

export function assertArtifactsAvoidDeletedObjects(
  artifacts: readonly BoardBuildPlanArtifact[],
  deleted: ReadonlySet<string>
): void {
  for (const [index, artifact] of artifacts.entries()) {
    if (artifactReferencedObjectIds(artifact).some((objectId) => deleted.has(objectId))) {
      throw new Error(`plan.artifacts[${index}] references an object deleted by the same plan.`)
    }
  }
}

export function assertLayoutAvoidsDeletedObjects(
  layout: BoardBuildPlanLayout | undefined,
  deleted: ReadonlySet<string>
): void {
  if (layout && 'object_id' in layout.anchor && deleted.has(layout.anchor.object_id)) {
    throw new Error('plan.layout references an object deleted by the same plan.')
  }
}

export function assertCompositionCompatibility(
  composition: BoardBuildPlanComposition | undefined,
  operations: readonly BoardBuildPlanOperation[],
  deleted: ReadonlySet<string>
): void {
  if (!composition) return
  const existingMemberIds = new Set(
    composition.members.flatMap((member) => ('object_id' in member ? [member.object_id] : []))
  )
  const referencesDeletedObject =
    (composition.anchor &&
      'object_id' in composition.anchor &&
      deleted.has(composition.anchor.object_id)) ||
    [...existingMemberIds].some((objectId) => deleted.has(objectId))
  if (referencesDeletedObject) {
    throw new Error('plan.composition references an object deleted by the same plan.')
  }
  for (const [index, operation] of operations.entries()) {
    if (
      'object_id' in operation &&
      existingMemberIds.has(operation.object_id) &&
      (operation.kind === 'object.delete' ||
        operation.kind === 'object.move' ||
        operation.kind === 'object.resize')
    ) {
      throw new Error(
        `plan.operations[${index}] conflicts with plan.composition ownership of object "${operation.object_id}".`
      )
    }
  }
}

function assertNativeDiagramRefinementPlacement(
  artifact: BoardBuildPlanArtifact,
  index: number,
  layoutMembers: ReadonlySet<string>,
  compositionMembers: ReadonlySet<string>
): boolean {
  if (artifact.recipe.kind !== 'native_diagram' || !artifact.recipe.owner_id) return false
  if (
    layoutMembers.has(artifact.alias) ||
    compositionMembers.has(artifact.alias) ||
    artifact.anchor ||
    hasPlacementTarget(artifact.recipe)
  ) {
    throw new Error(
      `plan.artifacts[${index}] native_diagram refinement cannot use anchor, composition, layout, or recipe.placement.target.`
    )
  }
  return true
}

function recipeRequiresExclusivePlacement(artifact: BoardBuildPlanArtifact): boolean {
  return (
    artifact.recipe.kind === 'native_text' ||
    artifact.recipe.kind === 'code_object' ||
    artifact.recipe.kind === 'trusted_web_app' ||
    artifact.recipe.kind === 'native_diagram' ||
    artifact.recipe.kind === 'canonical_object'
  )
}

function assertStandaloneArtifactPlacement(artifact: BoardBuildPlanArtifact, index: number): void {
  const hasAnchor = Boolean(artifact.anchor)
  const hasTarget = hasPlacementTarget(artifact.recipe)
  if (recipeRequiresExclusivePlacement(artifact) && hasAnchor === hasTarget) {
    throw new Error(
      `plan.artifacts[${index}] ${artifact.recipe.kind} requires exactly one of anchor or recipe.placement.target.`
    )
  }
  if (artifact.recipe.kind !== 'native_card') return
  if (hasAnchor && hasTarget) {
    throw new Error(
      `plan.artifacts[${index}] native_card requires exactly one of anchor or recipe.placement.target.`
    )
  }
  if (!hasAnchor && !hasTarget) {
    throw new Error(
      `plan.artifacts[${index}] native_card requires an anchor or recipe.placement.target.`
    )
  }
}

export function assertArtifactPlacementOwnership(
  artifacts: readonly BoardBuildPlanArtifact[],
  layout: BoardBuildPlanLayout | undefined,
  composition: BoardBuildPlanComposition | undefined
): void {
  const layoutMembers = new Set(boardBuildPlanLayoutMembers(layout))
  const compositionMembers = new Set(
    composition?.members.flatMap((member) => ('alias' in member ? [member.alias] : []))
  )
  for (const [index, artifact] of artifacts.entries()) {
    if (
      assertNativeDiagramRefinementPlacement(artifact, index, layoutMembers, compositionMembers)
    ) {
      continue
    }
    if (layoutMembers.has(artifact.alias) || compositionMembers.has(artifact.alias)) continue
    assertStandaloneArtifactPlacement(artifact, index)
  }
}
