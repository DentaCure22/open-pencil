function mergedToolNames(current: string | undefined, required: readonly string[]): string {
  const names = (current ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return [...new Set([...names, ...required])].join(',')
}

export function applyAntigravityWorkerEnv(
  env: NodeJS.ProcessEnv,
  eagerToolNames: readonly string[]
): NodeJS.ProcessEnv {
  return {
    ...env,
    AGY_EAGER_MCP_TOOLS: mergedToolNames(env.AGY_EAGER_MCP_TOOLS, eagerToolNames)
  }
}
