import type { AutomationTarget } from '@/app/automation/bridge/target'
import { setAppTheme } from '@/app/shell/theme'

function normalizeThemeMode(mode: unknown): 'dark' | 'light' | 'auto' {
  if (mode === 'light' || mode === 'dark') return mode
  if (mode === 'system') return 'auto'
  throw new Error('set_theme requires mode: "light", "dark", or "system".')
}

export async function handleSetTheme(_target: AutomationTarget, args: unknown): Promise<unknown> {
  const theme = normalizeThemeMode((args as { mode?: unknown }).mode)
  setAppTheme(theme)
  return { ok: true, result: { theme } }
}
