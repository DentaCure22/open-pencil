import type { Rect } from '@open-pencil/scene-graph/primitives'
import type { SnapGuide } from '@open-pencil/scene-graph/snap'

import { isCodeObjectKind } from '#core/code-object/document'
import type { EditorContext } from '#core/editor/types'

function paintsCanvasHoverChrome(ctx: EditorContext, id: string | null) {
  if (!id) return false
  return !isCodeObjectKind(ctx.graph.getNode(id))
}

export function createSelectionOverlayActions(ctx: EditorContext) {
  function setMarquee(rect: Rect | null) {
    ctx.state.marquee = rect
    ctx.requestOverlayRepaint()
  }

  function setSnapGuides(guides: SnapGuide[]) {
    ctx.state.snapGuides = guides
    ctx.requestOverlayRepaint()
  }

  function setRotationPreview(preview: { nodeId: string; angle: number } | null) {
    ctx.state.rotationPreview = preview
    ctx.requestRepaint()
  }

  function setHoveredNode(id: string | null) {
    if (ctx.state.hoveredNodeId === id) return
    const previous = ctx.state.hoveredNodeId
    ctx.state.hoveredNodeId = id
    ctx.emitEditorEvent('hover:changed', id, previous)
    if (paintsCanvasHoverChrome(ctx, previous) || paintsCanvasHoverChrome(ctx, id)) {
      ctx.requestOverlayRepaint()
    }
  }

  function setDropTarget(id: string | null) {
    if (ctx.state.dropTargetId === id) return
    ctx.state.dropTargetId = id
    ctx.requestRepaint()
  }

  function setLayoutInsertIndicator(indicator: typeof ctx.state.layoutInsertIndicator) {
    if (ctx.state.layoutInsertIndicator === indicator) return
    ctx.state.layoutInsertIndicator = indicator
    ctx.requestOverlayRepaint()
  }

  function setAutoLayoutHover(hover: typeof ctx.state.autoLayoutHover) {
    const current = ctx.state.autoLayoutHover
    if (
      current?.nodeId === hover?.nodeId &&
      current?.kind === hover?.kind &&
      current?.index === hover?.index &&
      current?.side === hover?.side
    ) {
      return
    }
    ctx.state.autoLayoutHover = hover
    ctx.requestOverlayRepaint()
  }

  return {
    setMarquee,
    setSnapGuides,
    setRotationPreview,
    setHoveredNode,
    setDropTarget,
    setLayoutInsertIndicator,
    setAutoLayoutHover
  }
}
