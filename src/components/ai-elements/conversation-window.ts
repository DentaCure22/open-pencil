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

function sumRunHeights(heights: readonly number[], start = 0, end = heights.length): number {
  let total = 0
  for (let index = start; index < end; index += 1) total += heights[index] ?? 0
  return total
}

function completeRunWindow(count: number): ConversationRunWindow {
  return { end: count, leading: 0, start: 0, trailing: 0 }
}

function trailingRunWindow(heights: readonly number[], limit: number): ConversationRunWindow {
  const end = heights.length
  const start = Math.max(0, end - limit)
  return { end, leading: sumRunHeights(heights, 0, start), start, trailing: 0 }
}

function visibleRunRange(
  heights: readonly number[],
  viewStart: number,
  viewEnd: number
): Pick<ConversationRunWindow, 'end' | 'start'> {
  let prefix = 0
  let start = 0
  let end = heights.length
  let foundStart = false
  for (let index = 0; index < heights.length; index += 1) {
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
  return { end, start: foundStart ? start : Math.max(0, heights.length - 1) }
}

function includeAlwaysPaintedRuns(
  range: Pick<ConversationRunWindow, 'end' | 'start'>,
  count: number,
  indexes: readonly number[]
): Pick<ConversationRunWindow, 'end' | 'start'> {
  let { end, start } = range
  for (const index of indexes) {
    if (index < 0 || index >= count) continue
    start = Math.min(start, index)
    end = Math.max(end, index + 1)
  }
  return { end, start }
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

  const viewport = Math.max(0, options.viewportHeight)
  if (options.live) {
    return count <= CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT
      ? completeRunWindow(count)
      : trailingRunWindow(heights, CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT)
  }
  if (viewport <= 0) {
    return trailingRunWindow(heights, CONVERSATION_WINDOW_UNMEASURED_PAINT_LIMIT)
  }
  const total = sumRunHeights(heights)
  if (
    count <= CONVERSATION_WINDOW_ALWAYS_PAINT_LIMIT ||
    total <= viewport + (heights.at(-1) ?? 0)
  ) {
    return completeRunWindow(count)
  }

  const overscan = options.overscan ?? CONVERSATION_RUN_OVERSCAN
  const overscanPx = overscan * CONVERSATION_RUN_DEFAULT_HEIGHT
  const scrollTop = Math.max(0, options.scrollTop)
  const viewStart = Math.max(0, scrollTop - overscanPx)
  const viewEnd = scrollTop + viewport + overscanPx

  const { end, start } = includeAlwaysPaintedRuns(
    visibleRunRange(heights, viewStart, viewEnd),
    count,
    options.alwaysIndexes ?? []
  )
  return {
    end,
    leading: sumRunHeights(heights, 0, start),
    start,
    trailing: sumRunHeights(heights, end)
  }
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
