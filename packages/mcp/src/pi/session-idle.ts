export const DEFAULT_IDLE_UNLOAD_MS = 21 * 60 * 1000
export const DEFAULT_IDLE_UNLOAD_GRACE_MS = 30_000

export function resolveIdleUnloadMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PI_SESSION_IDLE_UNLOAD_MS)
  if (Number.isFinite(raw) && raw >= 0) return Math.trunc(raw)
  return DEFAULT_IDLE_UNLOAD_MS
}

export function resolveIdleUnloadGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PI_SESSION_IDLE_UNLOAD_GRACE_MS)
  if (Number.isFinite(raw) && raw >= 0) return Math.trunc(raw)
  return DEFAULT_IDLE_UNLOAD_GRACE_MS
}

export function shouldUnloadIdleSession(input: {
  activeJobId: string | null
  now?: number
  settledAt: number | null
  unloadMs?: number
}): boolean {
  if (input.activeJobId) return false
  if (input.settledAt === null) return false
  const unloadMs = input.unloadMs ?? DEFAULT_IDLE_UNLOAD_MS
  return (input.now ?? Date.now()) - input.settledAt >= unloadMs
}
