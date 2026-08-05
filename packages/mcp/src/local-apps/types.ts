export type LocalAppLauncherConfig = {
  args: string[]
  command: string
  cwd: string
  environment?: Readonly<Record<string, string>>
  healthUrl: string
  id: string
  label: string
  startScript: string
}

export type LocalAppRuntimeState = 'running' | 'starting' | 'stopped'

export type LocalAppStatus = {
  appId: string
  label: string
  startScript: string
  state: LocalAppRuntimeState
}

export type LocalAppStartReceipt = {
  appId: string
  label: string
  startScript: string
  state: 'already_running' | 'started' | 'starting'
}
