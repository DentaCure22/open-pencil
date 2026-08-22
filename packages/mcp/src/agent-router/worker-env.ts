import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const USER_BIN_DIRS = [path.join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
const BUNDLED_RG_DIRS = [
  '/Applications/ChatGPT.app/Contents/Resources',
  '/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin'
]

export function workerBinCandidates(executable?: string): string[] {
  const fromExecutable = executable && path.isAbsolute(executable) ? [path.dirname(executable)] : []
  return [...new Set([...fromExecutable, ...USER_BIN_DIRS, ...BUNDLED_RG_DIRS])]
}

function extraWorkerBinDirs(executable?: string): string[] {
  return workerBinCandidates(executable).filter((directory) => existsSync(directory))
}

export function mergeWorkerPath(existingPath: string, extraDirs: readonly string[]): string {
  const merged = [...extraDirs, ...existingPath.split(path.delimiter)].filter(Boolean)
  return [...new Set(merged)].join(path.delimiter)
}

export function agentWorkerEnv(
  env: NodeJS.ProcessEnv = process.env,
  executable?: string
): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: mergeWorkerPath(env.PATH ?? '', extraWorkerBinDirs(executable))
  }
}
