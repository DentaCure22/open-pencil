import type { CanvasKit } from 'canvaskit-wasm'
import { onMounted, onScopeDispose } from 'vue'
import type { Ref } from 'vue'

import { getCanvasKit } from '@open-pencil/core/canvaskit'

type CanvasKitLoaderOptions = {
  canvasRef: Ref<HTMLCanvasElement | null>
  lifecycle: { destroyed: boolean }
  setCanvasKit: (ck: CanvasKit | null) => void
  createSurface: (canvas: HTMLCanvasElement) => void
  loadFonts: () => Promise<unknown> | undefined
  renderNow: () => void
  onReady?: () => void
}

export function useCanvasKitLoader({
  canvasRef,
  lifecycle,
  setCanvasKit,
  createSurface,
  loadFonts,
  renderNow,
  onReady
}: CanvasKitLoaderOptions) {
  const isDestroyed = () => lifecycle.destroyed

  async function init() {
    const canvas = canvasRef.value
    if (!canvas || isDestroyed()) return

    try {
      setCanvasKit(await getCanvasKit())
      if (isDestroyed()) return

      await new Promise((resolve) => {
        requestAnimationFrame(resolve)
      })
      createSurface(canvas)
      try {
        await loadFonts()
      } catch (err) {
        console.warn('[canvas] loadFonts failed', err)
      }
      if (isDestroyed()) return
      renderNow()
    } catch (err) {
      console.error('[canvas] CanvasKit init failed', err)
    } finally {
      // Always dismiss global loader so a hung font/wasm fetch cannot trap the UI.
      if (!isDestroyed()) onReady?.()
    }
  }

  onMounted(() => {
    void init()
  })

  onScopeDispose(() => {
    lifecycle.destroyed = true
  })
}
