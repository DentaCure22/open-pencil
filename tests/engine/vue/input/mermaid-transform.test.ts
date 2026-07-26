import { describe, expect, test } from 'bun:test'

import { reactive } from 'vue'

import {
  MERMAID_DIAGRAM_REVISION,
  MERMAID_SVG_PARSER,
  type MermaidSceneSpec
} from '@open-pencil/core/diagram'
import { createEditor } from '@open-pencil/core/editor'

import { handleMoveMove, handleMoveUp, MOVE_DRAG_START_THRESHOLD_PX } from '#vue/shared/input/move'
import { applyResize, commitResizePreview, tryStartResize } from '#vue/shared/input/resize'
import { resolveHit } from '#vue/shared/input/select'
import { createSelectionMoveDrag } from '#vue/shared/input/select/move'

const scene: MermaidSceneSpec = {
  appearance: 'dark',
  source: 'sankey\nSource,Target,10',
  revision: MERMAID_DIAGRAM_REVISION,
  parser: MERMAID_SVG_PARSER,
  mode: 'editable',
  width: 100,
  height: 50,
  nodes: [
    {
      key: 'link',
      type: 'VECTOR',
      props: {
        name: 'Sankey link',
        x: 0,
        y: 20,
        width: 100,
        height: 1,
        strokes: [
          {
            align: 'CENTER',
            color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
            opacity: 0.5,
            visible: true,
            weight: 8
          }
        ],
        vectorNetwork: {
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 }
          ],
          segments: [
            {
              start: 0,
              end: 1,
              tangentStart: { x: 25, y: 0 },
              tangentEnd: { x: -25, y: 0 }
            }
          ],
          regions: []
        }
      }
    },
    {
      key: 'label',
      type: 'TEXT',
      props: {
        name: 'Source 10',
        text: 'Source 10',
        x: 10,
        y: 10,
        width: 40,
        height: 12,
        fontSize: 10,
        lineHeight: 12
      }
    }
  ]
}

function setupDiagram() {
  const editor = createEditor()
  editor.insertMermaidDiagram(scene, { x: 100, y: 80 })
  const ownerId = [...editor.state.selectedIds][0]
  const owner = ownerId ? editor.graph.getNode(ownerId) : undefined
  if (!owner) throw new Error('Expected selected Mermaid owner')
  const linkId = owner.childIds[0]
  const labelId = owner.childIds[1]
  if (!linkId || !labelId) throw new Error('Expected Mermaid children')
  return { editor, owner, linkId, labelId }
}

describe('native Mermaid transforms', () => {
  test('treats diagrams saved as legacy frames as one selectable resizable object', () => {
    const { editor, owner, linkId } = setupDiagram()
    editor.graph.updateNode(owner.id, { type: 'FRAME' })
    const link = editor.graph.getNode(linkId)
    if (!link) throw new Error('Expected Mermaid link')

    const hit = resolveHit(owner.x + 50, owner.y + 25, editor, {
      hitTestInScope: () => link,
      isInsideContainerBounds: () => false,
      hitTestSectionTitle: () => null,
      hitTestComponentLabel: () => null,
      hitTestFrameTitle: () => null
    })
    const drag = tryStartResize(owner.x + owner.width, owner.y + owner.height, editor)

    expect(hit?.id).toBe(owner.id)
    expect(drag?.origChildren?.size).toBe(2)
    expect(drag?.proportional).toBe(true)
  })

  test('moves from anywhere inside the selected grouped diagram', () => {
    const { editor, owner, linkId } = setupDiagram()
    const hit = editor.graph.hitTest(owner.x + 50, owner.y + 25, editor.state.currentPageId)

    expect(owner.type).toBe('GROUP')
    expect(hit?.id).toBe(owner.id)

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

    expect(editor.graph.getNode(owner.id)).toMatchObject({ x: 120, y: 90 })
    expect(editor.graph.getAbsolutePosition(linkId)).toEqual({ x: 120, y: 110 })
  })

  test('selects native pieces after entering a Mermaid diagram', () => {
    const { editor, owner, labelId } = setupDiagram()
    const label = editor.graph.getNode(labelId)
    if (!label) throw new Error('Expected Mermaid label')

    const beforeEnter = resolveHit(owner.x + label.x + 1, owner.y + label.y + 1, editor, {
      hitTestInScope: () => label,
      isInsideContainerBounds: () => true,
      hitTestSectionTitle: () => null,
      hitTestComponentLabel: () => null,
      hitTestFrameTitle: () => null
    })

    editor.enterContainer(owner.id)
    const afterEnter = resolveHit(owner.x + label.x + 1, owner.y + label.y + 1, editor, {
      hitTestInScope: () => label,
      isInsideContainerBounds: () => true,
      hitTestSectionTitle: () => null,
      hitTestComponentLabel: () => null,
      hitTestFrameTitle: () => null
    })

    expect(beforeEnter?.id).toBe(owner.id)
    expect(afterEnter?.id).toBe(label.id)
  })

  test('resizes the diagram proportionally with vector, stroke, and text scaling', () => {
    const { editor, owner, linkId, labelId } = setupDiagram()
    const drag = tryStartResize(owner.x + owner.width, owner.y + owner.height, editor)
    if (!drag) throw new Error('Expected Mermaid resize drag')

    expect(drag.proportional).toBe(true)
    applyResize(drag, drag.startX + 100, drag.startY + 10, false, editor)
    commitResizePreview(drag, editor)

    expect(editor.graph.getNode(owner.id)).toMatchObject({ width: 200, height: 100 })
    expect(editor.graph.getNode(linkId)).toMatchObject({ width: 200, y: 40 })
    expect(editor.graph.getNode(linkId)?.strokes[0]?.weight).toBe(16)
    expect(editor.graph.getNode(labelId)).toMatchObject({
      x: 20,
      y: 20,
      width: 80,
      height: 24,
      fontSize: 20,
      lineHeight: 24
    })

    editor.undo.undo()
    expect(editor.graph.getNode(owner.id)).toMatchObject({ width: 100, height: 50 })
    expect(editor.graph.getNode(linkId)?.strokes[0]?.weight).toBe(8)
    expect(editor.graph.getNode(labelId)).toMatchObject({ fontSize: 10, lineHeight: 12 })

    editor.undo.redo()
    expect(editor.graph.getNode(owner.id)).toMatchObject({ width: 200, height: 100 })
    expect(editor.graph.getNode(linkId)?.strokes[0]?.weight).toBe(16)
    expect(editor.graph.getNode(labelId)).toMatchObject({ fontSize: 20, lineHeight: 24 })
  })

  test('resizes reactive Mermaid drag snapshots without a DataCloneError', () => {
    const { editor, owner } = setupDiagram()
    const drag = tryStartResize(owner.x + owner.width, owner.y + owner.height, editor)
    if (!drag) throw new Error('Expected Mermaid resize drag')

    const reactiveDrag = reactive(drag)

    expect(() => {
      applyResize(reactiveDrag, reactiveDrag.startX + 50, reactiveDrag.startY + 25, false, editor)
    }).not.toThrow()
    expect(editor.graph.getNode(owner.id)).toMatchObject({ width: 150, height: 75 })
  })
})
