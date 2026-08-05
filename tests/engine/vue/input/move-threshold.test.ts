import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import {
  cancelMove,
  handleMoveMove,
  handleMoveUp,
  MOVE_DRAG_START_THRESHOLD_PX
} from '#vue/shared/input/move'
import { createSelectionMoveDrag } from '#vue/shared/input/select/move'
import type { DragMove } from '#vue/shared/input/types'

function setupMoveDrag(): {
  editor: ReturnType<typeof createEditor>
  drag: DragMove
  nodeId: string
} {
  const editor = createEditor()
  const pageId = editor.state.currentPageId
  const node = editor.graph.createNode('RECTANGLE', pageId, {
    name: 'Box',
    x: 10,
    y: 20,
    width: 100,
    height: 80
  })
  editor.select([node.id])
  const drag = createSelectionMoveDrag(10, 20, 100, 200, editor, false)
  if (drag.type !== 'move') throw new Error('Expected move drag')
  return { editor, drag, nodeId: node.id }
}

describe('selection move drag threshold', () => {
  test('does not move selected nodes for click jitter below threshold', () => {
    const { editor, drag, nodeId } = setupMoveDrag()

    handleMoveMove(drag, 11, 21, 100 + MOVE_DRAG_START_THRESHOLD_PX - 1, 200, editor)
    handleMoveUp(drag, editor)

    const node = editor.graph.getNode(nodeId)
    expect(node?.x).toBe(10)
    expect(node?.y).toBe(20)
    expect(drag.dragStarted).toBe(false)
  })

  test('moves selected nodes once pointer movement exceeds threshold', () => {
    const { editor, drag, nodeId } = setupMoveDrag()

    handleMoveMove(drag, 16, 27, 100 + MOVE_DRAG_START_THRESHOLD_PX + 1, 200, editor)

    expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, y: 20 })
    expect(editor.graph.getPresentedNodePosition(nodeId)).toEqual({ x: 16, y: 27 })
    expect(editor.undo.undo()).toBeNull()
    handleMoveUp(drag, editor)

    const node = editor.graph.getNode(nodeId)
    expect(node?.x).toBe(16)
    expect(node?.y).toBe(27)
    expect(editor.graph.getPresentedNodePosition(nodeId)).toEqual({ x: 16, y: 27 })
    expect(editor.undo.undo()).toBe('Move')
    expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, y: 20 })
    expect(drag.dragStarted).toBe(true)
  })

  test('commits the snapped presentation pose instead of the raw pointer delta', () => {
    const { editor, drag, nodeId } = setupMoveDrag()
    editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      height: 80,
      name: 'Snap target',
      width: 100,
      x: 150,
      y: 20
    })

    handleMoveMove(drag, 48, 20, 140, 200, editor)
    expect(editor.graph.getPresentedNodePosition(nodeId)).toEqual({ x: 50, y: 20 })
    handleMoveMove(drag, 47, 20, 139, 200, editor)
    expect(editor.graph.getPresentedNodePosition(nodeId)).toEqual({ x: 50, y: 20 })

    handleMoveUp(drag, editor)

    expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 50, y: 20 })
    expect(editor.undo.undo()).toBe('Move')
    expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, y: 20 })
  })

  test('clears a presentation after dragging away and returning to the origin', () => {
    const { editor, drag, nodeId } = setupMoveDrag()

    handleMoveMove(drag, 30, 40, 130, 220, editor)
    expect(editor.graph.hasNodePositionPresentations()).toBe(true)
    handleMoveMove(drag, 10, 20, 100, 200, editor)
    expect(editor.graph.getPresentedNodePosition(nodeId)).toEqual({ x: 10, y: 20 })

    handleMoveUp(drag, editor)

    expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, y: 20 })
    expect(editor.graph.hasNodePositionPresentations()).toBe(false)
    expect(editor.undo.undo()).toBeNull()
  })

  test('cancels a held drag without changing durable geometry or Undo', () => {
    const { editor, drag, nodeId } = setupMoveDrag()

    handleMoveMove(drag, 40, 60, 140, 240, editor)
    expect(editor.graph.getPresentedNodePosition(nodeId)).toEqual({ x: 40, y: 60 })

    cancelMove(drag, editor)

    expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, y: 20 })
    expect(editor.graph.hasNodePositionPresentations()).toBe(false)
    expect(editor.undo.undo()).toBeNull()
  })

  test('removes duplicate created for alt-click without movement', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const node = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Box',
      x: 10,
      y: 20,
      width: 100,
      height: 80
    })
    editor.select([node.id])

    const drag = createSelectionMoveDrag(10, 20, 100, 200, editor, true)
    if (drag.type !== 'move') throw new Error('Expected move drag')
    expect(editor.graph.getChildren(pageId)).toHaveLength(2)

    handleMoveUp(drag, editor)

    expect(editor.graph.getChildren(pageId).map((child) => child.id)).toEqual([node.id])
    expect([...editor.state.selectedIds]).toEqual([node.id])
  })

  test('removes a moved duplicate when the drag is cancelled', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const node = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Box',
      x: 10,
      y: 20,
      width: 100,
      height: 80
    })
    editor.select([node.id])

    const drag = createSelectionMoveDrag(10, 20, 100, 200, editor, true)
    if (drag.type !== 'move') throw new Error('Expected move drag')
    handleMoveMove(drag, 40, 60, 140, 240, editor)
    cancelMove(drag, editor)

    expect(editor.graph.getChildren(pageId).map((child) => child.id)).toEqual([node.id])
    expect([...editor.state.selectedIds]).toEqual([node.id])
    expect(editor.graph.hasNodePositionPresentations()).toBe(false)
    expect(editor.undo.undo()).toBeNull()
  })
})
