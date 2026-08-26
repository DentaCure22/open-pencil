export const TRANSCRIPT_HYDRATION_BATCH = 2
export const TRANSCRIPT_HYDRATION_IDLE_TIMEOUT_MS = 200
export const LIVE_TRANSCRIPT_INTERVAL_MS = 80

type LiveTranscriptMessage = {
  completedAt?: string
  id: string
  role: string
}

export type TranscriptHydrationHandle = () => void

export function liveStreamingThreadIds(
  threads: readonly { id: string; state?: string }[],
  retainedIds: Iterable<string>
): string[] {
  const retained = new Set(retainedIds)
  return threads.flatMap((thread) =>
    retained.has(thread.id) && thread.state === 'running' ? [thread.id] : []
  )
}

/**
 * Return the last stable message before the changing tail. Live polling can
 * then request only messages after this cursor instead of downloading the
 * whole transcript on every tick.
 */
export function liveTranscriptAfterCursor(
  messages: readonly LiveTranscriptMessage[]
): string | undefined {
  if (!messages.length) return undefined
  const latestUserIndex = messages.findLastIndex((message) => message.role === 'user')
  const firstMutableIndex = messages.findIndex(
    (message, index) => index > latestUserIndex && !message.completedAt
  )
  if (firstMutableIndex === -1) return messages.at(-1)?.id
  return messages[firstMutableIndex - 1]?.id
}

export function resolvePreviewTranscriptSource<T>(input: {
  cached?: T
  current?: T
  retained: boolean
}): T | undefined {
  if (input.cached) return input.cached
  if (input.retained) return input.current
  return undefined
}

export function nextTranscriptHydrationBatch(
  retainedIds: readonly string[],
  options: {
    batchSize?: number
    hydratedUpdatedAt: ReadonlyMap<string, string>
    updatedAtByThreadId: ReadonlyMap<string, string>
  }
): string[] {
  const batchSize = Math.max(1, options.batchSize ?? TRANSCRIPT_HYDRATION_BATCH)
  const pending: string[] = []
  for (const threadId of retainedIds) {
    const updatedAt = options.updatedAtByThreadId.get(threadId)
    if (updatedAt === undefined) continue
    if (options.hydratedUpdatedAt.get(threadId) === updatedAt) continue
    pending.push(threadId)
    if (pending.length >= batchSize) break
  }
  return pending
}

export function scheduleTranscriptHydration(work: () => void): TranscriptHydrationHandle {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => work(), { timeout: TRANSCRIPT_HYDRATION_IDLE_TIMEOUT_MS })
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id)
    }
  }
  const id = setTimeout(work, 16)
  return () => clearTimeout(id)
}

export type BoardTranscriptRetainPlan =
  | { type: 'clear' }
  | { type: 'keep' }
  | { type: 'retain'; id: string }
  | { type: 'schedule'; id: string }

export function planBoardTranscriptRetain(input: {
  idleForId: string | null
  interactionEnabled: boolean
  nextId: string | null
  retainedId: string | null
}): BoardTranscriptRetainPlan {
  const { idleForId, interactionEnabled, nextId, retainedId } = input
  if (!nextId) return retainedId || idleForId ? { type: 'clear' } : { type: 'keep' }
  if (interactionEnabled) {
    return retainedId === nextId && !idleForId ? { type: 'keep' } : { type: 'retain', id: nextId }
  }
  if (retainedId === nextId || idleForId === nextId) return { type: 'keep' }
  return { type: 'schedule', id: nextId }
}
