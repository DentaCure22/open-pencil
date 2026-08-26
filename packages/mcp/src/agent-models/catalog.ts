export type AgentReasoningEffort = 'high' | 'low' | 'max' | 'medium' | 'ultra' | 'xhigh'

export type AgentModelDefinition = {
  defaultEffort: AgentReasoningEffort
  efforts: AgentReasoningEffort[]
  group: string
  id: string
  label: string
}

export function resolveAgentModel(
  models: readonly AgentModelDefinition[],
  modelId?: string | null
): AgentModelDefinition {
  const model = models.find((candidate) => candidate.id === modelId) ?? models.at(0)
  if (!model) throw new TypeError('No Pi models are available.')
  return model
}

export function resolveAgentEffort(
  model: AgentModelDefinition,
  effort?: string | null
): AgentReasoningEffort {
  if (effort && model.efforts.includes(effort as AgentReasoningEffort)) {
    return effort as AgentReasoningEffort
  }
  return model.defaultEffort
}

export function resolveAgentSelection(
  models: readonly AgentModelDefinition[],
  modelId?: string | null,
  effort?: string | null
): { effort: AgentReasoningEffort; model: string } {
  const model = resolveAgentModel(models, modelId)
  return {
    effort: resolveAgentEffort(model, effort),
    model: model.id
  }
}
