import {
  DOUBLE_CLICK_FOCUS_MAX_ZOOM,
  DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
} from '@open-pencil/core/constants'

import { focusCanvasSurface } from '@/app/editor/canvas/surface/focus'
import type { EditorStore } from '@/app/editor/session'
import { editorViewportInsets } from '@/app/editor/viewport-insets'

import type { LocalWorkspaceNavigationIntent } from './client'

const DOUBLE_CLICK_FOCUS = {
  maxZoom: DOUBLE_CLICK_FOCUS_MAX_ZOOM,
  zoomMultiplier: DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
}

export function revealLocalWorkspaceNavigationTargets(
  store: EditorStore,
  intent: Pick<LocalWorkspaceNavigationIntent, 'objectIds' | 'pageId' | 'region'>
): boolean {
  const insets = editorViewportInsets()
  if (intent.region) {
    store.zoomToBounds(
      intent.region.x,
      intent.region.y,
      intent.region.x + intent.region.width,
      intent.region.y + intent.region.height,
      insets,
      DOUBLE_CLICK_FOCUS
    )
    return true
  }
  const ids = (intent.objectIds ?? []).filter((id) => {
    const node = store.graph.getNode(id)
    return Boolean(node) && store.graph.isDescendant(id, intent.pageId)
  })
  if (ids.length === 0) return false
  store.select(ids)
  if (ids.length === 1) return focusCanvasSurface(store, ids[0])
  store.zoomToSelection(insets)
  return true
}
