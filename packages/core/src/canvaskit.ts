/// <reference types="vite/client" />
import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm'

import { resolveBrowserAssetPath } from './browser-assets'
import { IS_BROWSER } from './constants'

let instance: CanvasKit | null = null

export interface CanvasKitOptions {
  locateFile?: (file: string) => string
}

export async function getCanvasKit(options?: CanvasKitOptions): Promise<CanvasKit> {
  if (instance) return instance

  const defaultLocate = (file: string) => {
    if (!IS_BROWSER) {
      const ckPath = import.meta.resolve('canvaskit-wasm')
      return decodeURIComponent(new URL(file, ckPath).pathname)
    }
    const pathname = typeof window === 'undefined' ? '' : window.location.pathname
    return resolveBrowserAssetPath(file, import.meta.env.BASE_URL || '/', pathname)
  }

  instance = await CanvasKitInit({
    locateFile: options?.locateFile ?? defaultLocate
  })

  return instance
}
