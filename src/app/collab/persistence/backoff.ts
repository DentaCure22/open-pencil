export type BackoffOptions = {
  attempt: number
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio?: number
  randomFraction?: number
}

function secureRandomFraction(): number {
  const value = new Uint32Array(1)
  crypto.getRandomValues(value)
  return (value[0] ?? 0) / 0x1_0000_0000
}

export function exponentialBackoffDelay({
  attempt,
  baseDelayMs,
  maxDelayMs,
  jitterRatio = 0.2,
  randomFraction = secureRandomFraction()
}: BackoffOptions): number {
  const boundedAttempt = Math.max(0, Math.floor(attempt))
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** boundedAttempt)
  const boundedJitter = Math.min(1, Math.max(0, jitterRatio))
  const centeredRandom = Math.min(1, Math.max(0, randomFraction)) * 2 - 1
  return Math.max(0, Math.round(exponential * (1 + centeredRandom * boundedJitter)))
}
