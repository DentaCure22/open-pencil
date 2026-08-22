import { computed, type ComputedRef, type Ref } from 'vue'

import type { Vector } from '@open-pencil/scene-graph/primitives'

type CanvasVirtualReference = {
  getBoundingClientRect: () => DOMRect
}

export type CanvasPresentationViewport = Readonly<{
  panX: number
  panY: number
  zoom: number
}>

export function useCanvasVirtualReference(
  canvasRef: Ref<HTMLElement | null>,
  anchor: ComputedRef<Vector | null>,
  viewport: Readonly<Ref<CanvasPresentationViewport>>
) {
  return computed<CanvasVirtualReference | null>(() => {
    const point = anchor.value
    const canvas = canvasRef.value
    if (!point || !canvas) return null

    const { panX, panY, zoom } = viewport.value

    return {
      getBoundingClientRect() {
        const rect = canvas.getBoundingClientRect()
        const x = rect.left + point.x * zoom + panX
        const y = rect.top + point.y * zoom + panY
        return new DOMRect(x, y, 0, 0)
      }
    }
  })
}
