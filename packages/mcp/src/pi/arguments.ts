import type { AgentReasoningEffort } from '#mcp/agent-models/catalog'

export type PiLaunchMode = 'fork' | 'new' | 'resume'

export type PiRpcArgumentsInput = {
  effort: string
  mode: PiLaunchMode
  model: string
  sessionDir?: string
  sessionId: string
  sourceSessionId?: string
}

const PI_THINKING = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function parsePiModelId(modelId: string): { model: string; provider: string } {
  const slash = modelId.indexOf('/')
  if (slash <= 0) return { model: modelId, provider: 'xai' }
  return {
    model: modelId.slice(slash + 1),
    provider: modelId.slice(0, slash)
  }
}

export function piThinkingLevel(effort: string): AgentReasoningEffort | 'off' | 'minimal' {
  if (PI_THINKING.has(effort)) return effort as AgentReasoningEffort | 'off' | 'minimal'
  return 'high'
}

export function piRpcArguments(input: PiRpcArgumentsInput): string[] {
  const { model, provider } = parsePiModelId(input.model)
  const args = [
    '--mode',
    'rpc',
    '--provider',
    provider,
    '--model',
    model,
    '--thinking',
    piThinkingLevel(input.effort),
    '--approve',
    '--session-id',
    input.sessionId
  ]
  if (input.sessionDir) args.push('--session-dir', input.sessionDir)
  if (input.mode === 'fork' && input.sourceSessionId) {
    args.push('--fork', input.sourceSessionId)
  }
  return args
}

export function piPromptWithEvidence(prompt: string, evidencePath?: string): string {
  if (!evidencePath) return prompt
  return `${prompt}\n\nBoard evidence is attached at ${evidencePath}. Read that file if the task needs what the user pointed at.`
}
