import type { CanvasKit, Surface } from 'canvaskit-wasm'

import { IS_BROWSER } from '@open-pencil/core/constants'
import type { Editor } from '@open-pencil/core/editor'

import type { UseCanvasOptions } from '#vue/canvas/surface/types'

type GLContext = ReturnType<CanvasKit['MakeGrContext']>

export type CanvasGLContext = GLContext

export type CanvasBackingSize = {
  dpr: number
  height: number
  width: number
}

export function canvasPixelRatio(
  maxDevicePixelRatio?: number,
  devicePixelRatio = IS_BROWSER ? window.devicePixelRatio || 1 : 1
): number {
  const dpr = devicePixelRatio || 1
  if (!maxDevicePixelRatio || maxDevicePixelRatio <= 0) return dpr
  return Math.min(dpr, maxDevicePixelRatio)
}

export function canvasBackingSize(
  clientWidth: number,
  clientHeight: number,
  maxDevicePixelRatio?: number,
  devicePixelRatio?: number
): CanvasBackingSize {
  const dpr = canvasPixelRatio(maxDevicePixelRatio, devicePixelRatio)
  return {
    dpr,
    height: Math.max(1, Math.floor(clientHeight * dpr)),
    width: Math.max(1, Math.floor(clientWidth * dpr))
  }
}

export function sizeCanvas(
  canvas: HTMLCanvasElement,
  editor: Editor,
  options?: Pick<UseCanvasOptions, 'maxDevicePixelRatio'>
): CanvasBackingSize {
  const backing = canvasBackingSize(
    canvas.clientWidth,
    canvas.clientHeight,
    options?.maxDevicePixelRatio
  )
  canvas.width = backing.width
  canvas.height = backing.height
  if ('setViewportSize' in editor && typeof editor.setViewportSize === 'function') {
    editor.setViewportSize(canvas.clientWidth, canvas.clientHeight)
  }
  return backing
}

export function makeGLSurface(
  ck: CanvasKit,
  canvas: HTMLCanvasElement,
  editor: Editor,
  options: UseCanvasOptions | undefined,
  glContext: GLContext | null
): { surface: Surface | null; glContext: GLContext | null } {
  let context = glContext
  if (!context) {
    const glAttrs = options?.preserveDrawingBuffer ? { preserveDrawingBuffer: 1 } : undefined
    const handle = ck.GetWebGLContext(canvas, glAttrs)
    if (!handle) return { surface: null, glContext: context }
    context = ck.MakeGrContext(handle)
  }
  if (!context) return { surface: null, glContext: context }

  const preferredSpace = editor.graph.documentColorSpace
  const colorSpaces =
    preferredSpace === 'display-p3'
      ? [ck.ColorSpace.DISPLAY_P3, ck.ColorSpace.SRGB]
      : [ck.ColorSpace.SRGB]

  for (const colorSpace of colorSpaces) {
    const surface = ck.MakeOnScreenGLSurface(context, canvas.width, canvas.height, colorSpace)
    if (surface) return { surface, glContext: context }
  }

  return { surface: null, glContext: context }
}
