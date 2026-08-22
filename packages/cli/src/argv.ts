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
