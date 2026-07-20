import { computeBounds, computeAbsoluteBounds } from '@open-pencil/scene-graph/geometry'

import { ZOOM_DIVISOR, ZOOM_SCALE_MAX, ZOOM_SCALE_MIN } from '#core/constants'

import type { EditorContext } from './types'

export interface ViewportInsets {
  bottom?: number
  left?: number
  right?: number
  top?: number
}

export interface ResolvedViewportArea {
  centerX: number
  centerY: number
  height: number
  width: number
}

export function resolveViewportArea(
  viewW: number,
  viewH: number,
  insets: ViewportInsets = {}
): ResolvedViewportArea {
  const left = Math.max(0, insets.left ?? 0)
  const right = Math.max(0, insets.right ?? 0)
  const top = Math.max(0, insets.top ?? 0)
  const bottom = Math.max(0, insets.bottom ?? 0)
  const width = Math.max(1, viewW - left - right)
  const height = Math.max(1, viewH - top - bottom)

  return {
    centerX: left + width / 2,
    centerY: top + height / 2,
    height,
    width
  }
}

export function createViewportActions(ctx: EditorContext) {
  function currentViewport() {
    return { panX: ctx.state.panX, panY: ctx.state.panY, zoom: ctx.state.zoom }
  }

  function emitViewportChanged(previous: ReturnType<typeof currentViewport>) {
    const next = currentViewport()
    if (next.panX !== previous.panX || next.panY !== previous.panY || next.zoom !== previous.zoom) {
      ctx.emitEditorEvent('viewport:changed', next, previous)
    }
  }

  function screenToCanvas(sx: number, sy: number) {
    return {
      x: (sx - ctx.state.panX) / ctx.state.zoom,
      y: (sy - ctx.state.panY) / ctx.state.zoom
    }
  }

  function setZoomAroundPoint(level: number, centerX: number, centerY: number) {
    const previous = currentViewport()
    const newZoom = Math.max(0.02, Math.min(256, level))
    ctx.state.panX = centerX - (centerX - ctx.state.panX) * (newZoom / ctx.state.zoom)
    ctx.state.panY = centerY - (centerY - ctx.state.panY) * (newZoom / ctx.state.zoom)
    ctx.state.zoom = newZoom
    ctx.requestRepaint()
    emitViewportChanged(previous)
  }

  function applyZoom(delta: number, centerX: number, centerY: number) {
    const factor = Math.min(
      ZOOM_SCALE_MAX,
      Math.max(ZOOM_SCALE_MIN, Math.exp(-delta / ZOOM_DIVISOR))
    )
    setZoomAroundPoint(ctx.state.zoom * factor, centerX, centerY)
  }

  function pan(dx: number, dy: number) {
    const previous = currentViewport()
    ctx.state.panX += dx
    ctx.state.panY += dy
    ctx.requestRepaint()
    emitViewportChanged(previous)
  }

  function zoomToBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    insets: ViewportInsets = {}
  ) {
    const previous = currentViewport()
    const padding = 80
    const w = maxX - minX + padding * 2
    const h = maxY - minY + padding * 2

    const { width: viewW, height: viewH } = ctx.getViewportSize()
    const area = resolveViewportArea(viewW, viewH, insets)
    const zoom = Math.min(area.width / w, area.height / h, 1)
    const boundsCenterX = (minX + maxX) / 2
    const boundsCenterY = (minY + maxY) / 2

    ctx.state.zoom = zoom
    ctx.state.panX = area.centerX - boundsCenterX * zoom
    ctx.state.panY = area.centerY - boundsCenterY * zoom
    ctx.requestRepaint()
    emitViewportChanged(previous)
  }

  function zoomToFit(insets?: ViewportInsets) {
    const nodes = ctx.graph.getChildren(ctx.state.currentPageId)
    if (nodes.length === 0) return

    const b = computeBounds(nodes)
    zoomToBounds(b.x, b.y, b.x + b.width, b.y + b.height, insets)
  }

  function zoomToNode(nodeId: string, insets?: ViewportInsets): boolean {
    const node = ctx.graph.getNode(nodeId)
    if (!node) return false

    const b = computeAbsoluteBounds([node], (id) => ctx.graph.getAbsolutePosition(id))
    zoomToBounds(b.x, b.y, b.x + b.width, b.y + b.height, insets)
    return true
  }

  function zoomToLevel(level: number) {
    const { width: viewW, height: viewH } = ctx.getViewportSize()
    const centerX = (-ctx.state.panX + viewW / 2) / ctx.state.zoom
    const centerY = (-ctx.state.panY + viewH / 2) / ctx.state.zoom

    const previous = currentViewport()
    ctx.state.zoom = Math.max(0.02, Math.min(256, level))
    ctx.state.panX = viewW / 2 - centerX
    ctx.state.panY = viewH / 2 - centerY
    ctx.requestRepaint()
    emitViewportChanged(previous)
  }

  function zoomTo100() {
    zoomToLevel(1)
  }

  function zoomToSelection(insets?: ViewportInsets) {
    if (ctx.state.selectedIds.size === 0) return

    const nodes = [...ctx.state.selectedIds]
      .map((id) => ctx.graph.getNode(id))
      .filter((n): n is NonNullable<typeof n> => n != null)
    if (nodes.length === 0) return

    const b = computeAbsoluteBounds(nodes, (id) => ctx.graph.getAbsolutePosition(id))
    zoomToBounds(b.x, b.y, b.x + b.width, b.y + b.height, insets)
  }

  return {
    screenToCanvas,
    setZoomAroundPoint,
    applyZoom,
    pan,
    zoomToBounds,
    zoomToFit,
    zoomToNode,
    zoomTo100,
    zoomToLevel,
    zoomToSelection
  }
}
