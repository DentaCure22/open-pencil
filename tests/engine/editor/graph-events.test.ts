import { describe, expect, mock, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'
import { rendererInvalidationForChanges } from '#core/editor/graph-events'

describe('graph event renderer invalidation', () => {
  test('position-only committed updates keep node pictures', () => {
    expect(rendererInvalidationForChanges({ x: 10 })).toEqual({
      geometryCache: false,
      nodePicture: false,
      paragraphCache: false
    })
  })

  test('geometry fields invalidate vector and geometry path caches', () => {
    for (const changes of [{ vectorNetwork: null }, { fillGeometry: [] }, { strokeGeometry: [] }]) {
      expect(rendererInvalidationForChanges(changes).geometryCache).toBe(true)
    }
  })

  test('position-only preview updates keep node pictures', () => {
    expect(rendererInvalidationForChanges({ x: 10, y: 20 })).toEqual({
      geometryCache: false,
      nodePicture: false,
      paragraphCache: false
    })
  })

  test('text layout fields invalidate the paragraph cache without treating position as text', () => {
    expect(rendererInvalidationForChanges({ text: 'Hello' }).paragraphCache).toBe(true)
    expect(rendererInvalidationForChanges({ fontWeight: 700 }).paragraphCache).toBe(true)
    expect(rendererInvalidationForChanges({ x: 12, y: 8 }).paragraphCache).toBe(false)
  })

  test('size preview updates invalidate node pictures for effects and cached shapes', () => {
    expect(rendererInvalidationForChanges({ width: 20, height: 30 })).toEqual({
      geometryCache: false,
      nodePicture: true,
      paragraphCache: true
    })
  })

  test('graph replacement invalidates every renderer cache', () => {
    const editor = createEditor()
    const firstRenderer = { invalidateAllPictures: mock() } as Parameters<
      typeof editor.setCanvasKit
    >[1]
    const secondRenderer = { invalidateAllPictures: mock() } as Parameters<
      typeof editor.setCanvasKit
    >[1]
    const canvasKit = {} as Parameters<typeof editor.setCanvasKit>[0]

    editor.setCanvasKit(canvasKit, firstRenderer)
    editor.setCanvasKit(canvasKit, secondRenderer)
    editor.replaceGraph(new SceneGraph())

    expect(firstRenderer.invalidateAllPictures).toHaveBeenCalledTimes(1)
    expect(secondRenderer.invalidateAllPictures).toHaveBeenCalledTimes(1)
  })

  test('authority-style graph replacement preserves a stable Board view', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected the default page')
    const frame = graph.createNode('FRAME', page.id, { name: 'Persistent Code Object' })
    const editor = createEditor({ graph })
    editor.select([frame.id])
    editor.setHoveredNode(frame.id)
    editor.setViewport({ panX: 120, panY: -45, zoom: 1.5 })

    const replacement = new SceneGraph()
    replacement.rootId = graph.rootId
    replacement.nodes = new Map(
      [...graph.nodes].map(([id, node]) => [id, structuredClone(node)] as const)
    )
    replacement.updateNode(frame.id, { name: 'Updated Code Object' })

    editor.replaceGraph(replacement, { preserveViewState: true })

    expect(editor.state.currentPageId).toBe(page.id)
    expect([...editor.state.selectedIds]).toEqual([frame.id])
    expect(editor.state.hoveredNodeId).toBe(frame.id)
    expect({
      panX: editor.state.panX,
      panY: editor.state.panY,
      zoom: editor.state.zoom
    }).toEqual({ panX: 120, panY: -45, zoom: 1.5 })
  })
})
