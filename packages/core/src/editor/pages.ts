import type { Color } from '@open-pencil/scene-graph/primitives'

import { populateLazyFigImportRoots } from '#core/kiwi/fig/lazy-import'
import { computeAllLayouts } from '#core/layout'
import { fontManager } from '#core/text/fonts'

import { createPageViewportStore } from './page-viewports'
import type { EditorContext } from './types'
import type { ViewportInsets } from './viewport'

export interface PageSwitchOptions {
  fitNodeIdOnFirstVisit?: string
  fitOnFirstVisit?: boolean
  viewportInsets?: ViewportInsets
}

interface PageViewportActions {
  zoomToFit(insets?: ViewportInsets): void
  zoomToNode(nodeId: string, insets?: ViewportInsets): boolean
}

export function createPageActions(ctx: EditorContext, viewportActions: PageViewportActions) {
  const pageViewportStore = createPageViewportStore(ctx)

  async function switchPage(pageId: string, options: PageSwitchOptions = {}) {
    const page = ctx.graph.getNode(pageId)
    if (page?.type !== 'CANVAS') return

    pageViewportStore.saveCurrentPageViewport(options.viewportInsets)

    const previousPageId = ctx.state.currentPageId
    ctx.state.currentPageId = pageId
    ctx.state.enteredContainerId = null
    ctx.setSelectedIds(new Set())
    if (previousPageId !== pageId) ctx.emitEditorEvent('page:changed', pageId, previousPageId)

    const restoredViewport = pageViewportStore.restorePageViewport(pageId, options.viewportInsets)
    const fitFirstVisit = () => {
      if (restoredViewport || !options.fitOnFirstVisit) return
      const fittedNode = options.fitNodeIdOnFirstVisit
        ? viewportActions.zoomToNode(options.fitNodeIdOnFirstVisit, options.viewportInsets)
        : false
      if (!fittedNode) viewportActions.zoomToFit(options.viewportInsets)
    }

    // Establish the destination camera before fonts or live content can make the
    // new page briefly render at its raw 100% position.
    fitFirstVisit()

    const populated = populateLazyFigImportRoots(ctx.graph, [pageId])

    const toLoad = fontManager.collectFontKeys(
      ctx.graph,
      ctx.graph.getChildren(pageId).map((n) => n.id)
    )
    if (toLoad.length > 0) {
      await Promise.all(toLoad.map(([family, style]) => ctx.loadFont(family, style)))
    }
    if (ctx.getRenderer() || populated) {
      computeAllLayouts(ctx.graph, pageId)
    }
    // Refine once layout has settled without changing the first-visit target.
    fitFirstVisit()
    ctx.requestRender()
  }

  function addPage(name?: string) {
    const pages = ctx.graph.getPages()
    const pageName = name ?? `Page ${pages.length + 1}`
    const page = ctx.graph.addPage(pageName)
    void switchPage(page.id)
    return page.id
  }

  function deletePage(pageId: string) {
    const pages = ctx.graph.getPages()
    if (pages.length <= 1) return
    const idx = pages.findIndex((p) => p.id === pageId)
    ctx.graph.deleteNode(pageId)
    pageViewportStore.deletePageViewport(pageId)
    if (ctx.state.currentPageId === pageId) {
      const newIdx = Math.min(idx, pages.length - 2)
      const remaining = ctx.graph.getPages()
      void switchPage(remaining[newIdx].id)
    }
  }

  function movePage(pageId: string, index: number) {
    const pages = ctx.graph.getPages()
    const currentIndex = pages.findIndex((page) => page.id === pageId)
    if (currentIndex === -1) return

    const nextIndex = Math.max(0, Math.min(index, pages.length - 1))
    if (nextIndex === currentIndex) return

    ctx.graph.insertChildAt(pageId, ctx.graph.rootId, nextIndex)
  }

  function renamePage(pageId: string, name: string) {
    ctx.graph.updateNode(pageId, { name })
  }

  function setPageColor(color: Color) {
    ctx.state.pageColor = color
    ctx.requestRender()
  }

  return {
    switchPage,
    addPage,
    deletePage,
    movePage,
    renamePage,
    setPageColor,
    clearPageViewports: pageViewportStore.clearPageViewports
  }
}
