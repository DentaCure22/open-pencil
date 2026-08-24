import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'
import { computeDescendantVisualBounds } from '@open-pencil/scene-graph/geometry'

import { drawPageGuides } from '#core/canvas/page-guides'
import type { RenderOverlays, SkiaRenderer } from '#core/canvas/renderer'
import type { EditorState } from '#core/editor/types'

import { renderSceneBacking, updateSceneBackingPreviewState } from './retained-backing'

export function renderSceneToCanvas(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  pageId: string
): void {
  const prevViewport = r.worldViewport
  r.worldViewport = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }
  const pageNode = graph.getNode(pageId)
  if (pageNode) {
    for (const childId of pageNode.childIds) {
      r.renderNode(canvas, graph, childId, {})
    }
  }
  r.worldViewport = prevViewport
}

export type RenderLayer = 'full' | 'scene' | 'overlays'

export function renderFromEditorState(
  r: SkiaRenderer,
  state: EditorState,
  graph: SceneGraph,
  textEditor: unknown,
  viewportWidth: number,
  viewportHeight: number,
  showRulers = true,
  dpr = 1,
  layer: RenderLayer = 'full',
  selectionChromeOwnerIds?: ReadonlySet<string>,
  hoverChromeOwnerIds?: ReadonlySet<string>
): void {
  r.dpr = dpr
  r.panX = state.panX
  r.panY = state.panY
  r.zoom = state.zoom
  r.viewportWidth = viewportWidth
  r.viewportHeight = viewportHeight
  r.showRulers = showRulers
  r.pageColor = state.pageColor
  r.rulerTheme = state.rulerTheme ?? null
  r.pageId = state.currentPageId
  render(
    r,
    graph,
    state.selectedIds,
    {
      selectionChromeOwnerIds,
      hoverChromeOwnerIds,
      hoveredNodeId: state.hoveredNodeId,
      enteredContainerId: state.enteredContainerId,
      editingTextId: state.editingTextId,
      textEditor: textEditor as RenderOverlays['textEditor'],
      marquee: state.marquee,
      snapGuides: state.snapGuides,
      rotationPreview: state.rotationPreview,
      dropTargetId: state.dropTargetId,
      layoutInsertIndicator: state.layoutInsertIndicator,
      penState: state.penState
        ? ({
            ...state.penState,
            cursorX: state.penCursorX ?? undefined,
            cursorY: state.penCursorY ?? undefined
          } as RenderOverlays['penState'])
        : null,
      nodeEditState: state.nodeEditState ?? null,
      remoteCursors: state.remoteCursors,
      autoLayoutHover: state.autoLayoutHover
    },
    state.sceneVersion,
    layer
  )
}

function hasVolatileOverlay(overlays: RenderOverlays): boolean {
  return (
    overlays.dropTargetId != null ||
    overlays.rotationPreview != null ||
    overlays.editingTextId != null ||
    overlays.nodeEditState != null
  )
}

function scenePictureMissReason(
  r: SkiaRenderer,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  hasPositionPreview: boolean
): string {
  if (hasPositionPreview) return 'position-preview'
  if (hasVolatileOverlay(overlays)) return 'volatile-overlay'
  if (!r.scenePicture) return 'missing-picture'
  if (graph.positionPreviewVersion !== r.scenePicturePositionPreviewVersion)
    return 'position-preview-version'
  if (sceneVersion !== r.scenePictureVersion) return 'scene-version'
  if (r.pageId !== r.scenePicturePageId) return 'page'
  return 'unknown'
}

function canUseScenePicture(
  r: SkiaRenderer,
  graph: SceneGraph,
  sceneVersion: number,
  hasVolatileOverlays: boolean
): boolean {
  return (
    !hasVolatileOverlays &&
    !graph.hasNodePositionPresentations() &&
    !!r.scenePicture &&
    sceneVersion === r.scenePictureVersion &&
    r.pageId === r.scenePicturePageId
  )
}

