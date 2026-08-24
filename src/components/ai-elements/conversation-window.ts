export const CONVERSATION_RUN_DEFAULT_HEIGHT = 280
export const CONVERSATION_RUN_OVERSCAN = 2
export const CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT = 8
export const CONVERSATION_WINDOW_UNMEASURED_PAINT_LIMIT = 2

export type ConversationRunWindow = {
  end: number
  leading: number
  start: number
  trailing: number
}

export type ConversationPaintedRun<T> = {
  run: T
  runIndex: number
}

export function conversationRunHeightEstimate(
  measured: Readonly<Record<string, number>>,
  fallback = CONVERSATION_RUN_DEFAULT_HEIGHT
): number {
  const samples = Object.values(measured).filter((height) => height > 0)
  if (!samples.length) return fallback
  const ranked = [...samples].sort((left, right) => left - right)
  return ranked[Math.floor(ranked.length / 2)] ?? fallback
}

export function nextConversationRunHeight(
  previous: number | undefined,
  next: number,
  options?: { allowShrink?: boolean }
): number | undefined {
  const height = Math.round(next)
  if (height <= 0 || previous === height) return undefined
  if (options?.allowShrink === false && previous && height < previous) return undefined
  return height
}

export function conversationRunHeights(
  ids: readonly string[],
  measured: Readonly<Record<string, number>>,
  fallback = CONVERSATION_RUN_DEFAULT_HEIGHT
): number[] {
  const estimate = conversationRunHeightEstimate(measured, fallback)
  return ids.map((id) => {
    const height = measured[id]
    return typeof height === 'number' && height > 0 ? height : estimate
  })
}

export function conversationRunAlwaysIndexes(
  runs: readonly { id: string; prompt?: { id?: string } }[],
  alwaysIds: readonly (string | null | undefined)[]
): number[] {
  const wanted = new Set(alwaysIds.filter((id): id is string => Boolean(id)))
  if (!wanted.size) return []
  const indexes: number[] = []
  runs.forEach((run, index) => {
    if (wanted.has(run.id) || (run.prompt?.id && wanted.has(run.prompt.id))) {
      indexes.push(index)
    }
  })
  return indexes
}

export function conversationWindowFollowsLatest(
  heights: readonly number[],
  scrollTop: number,
  viewportHeight: number
): boolean {
  if (viewportHeight <= 0) return true
  const total = heights.reduce((sum, height) => sum + height, 0)
  const lastHeight = heights.at(-1) ?? 0
  return scrollTop + viewportHeight >= total - lastHeight - 48
}

export function conversationRunWindow(
  heights: readonly number[],
  options: {
    alwaysIndexes?: readonly number[]
    live?: boolean
    overscan?: number
    scrollTop: number
    viewportHeight: number
  }
): ConversationRunWindow {
  const count = heights.length
  if (count === 0) return { end: 0, leading: 0, start: 0, trailing: 0 }

  const total = heights.reduce((sum, height) => sum + height, 0)
  const viewport = Math.max(0, options.viewportHeight)
  const lastHeight = heights.at(-1) ?? 0
  if (options.live) {
    if (count <= CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT) {
      return { end: count, leading: 0, start: 0, trailing: 0 }
    }
    const start = Math.max(0, count - CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT)
    let leading = 0
    for (let index = 0; index < start; index += 1) leading += heights[index] ?? 0
    return { end: count, leading, start, trailing: 0 }
  }
  if (viewport <= 0) {
    const start = Math.max(0, count - CONVERSATION_WINDOW_UNMEASURED_PAINT_LIMIT)
    let leading = 0
    for (let index = 0; index < start; index += 1) leading += heights[index] ?? 0
    return { end: count, leading, start, trailing: 0 }
  }
  if (count <= CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT) {
    return { end: count, leading: 0, start: 0, trailing: 0 }
  }
  if (total <= viewport + lastHeight) {
    return { end: count, leading: 0, start: 0, trailing: 0 }
  }

  const overscan = options.overscan ?? CONVERSATION_RUN_OVERSCAN
  const overscanPx = overscan * CONVERSATION_RUN_DEFAULT_HEIGHT
  const scrollTop = Math.max(0, options.scrollTop)
  const viewStart = Math.max(0, scrollTop - overscanPx)
  const viewEnd = scrollTop + viewport + overscanPx

  let prefix = 0
  let start = 0
  let end = count
  let foundStart = false
  for (let index = 0; index < count; index += 1) {
    const next = prefix + (heights[index] ?? 0)
    if (!foundStart && next > viewStart) {
      start = index
      foundStart = true
    }
    if (foundStart && prefix >= viewEnd) {
      end = index
      break
    }
    prefix = next
  }
  if (!foundStart) start = Math.max(0, count - 1)

  for (const index of options.alwaysIndexes ?? []) {
    if (index < 0 || index >= count) continue
    start = Math.min(start, index)
    end = Math.max(end, index + 1)
  }

  let leading = 0
  for (let index = 0; index < start; index += 1) leading += heights[index] ?? 0
  let trailing = 0
  for (let index = end; index < count; index += 1) trailing += heights[index] ?? 0
  return { end, leading, start, trailing }
}

export function conversationPaintedRuns<T>(
  runs: readonly T[],
  window: Pick<ConversationRunWindow, 'end' | 'start'>
): ConversationPaintedRun<T>[] {
  return runs.slice(window.start, window.end).map((run, offset) => ({
    run,
    runIndex: window.start + offset
  }))
}
