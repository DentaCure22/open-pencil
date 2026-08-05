import { describe, expect, test } from 'bun:test'

import { createMermaidSvgSpec } from '@open-pencil/core/diagram'
import { createEditor } from '@open-pencil/core/editor'

import { handleMoveMove, handleMoveUp, MOVE_DRAG_START_THRESHOLD_PX } from '#vue/shared/input/move'
import { applyResize, commitResizePreview, tryStartResize } from '#vue/shared/input/resize'
import { resolveHit } from '#vue/shared/input/select'
import { createSelectionMoveDrag } from '#vue/shared/input/select/move'

function setupDiagram() {
  const editor = createEditor()
  editor.insertMermaidDiagram(
    createMermaidSvgSpec('sankey-beta\nSource,Target,10', { width: 100, height: 50 }),
    { x: 100, y: 80 }
  )
  const ownerId = [...editor.state.selectedIds][0]
  const owner = ownerId ? editor.graph.getNode(ownerId) : undefined
  if (!owner) throw new Error('Expected selected Mermaid owner')
  return { editor, owner }
}

describe('Mermaid SVG frame transforms', () => {
  test('treats the diagram as one selectable object with no native children', () => {
    const { editor, owner } = setupDiagram()
    editor.setCanvasKit(
      {} as Parameters<typeof editor.setCanvasKit>[0],
      {} as Parameters<typeof editor.setCanvasKit>[1]
    )
    const hit = resolveHit(owner.x + 50, owner.y + 25, editor, {
      hitTestInScope: (x, y, deep) => editor.hitTestAtPoint(x, y, deep),
      isInsideContainerBounds: () => true,
      hitTestSectionTitle: () => null,
      hitTestComponentLabel: () => null,
      hitTestFrameTitle: () => null
    })

    expect(owner.type).toBe('FRAME')
    expect(owner.childIds).toEqual([])
    expect(hit?.id).toBe(owner.id)
  })

  test('moves the source-backed frame normally', () => {
    const { editor, owner } = setupDiagram()
    const drag = createSelectionMoveDrag(owner.x + 50, owner.y + 25, 500, 400, editor, false)
    if (drag.type !== 'move') throw new Error('Expected move drag')
    handleMoveMove(
      drag,
      owner.x + 70,
      owner.y + 35,
      500 + MOVE_DRAG_START_THRESHOLD_PX + 1,
      400,
      editor
    )
    handleMoveUp(drag, editor)

    expect(editor.graph.getNode(owner.id)).toMatchObject({ x: 120, y: 90, childIds: [] })
  })

  test('resizes the frame without native child scaling', () => {
    const { editor, owner } = setupDiagram()
    const drag = tryStartResize(owner.x + owner.width, owner.y + owner.height, editor)
    if (!drag) throw new Error('Expected Mermaid resize drag')

    applyResize(drag, drag.startX + 100, drag.startY + 50, false, editor)
    commitResizePreview(drag, editor)

    expect(editor.graph.getNode(owner.id)).toMatchObject({ width: 200, height: 100, childIds: [] })
    editor.undo.undo()
    expect(editor.graph.getNode(owner.id)).toMatchObject({ width: 100, height: 50, childIds: [] })
  })
})
