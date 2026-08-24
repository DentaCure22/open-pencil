const AGENT_BOARD_COMMANDS = new Set(['go', 'theme', 'where'])

export function applyAgentOutputMode(rawArgs: string[], outputMode: string | undefined): string[] {
  const boardCommand = rawArgs[0] === 'board' && AGENT_BOARD_COMMANDS.has(rawArgs[1] ?? '')
  if ((outputMode !== 'json' && outputMode !== 'release') || !boardCommand) {
    return rawArgs
  }
  if (rawArgs.includes('--no-json')) {
    throw new Error(`OPENPENCIL_OUTPUT=${outputMode} conflicts with --no-json.`)
  }
  return rawArgs.includes('--json') ? rawArgs : [...rawArgs, '--json']
}
