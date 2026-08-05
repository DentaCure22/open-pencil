import type { SceneNode } from '@open-pencil/scene-graph'

import { isMermaidDiagramContainer } from '#core/diagram'
import type { EditorContext } from '#core/editor/types'

const MERMAID_FRAME_HIT_TEST = { isBoundsHitTarget: isMermaidDiagramContainer }

export function createSelectionHitTestActions(
  ctx: EditorContext,
  select: (ids: string[], additive?: boolean) => void,
  clearSelection: () => void
) {
  function hitTestAtPoint(cx: number, cy: number, deep = false): SceneNode | null {
    const renderer = ctx.getRenderer()
    if (!renderer) return null
    const scopeId = ctx.state.enteredContainerId
    if (scopeId) {
      const scopeNode = ctx.graph.getNode(scopeId)
      if (!scopeNode) {
        ctx.state.enteredContainerId = null
      } else {
        return deep
          ? ctx.graph.hitTestDeep(cx, cy, scopeId, MERMAID_FRAME_HIT_TEST)
          : ctx.graph.hitTest(cx, cy, scopeId, MERMAID_FRAME_HIT_TEST)
      }
    }
    return deep
      ? ctx.graph.hitTestDeep(cx, cy, ctx.state.currentPageId, MERMAID_FRAME_HIT_TEST)
      : ctx.graph.hitTest(cx, cy, ctx.state.currentPageId, MERMAID_FRAME_HIT_TEST)
  }

  function selectAtPoint(cx: number, cy: number) {
    const hit = hitTestAtPoint(cx, cy)
    if (hit) {
      if (!ctx.state.selectedIds.has(hit.id)) select([hit.id])
    } else {
      clearSelection()
    }
  }

  return { hitTestAtPoint, selectAtPoint }
}
