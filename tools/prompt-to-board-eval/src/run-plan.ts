import { parseEvaluationConfiguration, type EvaluationConfiguration } from './evaluation-config'
import { parseEvalTarget, type EvalTarget } from './schema'

export interface CampaignRunPlan {
  configuration: EvaluationConfiguration
  exact_target?: EvalTarget
  recovery_of_run_id?: string
  run_id: string
  scenario_id: string
  warm_session_id?: string
}

function requiredRecord(value: unknown, label: string): object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function requiredString(record: object, field: string, label: string): string {
  const value = Reflect.get(record, field)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.${field} must be a non-empty string.`)
  }
  return value
}

export function parseCampaignRunPlans(value: unknown): CampaignRunPlan[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Campaign run plan must be a non-empty array.')
  }
  return value.map((item, index) => {
    const label = `Campaign run plan[${index}]`
    const record = requiredRecord(item, label)
    const exactTargetValue = Reflect.get(record, 'exact_target')
    const recoveryOfRunValue = Reflect.get(record, 'recovery_of_run_id')
    const warmSessionValue = Reflect.get(record, 'warm_session_id')
    if (
      recoveryOfRunValue !== undefined &&
      (typeof recoveryOfRunValue !== 'string' || !recoveryOfRunValue.trim())
    ) {
      throw new Error(`${label}.recovery_of_run_id must be a non-empty string when supplied.`)
    }
    if (
      warmSessionValue !== undefined &&
      (typeof warmSessionValue !== 'string' || !warmSessionValue.trim())
    ) {
      throw new Error(`${label}.warm_session_id must be a non-empty string when supplied.`)
    }
    return {
      configuration: parseEvaluationConfiguration(Reflect.get(record, 'configuration')),
      exact_target: exactTargetValue === undefined ? undefined : parseEvalTarget(exactTargetValue),
      recovery_of_run_id:
        typeof recoveryOfRunValue === 'string' ? recoveryOfRunValue.trim() : undefined,
      run_id: requiredString(record, 'run_id', label),
      scenario_id: requiredString(record, 'scenario_id', label),
      warm_session_id: typeof warmSessionValue === 'string' ? warmSessionValue : undefined
    }
  })
}
