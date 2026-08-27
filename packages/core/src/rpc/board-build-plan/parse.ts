import { parseArtifact } from './artifacts'
import { parseComposition, parseLayout } from './layout'
import { parseOperation } from './operations'
import { exactFields, isRecord } from './parsing'
import type { JsonRecord } from './parsing'
import {
  BOARD_BUILD_PLAN_CONTRACT,
  BOARD_BUILD_PLAN_MAX_ARTIFACTS,
  BOARD_BUILD_PLAN_MAX_OPERATIONS,
  type BoardBuildPlan,
  type BoardBuildPlanArtifact,
  type BoardBuildPlanOperation
} from './types'
import {
  assertArtifactPlacementOwnership,
  assertArtifactsAvoidDeletedObjects,
  assertCompositionCompatibility,
  assertLayoutAvoidsDeletedObjects,
  assertTransactionRevertIsolation,
  deletedObjectIds
} from './validation'

function assertPlanContract(value: JsonRecord): void {
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
}

function parseArtifacts(value: unknown): BoardBuildPlanArtifact[] {
  if (!Array.isArray(value) || value.length > BOARD_BUILD_PLAN_MAX_ARTIFACTS) {
    throw new Error(`plan.artifacts must contain 0 to ${BOARD_BUILD_PLAN_MAX_ARTIFACTS} entries.`)
  }
  const aliases = new Set<string>()
  return value.map((artifact, index) => {
    const parsed = parseArtifact(artifact, index, aliases)
    if (aliases.has(parsed.alias)) throw new Error(`plan alias "${parsed.alias}" is duplicated.`)
    aliases.add(parsed.alias)
    return parsed
  })
}

function parseOperations(value: unknown): BoardBuildPlanOperation[] {
  const operations = value ?? []
  if (!Array.isArray(operations) || operations.length > BOARD_BUILD_PLAN_MAX_OPERATIONS) {
    throw new Error(`plan.operations must contain 0 to ${BOARD_BUILD_PLAN_MAX_OPERATIONS} entries.`)
  }
  return operations.map((operation, index) => parseOperation(operation, index))
}

function assertPlanHasEffect(
  artifacts: readonly BoardBuildPlanArtifact[],
  operations: readonly BoardBuildPlanOperation[],
  hasComposition: boolean
): void {
  if (artifacts.length === 0 && operations.length === 0 && !hasComposition) {
    throw new Error('plan must contain at least one artifact, composition, or operation.')
  }
}

export function parseBoardBuildPlan(value: unknown): BoardBuildPlan {
  if (!isRecord(value)) throw new Error('board build plan must be an object.')
  exactFields(
    value,
    ['artifacts', 'composition', 'contract', 'layout', 'operations', 'version'],
    'plan'
  )
  assertPlanContract(value)
  const artifacts = parseArtifacts(value.artifacts)
  const operations = parseOperations(value.operations)
  const hasComposition = value.composition !== undefined
  assertPlanHasEffect(artifacts, operations, hasComposition)
  assertTransactionRevertIsolation(operations, artifacts.length, hasComposition)
  const deleted = deletedObjectIds(operations)
  assertArtifactsAvoidDeletedObjects(artifacts, deleted)
  if (value.composition !== undefined && value.layout !== undefined) {
    throw new Error('plan may contain composition or layout, but not both.')
  }
  const composition = parseComposition(value.composition, artifacts)
  const layout = parseLayout(value.layout, artifacts)
  assertLayoutAvoidsDeletedObjects(layout, deleted)
  assertCompositionCompatibility(composition, operations, deleted)
  const plan: BoardBuildPlan = {
    artifacts,
    ...(composition ? { composition } : {}),
    contract: BOARD_BUILD_PLAN_CONTRACT,
    ...(operations.length > 0 ? { operations } : {}),
    ...(layout ? { layout } : {})
  }
  assertArtifactPlacementOwnership(artifacts, layout, composition)
  return plan
}
