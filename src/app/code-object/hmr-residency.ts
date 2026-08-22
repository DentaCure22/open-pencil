import { IS_BROWSER } from '@/constants'

let hotUpdateInProgress = false
let resetTimer: number | null = null
const HOT_UPDATE_RESIDENCY_MS = 250

function clearResetTimer() {
  if (resetTimer === null || !IS_BROWSER) return
  window.clearTimeout(resetTimer)
  resetTimer = null
}

function beginHotUpdate() {
  clearResetTimer()
  hotUpdateInProgress = true
}

function finishHotUpdate() {
  clearResetTimer()
  if (!IS_BROWSER) {
    hotUpdateInProgress = false
    return
  }
  // Vue can flush a parent component replacement after Vite's update callback.
  // Keep the residency window open long enough for that queued replacement.
  resetTimer = window.setTimeout(() => {
    resetTimer = null
    hotUpdateInProgress = false
  }, HOT_UPDATE_RESIDENCY_MS)
}

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', beginHotUpdate)
  import.meta.hot.on('vite:afterUpdate', finishHotUpdate)
  import.meta.hot.on('vite:error', finishHotUpdate)
  import.meta.hot.on('vite:beforeFullReload', () => {
    clearResetTimer()
    hotUpdateInProgress = false
  })
}

export function preserveCodeObjectRuntimeDuringHotUpdate(): boolean {
  return hotUpdateInProgress
}
