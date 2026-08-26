import { requiredString } from './parsing'
import {
  BOARD_BUILD_PLAN_CONTRACT,
  type BoardBuildPlan,
  type BoardBuildPlanDigestMetadata
} from './types'

export function boardBuildPlanDigestInput(
  plan: BoardBuildPlan,
  metadata: BoardBuildPlanDigestMetadata
): Record<string, unknown> {
  return {
    contract: BOARD_BUILD_PLAN_CONTRACT,
    intent: requiredString(metadata.intent, 'intent', 1_000),
    plan: structuredClone(plan),
    route: 'board_build:plan/v1',
    target: structuredClone(metadata.target),
    ...(metadata.task_id ? { task_id: requiredString(metadata.task_id, 'task_id') } : {}),
    ...(metadata.trace_id ? { trace_id: requiredString(metadata.trace_id, 'trace_id') } : {})
  }
}
