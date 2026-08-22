import {
  DOUBLE_CLICK_FOCUS_MAX_ZOOM,
  DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
} from '@open-pencil/core/constants'

import type { EditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'

export function focusCanvasSurface(store: EditorStore, nodeId: string): boolean {
  return store.zoomToNode(nodeId, editorViewportInsets(), {
    maxZoom: DOUBLE_CLICK_FOCUS_MAX_ZOOM,
    zoomMultiplier: DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
  })
}
