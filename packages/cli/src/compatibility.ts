const LEGACY_INSPECTION_COMMANDS = new Set([
  'find',
  'info',
  'node',
  'pages',
  'query',
  'selection',
  'tree',
  'variables'
])

const STDIN_VALUE_OPTIONS = new Set(['--request-file'])

export function rewriteStdinValueArgs(rawArgs: string[]): string[] {
  const rewritten: string[] = []
  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index]
    const next = rawArgs[index + 1]
    if (value && STDIN_VALUE_OPTIONS.has(value) && next === '-') {
      rewritten.push(`${value}=-`)
      index += 1
    } else if (value) {
      rewritten.push(value)
    }
  }
  return rewritten
}

export function rewriteLegacyInspectionArgs(rawArgs: string[]): string[] {
  const command = rawArgs[0]
  if (!command) return rawArgs
  if (LEGACY_INSPECTION_COMMANDS.has(command)) {
    return ['inspect', command, ...rawArgs.slice(1)]
  }
  if (command === 'boards' && rawArgs[1] === 'list') {
    return ['board', 'search', ...rawArgs.slice(2)]
  }
  if (command === 'boards') return ['board', ...rawArgs.slice(1)]
  if (command === 'documents') return ['board', 'search', ...rawArgs.slice(1)]
  return rawArgs
}
