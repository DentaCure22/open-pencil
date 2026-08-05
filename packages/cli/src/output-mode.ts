const AGENT_BOARD_COMMANDS = new Set([
  'build',
  'change',
  'connect',
  'context',
  'create',
  'edit',
  'fixture',
  'history',
  'list',
  'open',
  'present',
  'read',
  'search',
  'verify'
])

export function applyAgentOutputMode(rawArgs: string[], outputMode: string | undefined): string[] {
  const boardCommand = rawArgs[0] === 'board' && AGENT_BOARD_COMMANDS.has(rawArgs[1] ?? '')
  if ((outputMode !== 'json' && outputMode !== 'release') || !boardCommand) {
    return rawArgs
  }
  if (rawArgs.includes('--no-json')) {
    throw new Error(`OPENPENCIL_OUTPUT=${outputMode} conflicts with --no-json.`)
  }
  const withJson = rawArgs.includes('--json') ? rawArgs : [...rawArgs, '--json']
  if (outputMode !== 'release' || rawArgs[1] !== 'build') return withJson
  return withJson.includes('--release-summary') ? withJson : [...withJson, '--release-summary']
}
