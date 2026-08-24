import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'

export const AUTOMATION_STAGE_TIMING_CONTRACT = 'automation-stage-timing/v1'

export type AutomationStageTimings = Partial<{
  context_read_ms: number
  mutation_ms: number
  operation_ms: number
  persistence_ms: number
  preflight_ms: number
  presentation_ms: number
  replay_reconciliation_ms: number
}>

export function automationNowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function automationElapsedMs(startedAt: number): number {
  return Math.max(0, automationNowMs() - startedAt)
}

function measuredDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function withAutomationStageTiming(
  result: UnknownRecord,
  startedAt: number,
  stages: AutomationStageTimings
): UnknownRecord {
  const persistence = isUnknownRecord(result.persistence) ? result.persistence : null
  const persistenceMs = measuredDuration(persistence?.duration_ms)
  return {
    ...result,
    timing: {
      contract: AUTOMATION_STAGE_TIMING_CONTRACT,
      stages: {
        ...stages,
        ...(persistenceMs === undefined ? {} : { persistence_ms: persistenceMs })
      },
      total_ms: automationElapsedMs(startedAt)
    }
  }
}
