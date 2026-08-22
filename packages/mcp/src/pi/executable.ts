import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const PI_CANDIDATES = [
  path.join(homedir(), '.local', 'share', 'pi-node', 'current', 'bin', 'pi'),
  path.join(homedir(), '.local', 'bin', 'pi'),
  '/opt/homebrew/bin/pi',
  '/usr/local/bin/pi'
]

export function resolvePiExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.OPENPENCIL_PI_EXECUTABLE?.trim()
  if (explicit) return explicit
  return PI_CANDIDATES.find((candidate) => existsSync(candidate)) ?? 'pi'
}
