import { hasPlacementTarget, parseArtifact } from './artifacts'
import {
  boardBuildPlanInboundReferences,
  connectionKey,
  parseConnection,
  parseOperation
} from './connections-operations'
import { boardBuildPlanLayoutMembers, parseComposition, parseLayout } from './layout'
import { exactFields, isRecord } from './parsing'
import {
  BOARD_BUILD_PLAN_CONTRACT,
  BOARD_BUILD_PLAN_MAX_ARTIFACTS,
  BOARD_BUILD_PLAN_MAX_CONNECTIONS,
  BOARD_BUILD_PLAN_MAX_OPERATIONS,
  type BoardBuildPlan
} from './types'

export function parseBoardBuildPlan(value: unknown): BoardBuildPlan {
  if (!isRecord(value)) throw new Error('board build plan must be an object.')
  exactFields(
    value,
    ['artifacts', 'composition', 'connections', 'contract', 'layout', 'operations', 'version'],
    'plan'
  )
  if (
    value.contract !== undefined &&
    value.version !== undefined &&
    value.contract !== value.version
  ) {
    throw new Error('plan.contract and plan.version must match when both are supplied.')
  }
  if ((value.contract ?? value.version) !== BOARD_BUILD_PLAN_CONTRACT) {
    throw new Error(`plan.contract or plan.version must be ${BOARD_BUILD_PLAN_CONTRACT}.`)
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length > BOARD_BUILD_PLAN_MAX_ARTIFACTS) {
    throw new Error(`plan.artifacts must contain 0 to ${BOARD_BUILD_PLAN_MAX_ARTIFACTS} entries.`)
  }
  if (
    !Array.isArray(value.connections) ||
    value.connections.length > BOARD_BUILD_PLAN_MAX_CONNECTIONS
  ) {
    throw new Error(
      `plan.connections must contain 0 to ${BOARD_BUILD_PLAN_MAX_CONNECTIONS} entries.`
    )
  }
  const aliases = new Set<string>()
  const artifacts = value.artifacts.map((artifact, index) => {
    const parsed = parseArtifact(artifact, index, aliases)
    if (aliases.has(parsed.alias)) throw new Error(`plan alias "${parsed.alias}" is duplicated.`)
    aliases.add(parsed.alias)
    return parsed
  })
  const connections = value.connections.map((connection, index) =>
    parseConnection(connection, index, aliases)
  )
  const rawOperations = value.operations ?? []
  if (!Array.isArray(rawOperations) || rawOperations.length > BOARD_BUILD_PLAN_MAX_OPERATIONS) {
    throw new Error(`plan.operations must contain 0 to ${BOARD_BUILD_PLAN_MAX_OPERATIONS} entries.`)
  }
  const operations = rawOperations.map((operation, index) => parseOperation(operation, index))
  if (
    artifacts.length === 0 &&
    connections.length === 0 &&
    operations.length === 0 &&
    value.composition === undefined
  ) {
    throw new Error(
      'plan must contain at least one artifact, composition, connection, or operation.'
    )
  }
  const transactionReverts = operations.filter(
    (operation) => operation.kind === 'transaction.revert'
  )
  if (
    transactionReverts.length > 0 &&
    (transactionReverts.length !== 1 ||
      operations.length !== 1 ||
      artifacts.length > 0 ||
      connections.length > 0 ||
      value.composition !== undefined)
  ) {
    throw new Error('transaction.revert must be the only effect in a Board plan.')
  }
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
  for (const [index, connection] of connections.entries()) {
    for (const reference of [connection.source, connection.target]) {
      if ('object_id' in reference && deleted.has(reference.object_id)) {
        throw new Error(`plan.connections[${index}] references an object deleted by the same plan.`)
      }
    }
  }
  for (const [index, artifact] of artifacts.entries()) {
    const objectIds = [
      artifact.anchor && 'object_id' in artifact.anchor ? artifact.anchor.object_id : undefined,
      artifact.recipe.placement?.target?.kind === 'relative'
        ? artifact.recipe.placement.target.object_id
        : undefined,
      artifact.recipe.kind === 'native_diagram' ? artifact.recipe.owner_id : undefined,
      artifact.recipe.kind === 'canonical_object' ? artifact.recipe.source_object_id : undefined
    ].filter((objectId): objectId is string => Boolean(objectId))
    if (objectIds.some((objectId) => deleted.has(objectId))) {
      throw new Error(`plan.artifacts[${index}] references an object deleted by the same plan.`)
    }
  }
  const connectionKeys = new Set<string>()
  for (const connection of connections) {
    const key = connectionKey(connection)
    if (connectionKeys.has(key)) throw new Error('plan contains a duplicate connection.')
    connectionKeys.add(key)
  }
  if (value.composition !== undefined && value.layout !== undefined) {
    throw new Error('plan may contain composition or layout, but not both.')
  }
  const composition = parseComposition(value.composition, artifacts)
  const layout = parseLayout(value.layout, artifacts)
  if (layout && 'object_id' in layout.anchor && deleted.has(layout.anchor.object_id)) {
    throw new Error('plan.layout references an object deleted by the same plan.')
  }
  if (composition) {
    const existingMemberIds = new Set(
      composition.members.flatMap((member) => ('object_id' in member ? [member.object_id] : []))
    )
    if (
      (composition.anchor &&
        'object_id' in composition.anchor &&
        deleted.has(composition.anchor.object_id)) ||
      [...existingMemberIds].some((objectId) => deleted.has(objectId))
    ) {
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
  const plan: BoardBuildPlan = {
    artifacts,
    ...(composition ? { composition } : {}),
    connections,
    contract: BOARD_BUILD_PLAN_CONTRACT,
    ...(operations.length > 0 ? { operations } : {}),
    ...(layout ? { layout } : {})
  }
  const layoutMembers = new Set(boardBuildPlanLayoutMembers(layout))
  const compositionMembers = new Set(
    composition?.members.flatMap((member) => ('alias' in member ? [member.alias] : [])) ?? []
  )
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.recipe.kind === 'native_diagram' && artifact.recipe.owner_id) {
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
      continue
    }
    if (layoutMembers.has(artifact.alias) || compositionMembers.has(artifact.alias)) continue
    if (
      (artifact.recipe.kind === 'native_text' ||
        artifact.recipe.kind === 'code_object' ||
        artifact.recipe.kind === 'trusted_web_app' ||
        artifact.recipe.kind === 'native_diagram' ||
        artifact.recipe.kind === 'canonical_object') &&
      Boolean(artifact.anchor) === hasPlacementTarget(artifact.recipe)
    ) {
      throw new Error(
        `plan.artifacts[${index}] ${artifact.recipe.kind} requires exactly one of anchor or recipe.placement.target.`
      )
    }
    if (
      artifact.recipe.kind === 'native_card' &&
      artifact.anchor &&
      hasPlacementTarget(artifact.recipe)
    ) {
      throw new Error(
        `plan.artifacts[${index}] native_card requires exactly one of anchor or recipe.placement.target.`
      )
    }
    if (
      artifact.recipe.kind === 'native_card' &&
      !artifact.anchor &&
      !hasPlacementTarget(artifact.recipe) &&
      (boardBuildPlanInboundReferences(plan, artifact.alias).length < 2 ||
        boardBuildPlanInboundReferences(plan, artifact.alias).some(
          (reference) => !('alias' in reference)
        ))
    ) {
      throw new Error(
        `plan.artifacts[${index}] native_card requires exactly one of anchor or recipe.placement.target unless at least two distinct inbound aliases define convergence placement.`
      )
    }
  }
  return plan
}
