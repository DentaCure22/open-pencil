/**
 * Live board updates during Vite HMR — never reloads the browser tab.
 *
 * Updates only foundations board nodes in the existing SceneGraph, keeps
 * pan/zoom, and never calls replaceGraph / location.reload.
 */
import type { EditorStore } from '@/app/editor/session'

import { yieldAnimationFrames } from '../yield-frames'

type ReseedOptions = {
  selectedPageId?: string
  reason?: string
}

let reseedChain: Promise<void> = Promise.resolve()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingOptions: ReseedOptions | null = null

/** Coalesce rapid HMR saves into one quiet in-place update. */
export function scheduleSmylrLiveReseed(
  getStore: () => EditorStore,
  options: ReseedOptions = {}
): void {
  pendingOptions = { ...pendingOptions, ...options }
  if (debounceTimer != null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const opts = pendingOptions ?? {}
    pendingOptions = null
    reseedChain = reseedChain
      .then(() => runReseed(getStore, opts))
      .catch((err) => {
        console.error('[Smylr live reseed]', err)
      })
  }, 350)
}

async function runReseed(getStore: () => EditorStore, options: ReseedOptions): Promise<void> {
  await yieldAnimationFrames(2)
  await new Promise<void>((r) => setTimeout(r, 50))

  const store = getStore()
  if (!store?.graph) return

  const { hasSmylrProductionWorkspace, refreshSmylrFoundationsBoardsInPlace } =
    await import('../workspace')

  if (!hasSmylrProductionWorkspace(store)) {
    // Do not full-open from HMR (that replaceGraphs the whole doc).
    // User can load with ?smylr-app= once; later edits stay in-place.
    console.info('[Smylr live reseed] skip — no workspace yet (open ?smylr-app= once)')
    return
  }

  try {
    const ok = await refreshSmylrFoundationsBoardsInPlace(store, {
      selectedPageId: options.selectedPageId,
      preserveViewport: true
    })
    if (import.meta.env?.DEV) {
      console.info(
        ok
          ? `[Smylr live] boards updated${options.reason ? ` · ${options.reason}` : ''} · camera kept`
          : '[Smylr live] no foundations page to update'
      )
    }
  } catch (err) {
    console.error('[Smylr live] update failed (left previous boards)', err)
  }
}
