import type { ViewportInsets } from '@open-pencil/core/editor'

import type { EditorStore } from '@/app/editor/session'

export type BoardObjectNavigationStore = Pick<
  EditorStore,
  'graph' | 'requestOverlayRepaint' | 'revealNode' | 'select' | 'switchPage'
> & { state: Pick<EditorStore['state'], 'currentPageId'> }

export function boardObjectPageId(
  store: Pick<EditorStore, 'graph'>,
  objectId: string,
  requestedPageId?: string
): string | undefined {
  if (requestedPageId && store.graph.getNode(requestedPageId)?.type === 'CANVAS') {
    return requestedPageId
  }
  let node = store.graph.getNode(objectId)
  while (node?.parentId) {
    const parent = store.graph.getNode(node.parentId)
    if (parent?.type === 'CANVAS') return parent.id
    node = parent
  }
  return undefined
}

export async function revealBoardObject(
  store: BoardObjectNavigationStore,
  objectId: string,
  options: {
    pageId?: string
    schedule?: (callback: () => void) => void
    viewportInsets: () => ViewportInsets
  }
): Promise<boolean> {
  if (!store.graph.getNode(objectId)) return false
  const targetPageId = boardObjectPageId(store, objectId, options.pageId)
  if (targetPageId && targetPageId !== store.state.currentPageId) {
    await store.switchPage(targetPageId, {
      fitOnFirstVisit: true,
      viewportInsets: options.viewportInsets()
    })
  }
  if (!store.graph.getNode(objectId)) return false
  store.select([objectId])
  const schedule = options.schedule ?? requestAnimationFrame
  schedule(() => {
    store.revealNode(objectId, options.viewportInsets())
    store.requestOverlayRepaint()
  })
  return true
}
