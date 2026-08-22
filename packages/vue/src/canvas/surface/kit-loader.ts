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
  onError?: (error: unknown) => void
  onReady?: () => void
}

export function useCanvasKitLoader({
  canvasRef,
  lifecycle,
  setCanvasKit,
  createSurface,
  loadFonts,
  renderNow,
  onError,
  onReady
}: CanvasKitLoaderOptions) {
  const isDestroyed = () => lifecycle.destroyed
  let initialization: Promise<void> | null = null

  async function initialize() {
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
      onReady?.()
    } catch (err) {
      console.error('[canvas] CanvasKit init failed', err)
      if (!isDestroyed()) onError?.(err)
    }
  }

  function init() {
    if (initialization) return initialization
    initialization = initialize().finally(() => {
      initialization = null
    })
    return initialization
  }

  onMounted(() => {
    void init()
  })

  onScopeDispose(() => {
    lifecycle.destroyed = true
  })

  return { retry: init }
}
