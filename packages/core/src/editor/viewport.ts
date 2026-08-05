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

export interface ZoomToBoundsOptions {
  maxZoom?: number
  zoomMultiplier?: number
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

  function setViewport(viewport: { panX: number; panY: number; zoom: number }) {
    const previous = currentViewport()
    ctx.state.panX = viewport.panX
    ctx.state.panY = viewport.panY
    ctx.state.zoom = Math.max(0.02, Math.min(256, viewport.zoom))
    ctx.requestRepaint()
    emitViewportChanged(previous)
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
    insets: ViewportInsets = {},
    options: ZoomToBoundsOptions = {}
  ) {
    const previous = currentViewport()
    const padding = 80
    const w = maxX - minX + padding * 2
    const h = maxY - minY + padding * 2

    const { width: viewW, height: viewH } = ctx.getViewportSize()
    const area = resolveViewportArea(viewW, viewH, insets)
    const zoom = Math.min(
      (area.width / w) * (options.zoomMultiplier ?? 1),
      (area.height / h) * (options.zoomMultiplier ?? 1),
      options.maxZoom ?? 1
    )
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

  function zoomToNode(
    nodeId: string,
    insets?: ViewportInsets,
    options: ZoomToBoundsOptions = {}
  ): boolean {
    const node = ctx.graph.getNode(nodeId)
    if (!node) return false

    const b = computeAbsoluteBounds([node], (id) => ctx.graph.getAbsolutePosition(id))
    zoomToBounds(b.x, b.y, b.x + b.width, b.y + b.height, insets, options)
    return true
  }

  function revealNode(nodeId: string, insets: ViewportInsets = {}, margin = 48): boolean {
    const node = ctx.graph.getNode(nodeId)
    if (!node) return false

    const b = computeAbsoluteBounds([node], (id) => ctx.graph.getAbsolutePosition(id))
    const { width: viewW, height: viewH } = ctx.getViewportSize()
    const area = resolveViewportArea(viewW, viewH, insets)
    const safeMargin = Math.max(0, Math.min(margin, area.width / 4, area.height / 4))
    const safeLeft = area.centerX - area.width / 2 + safeMargin
    const safeRight = area.centerX + area.width / 2 - safeMargin
    const safeTop = area.centerY - area.height / 2 + safeMargin
    const safeBottom = area.centerY + area.height / 2 - safeMargin
    const screenLeft = b.x * ctx.state.zoom + ctx.state.panX
    const screenRight = (b.x + b.width) * ctx.state.zoom + ctx.state.panX
    const screenTop = b.y * ctx.state.zoom + ctx.state.panY
    const screenBottom = (b.y + b.height) * ctx.state.zoom + ctx.state.panY

    if (
      screenRight - screenLeft > safeRight - safeLeft ||
      screenBottom - screenTop > safeBottom - safeTop
    ) {
      zoomToBounds(b.x, b.y, b.x + b.width, b.y + b.height, insets)
      return true
    }

    let panX = ctx.state.panX
    let panY = ctx.state.panY
    if (screenLeft < safeLeft) panX += safeLeft - screenLeft
    else if (screenRight > safeRight) panX -= screenRight - safeRight
    if (screenTop < safeTop) panY += safeTop - screenTop
    else if (screenBottom > safeBottom) panY -= screenBottom - safeBottom

    if (panX !== ctx.state.panX || panY !== ctx.state.panY) {
      setViewport({ panX, panY, zoom: ctx.state.zoom })
    }
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

  function zoomToReadableSelection(minimumScreenTextSize = 11, insets: ViewportInsets = {}): void {
    if (ctx.state.selectedIds.size === 0) return
    const selectedNodes = [...ctx.state.selectedIds]
      .map((id) => ctx.graph.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node != null)
    if (selectedNodes.length === 0) return

    zoomToSelection(insets)

    const pending = selectedNodes.flatMap((node) => [node.id, ...node.childIds])
    const visited = new Set<string>()
    let smallestFontSize = Infinity
    while (pending.length > 0) {
      const id = pending.shift()
      if (!id || visited.has(id)) continue
      visited.add(id)
      const node = ctx.graph.getNode(id)
      if (!node) continue
      if (node.type === 'TEXT') smallestFontSize = Math.min(smallestFontSize, node.fontSize)
      pending.push(...node.childIds)
    }
    if (!Number.isFinite(smallestFontSize) || smallestFontSize <= 0) return

    const readableZoom = minimumScreenTextSize / smallestFontSize
    if (ctx.state.zoom >= readableZoom) return
    const { width: viewW, height: viewH } = ctx.getViewportSize()
    const area = resolveViewportArea(viewW, viewH, insets)
    setZoomAroundPoint(readableZoom, area.centerX, area.centerY)
  }

  return {
    screenToCanvas,
    setViewport,
    setZoomAroundPoint,
    applyZoom,
    pan,
    zoomToBounds,
    zoomToFit,
    zoomToNode,
    revealNode,
    zoomTo100,
    zoomToLevel,
    zoomToSelection,
    zoomToReadableSelection
  }
}