function nodeIsOnPage(graph: SceneGraph, nodeId: string, pageId: string): boolean {
  let current = graph.getNode(nodeId)
  while (current) {
    if (current.id === pageId) return true
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return false
}

function previewPresentedNodeIds(
  graph: SceneGraph,
  pageId: string | null
): { liveIds: string[]; skipIds: string[] } | null {
  if (!pageId) return null
  const ids = graph.presentedNodeIds()
  if (ids.length === 0) return null
  const presented = new Set(ids)
  const liveIds: string[] = []
  for (const id of ids) {
    if (!nodeIsOnPage(graph, id, pageId)) return null
    let ancestorId = graph.getNode(id)?.parentId ?? null
    let nested = false
    while (ancestorId && ancestorId !== pageId) {
      if (presented.has(ancestorId)) {
        nested = true
        break
      }
      ancestorId = graph.getNode(ancestorId)?.parentId ?? null
    }
    if (!nested) liveIds.push(id)
  }
  return { liveIds, skipIds: [...ids] }
}

const now = typeof performance !== 'undefined' ? () => performance.now() : () => 0

function measure<T>(fn: () => T): { value: T; duration: number } {
  const start = now()
  const value = fn()
  return { value, duration: now() - start }
}

export function render(
  r: SkiaRenderer,
  graph: SceneGraph,
  selectedIds: Set<string>,
  overlays: RenderOverlays = {},
  sceneVersion = -1,
  layer: RenderLayer = 'full'
): void {
  const p = r.profiler
  p.beginFrame()
  p.setScenePictureDrawTime(0)
  p.setScenePictureRecordTime(0)
  p.setFlushTime(0)

  const canvas = r.surface.getCanvas()
  if (layer === 'full') {
    canvas.clear(r.ck.Color4f(r.pageColor.r, r.pageColor.g, r.pageColor.b, 1))
  } else {
    canvas.clear(r.ck.Color4f(0, 0, 0, 0))
  }

  r.worldViewport = {
    x: -r.panX / r.zoom,
    y: -r.panY / r.zoom,
    w: r.viewportWidth / r.zoom,
    h: r.viewportHeight / r.zoom
  }
  updateSceneBackingPreviewState(r, layer)

  const positionPreview = previewPresentedNodeIds(graph, r.pageId)
  const hasPositionPreview = graph.hasNodePositionPresentations()
  const hasVolatileOverlays = hasVolatileOverlay(overlays)
  const canCompositePositionPreview =
    hasPositionPreview && !hasVolatileOverlays && positionPreview !== null

  const canUsePicture = canUseScenePicture(r, graph, sceneVersion, hasVolatileOverlays)
  const cacheMissReason = scenePictureMissReason(
    r,
    graph,
    overlays,
    sceneVersion,
    hasPositionPreview
  )

  if (layer !== 'overlays') {
    canvas.save()
    canvas.scale(r.dpr, r.dpr)

    p.beginPhase('render:scene')
    if (
      layer === 'scene' &&
      !hasVolatileOverlays &&
      renderSceneBacking(r, canvas, graph, sceneVersion)
    ) {
      if (hasPositionPreview && positionPreview) {
        canvas.translate(r.panX, r.panY)
        canvas.scale(r.zoom, r.zoom)
        punchPresentedRestBounds(r, canvas, graph, positionPreview.skipIds)
        for (const id of positionPreview.liveIds) {
          r.renderNode(canvas, graph, id, overlays)
        }
        p.setScenePictureMode('preview', 'backing')
      } else {
        p.setScenePictureMode('hit', 'backing')
      }
    } else {
      canvas.translate(r.panX, r.panY)
      canvas.scale(r.zoom, r.zoom)
      renderSceneContent(
        r,
        canvas,
        graph,
        overlays,
        sceneVersion,
        canUsePicture,
        cacheMissReason,
        hasVolatileOverlays || (hasPositionPreview && !canCompositePositionPreview),
        canCompositePositionPreview ? positionPreview : null
      )
    }
    p.endPhase('render:scene')

    canvas.restore()
  }

  if (layer !== 'scene') {
    canvas.save()
    canvas.scale(r.dpr, r.dpr)
    r.labelCache.update(graph, r.pageId, sceneVersion, graph.positionPreviewVersion)
    p.beginPhase('render:sectionTitles')
    if (r.labelCache.getAllSections().length > 0) r.drawSectionTitles(canvas, graph)
    p.endPhase('render:sectionTitles')
    p.beginPhase('render:componentLabels')
    if (r.labelCache.getAllComponents().length > 0) r.drawComponentLabels(canvas, graph)
    p.endPhase('render:componentLabels')
    canvas.restore()

    canvas.save()
    canvas.scale(r.dpr, r.dpr)
    renderOverlayChrome(r, canvas, graph, selectedIds, overlays)
    canvas.restore()
  }

  p.beginPhase('render:flush')
  const { duration: flushDuration } = measure(() => r.surface.flush())
  p.setFlushTime(flushDuration)
  p.endPhase('render:flush')

  p.setNodeCounts(r._nodeCount, r._culledCount)
  p.endFrame()
}

function renderOverlayChrome(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  selectedIds: Set<string>,
  overlays: RenderOverlays
): void {
  const p = r.profiler
  if (
    overlays.hoveredNodeId &&
    overlays.hoveredNodeId !== overlays.nodeEditState?.nodeId &&
    !overlays.hoverChromeOwnerIds?.has(overlays.hoveredNodeId)
  ) {
    r.drawHoverHighlight(canvas, graph, overlays.hoveredNodeId)
  }
  if (overlays.enteredContainerId) {
    r.drawEnteredContainer(canvas, graph, overlays.enteredContainerId)
  }
  p.beginPhase('render:selection')
  if (selectedIds.size > 0) r.drawSelection(canvas, graph, selectedIds, overlays)
  p.endPhase('render:selection')
  if (r._flashes.length > 0) r.drawFlashes(canvas, graph)
  drawPageGuides(r, canvas, graph)
  if (overlays.snapGuides?.length) r.drawSnapGuides(canvas, overlays.snapGuides)
  if (overlays.marquee) r.drawMarquee(canvas, overlays.marquee)
  if (overlays.layoutInsertIndicator) {
    r.drawLayoutInsertIndicator(canvas, overlays.layoutInsertIndicator)
  }
  if (overlays.autoLayoutHover) r.drawAutoLayoutHover(canvas, graph, overlays.autoLayoutHover)
  if (overlays.nodeEditState) r.drawNodeEditOverlay(canvas, graph, overlays.nodeEditState)
  if (overlays.penState) r.drawPenOverlay(canvas, overlays.penState)
  if (overlays.remoteCursors?.length) {
    r.drawRemoteCursors(canvas, graph, overlays.remoteCursors)
  }
  p.beginPhase('render:rulers')
  if (r.showRulers) r.drawRulers(canvas, graph, selectedIds)
  p.endPhase('render:rulers')
  if (r.profiler.hudVisible) p.drawHUD(canvas, r.showRulers)
}

function renderSceneContent(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  canUsePicture: boolean,
  cacheMissReason: string,
  hasVolatileOverlays: boolean,
  positionPreview: { liveIds: string[]; skipIds: string[] } | null
): void {
  const p = r.profiler
  if (canUsePicture) {
    p.setScenePictureMode('hit')
    p.beginPhase('render:drawPicture')
    if (r.scenePicture) {
      const picture = r.scenePicture
      const { duration } = measure(() => canvas.drawPicture(picture))
      p.setScenePictureDrawTime(duration)
    }
    p.endPhase('render:drawPicture')
    return
  }
  if (positionPreview) {
    p.setScenePictureMode('preview', 'position-preview')
    r._nodeCount = 0
    r._culledCount = 0
    p.beginPhase('render:preview')
    const { duration } = measure(() =>
      renderPositionPreview(r, canvas, graph, overlays, sceneVersion, positionPreview)
    )
    p.setScenePictureDrawTime(duration)
    p.endPhase('render:preview')
    return
  }
  if (hasVolatileOverlays) {
    p.setScenePictureMode('volatile', cacheMissReason)
    r._nodeCount = 0
    r._culledCount = 0
    p.beginPhase('render:volatile')
    renderPageChildren(r, canvas, graph, overlays)
    p.endPhase('render:volatile')
    return
  }
  p.setScenePictureMode('record', cacheMissReason)
  r._nodeCount = 0
  r._culledCount = 0
  p.beginPhase('render:recordPicture')
  const { duration } = measure(() => recordScenePicture(r, canvas, graph, sceneVersion))
  p.setScenePictureRecordTime(duration)
  p.endPhase('render:recordPicture')
}

function renderPageChildren(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays
): void {
  const pageNode = graph.getNode(r.pageId ?? graph.rootId)
  if (!pageNode) return
  for (const childId of pageNode.childIds) {
    r.renderNode(canvas, graph, childId, overlays)
  }
}

function punchPresentedRestBounds(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  ids: readonly string[]
): void {
  r.fillPaint.setAlphaf(1)
  r.fillPaint.setShader(null)
  r.fillPaint.setColor(r.ck.Color4f(0, 0, 0, 1))
  r.fillPaint.setBlendMode(r.ck.BlendMode.Clear)
  for (const id of ids) {
    const bounds = graph.getAuthoritativeAbsoluteBounds(id)
    if (bounds.width <= 0 || bounds.height <= 0) continue
    canvas.drawRect(
      r.ck.LTRBRect(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height),
      r.fillPaint
    )
  }
  r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
}

function renderPositionPreview(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  overlays: RenderOverlays,
  sceneVersion: number,
  preview: { liveIds: readonly string[]; skipIds: readonly string[] }
): void {
  if (
    r.scenePicture &&
    r.scenePictureVersion === sceneVersion &&
    r.scenePicturePageId === r.pageId
  ) {
    canvas.drawPicture(r.scenePicture)
    punchPresentedRestBounds(r, canvas, graph, preview.skipIds)
  } else {
    r.skipSceneNodeIds = new Set(preview.skipIds)
    renderPageChildren(r, canvas, graph, overlays)
    r.skipSceneNodeIds = null
  }
  for (const id of preview.liveIds) {
    r.renderNode(canvas, graph, id, overlays)
  }
}

function recordScenePicture(
  r: SkiaRenderer,
  canvas: Canvas,
  graph: SceneGraph,
  sceneVersion: number
): void {
  r.scenePicture?.delete()
  const prevViewport = r.worldViewport
  r.worldViewport = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 }
  const recorder = new r.ck.PictureRecorder()
  const pageNode = graph.getNode(r.pageId ?? graph.rootId)
  const canReuseBounds =
    r.scenePictureBounds &&
    r.scenePictureBoundsVersion === sceneVersion &&
    r.scenePictureBoundsPageId === r.pageId
  const sceneContentBounds =
    canReuseBounds || !pageNode
      ? null
      : computeDescendantVisualBounds(
          pageNode.childIds,
          (id) => graph.getNode(id),
          (id) => graph.getAbsolutePosition(id)
        )
  const sceneBounds =
    (canReuseBounds ? r.scenePictureBounds : null) ??
    (sceneContentBounds
      ? {
          x: sceneContentBounds.minX,
          y: sceneContentBounds.minY,
          width: sceneContentBounds.maxX - sceneContentBounds.minX,
          height: sceneContentBounds.maxY - sceneContentBounds.minY
        }
      : { x: 0, y: 0, width: 1, height: 1 })
  r.scenePictureBounds = sceneBounds
  r.scenePictureBoundsVersion = sceneVersion
  r.scenePictureBoundsPageId = r.pageId
  const padding = 1024
  const bounds = r.ck.LTRBRect(
    sceneBounds.x - padding,
    sceneBounds.y - padding,
    sceneBounds.x + sceneBounds.width + padding,
    sceneBounds.y + sceneBounds.height + padding
  )
  const recCanvas = recorder.beginRecording(bounds)
  if (pageNode) {
    for (const childId of pageNode.childIds) {
      r.renderNode(recCanvas, graph, childId, {})
    }
  }
  r.scenePicture = recorder.finishRecordingAsPicture()
  recorder.delete()
  r.worldViewport = prevViewport
  r.scenePictureVersion = sceneVersion
  r.scenePicturePositionPreviewVersion = graph.positionPreviewVersion
  r.scenePicturePageId = r.pageId
  canvas.drawPicture(r.scenePicture)
}
