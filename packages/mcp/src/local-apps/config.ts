import process from 'node:process'

import type { LocalAppLauncherConfig } from './types'

const SMYLR_APP_ID = 'smylr'
const SMYLR_START_SCRIPT = 'npm run dev'

export function localAppLaunchersFromEnv(
  env: NodeJS.ProcessEnv = process.env
): LocalAppLauncherConfig[] {
  const smylrRoot = env.OPENPENCIL_SMYLR_APP_ROOT?.trim()
  if (!smylrRoot) return []

  return [
    {
      args: ['run', 'dev'],
      command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
      cwd: smylrRoot,
      environment: { PORT: '3000' },
      healthUrl: 'http://127.0.0.1:3000/',
      id: SMYLR_APP_ID,
      label: 'Smylr',
      startScript: SMYLR_START_SCRIPT
    }
  ]
}
