import type { Color } from '@open-pencil/scene-graph/primitives'

import { getDefaultCanvasBgColor } from '#core/constants'

import type { EditorContext } from './types'
import { resolveViewportArea, type ViewportInsets } from './viewport'

interface PageViewport {
  focusX: number
  focusY: number
  pageColor: Color
  zoom: number
}

export function createPageViewportStore(ctx: EditorContext) {
  const pageViewports = new Map<string, PageViewport>()

  function viewportCenter(insets?: ViewportInsets) {
    const { width, height } = ctx.getViewportSize()
    const area = resolveViewportArea(width, height, insets)
    return { x: area.centerX, y: area.centerY }
  }

  function saveCurrentPageViewport(insets?: ViewportInsets) {
    const center = viewportCenter(insets)
    pageViewports.set(ctx.state.currentPageId, {
      focusX: (center.x - ctx.state.panX) / ctx.state.zoom,
      focusY: (center.y - ctx.state.panY) / ctx.state.zoom,
      pageColor: { ...ctx.state.pageColor },
      zoom: ctx.state.zoom
    })
  }

  function restorePageViewport(pageId: string, insets?: ViewportInsets): boolean {
    const viewport = pageViewports.get(pageId)
    if (viewport) {
      const center = viewportCenter(insets)
      ctx.state.panX = center.x - viewport.focusX * viewport.zoom
      ctx.state.panY = center.y - viewport.focusY * viewport.zoom
      ctx.state.zoom = viewport.zoom
      ctx.state.pageColor = { ...viewport.pageColor }
      return true
    }

    ctx.state.panX = 0
    ctx.state.panY = 0
    ctx.state.zoom = 1
    ctx.state.pageColor = { ...getDefaultCanvasBgColor() }
    return false
  }

  function deletePageViewport(pageId: string) {
    pageViewports.delete(pageId)
  }

  function clearPageViewports() {
    pageViewports.clear()
  }

  return { saveCurrentPageViewport, restorePageViewport, deletePageViewport, clearPageViewports }
}
