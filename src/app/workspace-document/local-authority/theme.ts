import type { LocalWorkspaceThemeIntent, LocalWorkspaceThemeSetting } from './client'

export type LocalWorkspaceThemeDependencies = {
  applyTheme(theme: LocalWorkspaceThemeSetting): void
  consumeIntent(sequence: number): Promise<boolean>
  readIntent(): Promise<LocalWorkspaceThemeIntent | null>
}

export function createLocalWorkspaceThemeConsumer(dependencies: LocalWorkspaceThemeDependencies) {
  let inFlight: Promise<boolean> | null = null

  function applyPending(): Promise<boolean> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const intent = await dependencies.readIntent()
      if (intent?.consumedAt !== null) return false
      dependencies.applyTheme(intent.theme)
      return dependencies.consumeIntent(intent.sequence)
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return { applyPending }
}
