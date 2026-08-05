import { spawn } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import process from 'node:process'

import type { LocalAppLauncherConfig, LocalAppStartReceipt, LocalAppStatus } from './types'

const HEALTH_TIMEOUT_MS = 1_000
const START_HEALTH_ATTEMPTS = 24
const START_HEALTH_INTERVAL_MS = 250

type LocalAppManagerDependencies = {
  isHealthy: (url: string) => Promise<boolean>
  launch: (config: LocalAppLauncherConfig) => Promise<void>
  validateRoot: (root: string) => Promise<void>
  wait: (milliseconds: number) => Promise<void>
}

export class LocalAppLaunchError extends Error {
  override name = 'LocalAppLaunchError'

  constructor(
    readonly code: 'invalid_root' | 'launch_failed',
    message: string
  ) {
    super(message)
  }
}

async function defaultHealthCheck(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

async function defaultLaunch(config: LocalAppLauncherConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(config.command, config.args, {
      cwd: config.cwd,
      detached: true,
      env: { ...process.env, ...config.environment },
      stdio: 'ignore'
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    throw new LocalAppLaunchError('launch_failed', `Could not start app: ${message}`)
  })
}

async function defaultValidateRoot(root: string): Promise<void> {
  try {
    await access(await realpath(root))
  } catch {
    throw new LocalAppLaunchError('invalid_root', 'The configured app folder is unavailable')
  }
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

export class LocalAppManager {
  private readonly launchers = new Map<string, LocalAppLauncherConfig>()
  private readonly starting = new Map<string, Promise<LocalAppStartReceipt>>()
  private readonly dependencies: LocalAppManagerDependencies

  constructor(
    launchers: readonly LocalAppLauncherConfig[],
    dependencies: Partial<LocalAppManagerDependencies> = {}
  ) {
    for (const launcher of launchers) {
      if (!launcher.id.trim() || this.launchers.has(launcher.id)) continue
      this.launchers.set(launcher.id, structuredClone(launcher))
    }
    this.dependencies = {
      isHealthy: dependencies.isHealthy ?? defaultHealthCheck,
      launch: dependencies.launch ?? defaultLaunch,
      validateRoot: dependencies.validateRoot ?? defaultValidateRoot,
      wait: dependencies.wait ?? defaultWait
    }
  }

  has(appId: string): boolean {
    return this.launchers.has(appId)
  }

  async status(appId: string): Promise<LocalAppStatus | null> {
    const launcher = this.launchers.get(appId)
    if (!launcher) return null
    const running = await this.dependencies.isHealthy(launcher.healthUrl)
    let state: LocalAppStatus['state'] = 'stopped'
    if (running) state = 'running'
    else if (this.starting.has(appId)) state = 'starting'
    return {
      appId: launcher.id,
      label: launcher.label,
      startScript: launcher.startScript,
      state
    }
  }

  start(appId: string): Promise<LocalAppStartReceipt> | null {
    const launcher = this.launchers.get(appId)
    if (!launcher) return null
    const pending = this.starting.get(appId)
    if (pending) return pending

    const request = this.startLauncher(launcher).finally(() => {
      if (this.starting.get(appId) === request) this.starting.delete(appId)
    })
    this.starting.set(appId, request)
    return request
  }

  private async startLauncher(launcher: LocalAppLauncherConfig): Promise<LocalAppStartReceipt> {
    if (await this.dependencies.isHealthy(launcher.healthUrl)) {
      return this.receipt(launcher, 'already_running')
    }

    await this.dependencies.validateRoot(launcher.cwd)
    await this.dependencies.launch(launcher)
    for (let attempt = 0; attempt < START_HEALTH_ATTEMPTS; attempt += 1) {
      if (await this.dependencies.isHealthy(launcher.healthUrl)) {
        return this.receipt(launcher, 'started')
      }
      await this.dependencies.wait(START_HEALTH_INTERVAL_MS)
    }
    return this.receipt(launcher, 'starting')
  }

  private receipt(
    launcher: LocalAppLauncherConfig,
    state: LocalAppStartReceipt['state']
  ): LocalAppStartReceipt {
    return {
      appId: launcher.id,
      label: launcher.label,
      startScript: launcher.startScript,
      state
    }
  }
}
