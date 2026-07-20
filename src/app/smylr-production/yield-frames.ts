const DEFAULT_FRAME_FALLBACK_MS = 100

/** Wait for paint when available without hanging work in a backgrounded browser tab. */
export function yieldAnimationFrames(
  count = 2,
  fallbackMs = DEFAULT_FRAME_FALLBACK_MS
): Promise<void> {
  if (count <= 0 || typeof requestAnimationFrame !== 'function') return Promise.resolve()
  return new Promise((resolve) => {
    let left = count
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(fallback)
      resolve()
    }
    const fallback = setTimeout(done, fallbackMs)
    const tick = () => {
      if (settled) return
      left -= 1
      if (left <= 0) done()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
