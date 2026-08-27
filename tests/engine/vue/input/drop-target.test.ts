import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { applyMoveReparent } from '#vue/shared/input/drop-target'
import { cancelMove, handleMoveMove, handleMoveUp } from '#vue/shared/input/move'
import { createSelectionMoveDrag } from '#vue/shared/input/select/move'

describe('move reparent', () => {
  test('detaches a child that fully left its frame even when dropped on that frame', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const card = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Card',
      x: 20,
      y: 20,
      width: 80,
      height: 80
    })
    editor.graph.updateNode(card.id, { x: 500, y: 20 })
    editor.select([card.id])
    editor.setDropTarget(frame.id)

    applyMoveReparent(editor)

    expect(editor.graph.getNode(card.id)?.parentId).toBe(pageId)
  })

  test('keeps a child that still overlaps its frame', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const card = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Card',
      x: 20,
      y: 20,
      width: 80,
      height: 80
    })
    editor.select([card.id])
    editor.setDropTarget(frame.id)

    applyMoveReparent(editor)

    expect(editor.graph.getNode(card.id)?.parentId).toBe(frame.id)
  })

  test('lets a product-owned frame detach a deliberately crossing child', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Project space',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const card = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Card',
      x: 360,
      y: 20,
      width: 100,
      height: 80
    })
    editor.select([card.id])
    editor.setDropTarget(frame.id)

    applyMoveReparent(editor, {
      shouldDetach: (child, parent) => child.x + child.width / 2 > parent.width
    })

    expect(editor.graph.getNode(card.id)?.parentId).toBe(pageId)
  })

  test('reparents onto another frame under the pointer', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const source = editor.graph.createNode('FRAME', pageId, {
      name: 'Source',
      x: 0,
      y: 0,
      width: 200,
      height: 200
    })
    const target = editor.graph.createNode('FRAME', pageId, {
      name: 'Target',
      x: 400,
      y: 0,
      width: 200,
      height: 200
    })
    const card = editor.graph.createNode('RECTANGLE', source.id, {
      name: 'Card',
      x: 20,
      y: 20,
      width: 80,
      height: 80
    })
    editor.select([card.id])
    editor.setDropTarget(target.id)

    applyMoveReparent(editor)

    expect(editor.graph.getNode(card.id)?.parentId).toBe(target.id)
  })

  test('drops a page object back into a frame under its center', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const card = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Card',
      x: 500,
      y: 20,
      width: 80,
      height: 80
    })
    editor.graph.updateNode(card.id, { x: 40, y: 40 })
    editor.select([card.id])
    editor.setDropTarget(null)

    applyMoveReparent(editor)

    expect(editor.graph.getNode(card.id)?.parentId).toBe(frame.id)
  })

  test('moving a frame over a page object absorbs it', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const card = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Card',
      x: 40,
      y: 40,
      width: 80,
      height: 80
    })
    editor.select([frame.id])
    editor.setDropTarget(null)

    applyMoveReparent(editor)

    expect(editor.graph.getNode(card.id)?.parentId).toBe(frame.id)
  })

  test('drops a page object back onto a frame under the pointer', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const card = editor.graph.createNode('RECTANGLE', pageId, {
      name: 'Card',
      x: 500,
      y: 20,
      width: 80,
      height: 80
    })
    editor.select([card.id])
    editor.setDropTarget(frame.id)

    applyMoveReparent(editor)

    expect(editor.graph.getNode(card.id)?.parentId).toBe(frame.id)
  })

  test('moving a frame leaves a child that is fully outside it', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 40,
      y: 40,
      width: 400,
      height: 400
    })
    const chart = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Chart',
      x: 500,
      y: 20,
      width: 80,
      height: 80
    })
    const chartAbs = editor.graph.getAbsolutePosition(chart.id)
    editor.select([frame.id])
    const drag = createSelectionMoveDrag(40, 40, 100, 200, editor, false)
    if (drag.type !== 'move') throw new Error('Expected move drag')

    handleMoveMove(drag, 80, 40, 160, 200, editor)
    handleMoveUp(drag, editor)

    expect(editor.graph.getNode(frame.id)).toMatchObject({ x: 80, y: 40 })
    expect(editor.graph.getNode(chart.id)?.parentId).toBe(pageId)
    expect(editor.graph.getAbsolutePosition(chart.id)).toEqual(chartAbs)
  })

  test('canceling a frame move puts an overflow child back', () => {
    const editor = createEditor()
    const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Workspace',
      x: 40,
      y: 40,
      width: 400,
      height: 400
    })
    const chart = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Chart',
      x: 500,
      y: 20,
      width: 80,
      height: 80
    })
    editor.select([frame.id])
    const drag = createSelectionMoveDrag(40, 40, 100, 200, editor, false)
    if (drag.type !== 'move') throw new Error('Expected move drag')

    handleMoveMove(drag, 80, 40, 160, 200, editor)
    cancelMove(drag, editor)

    expect(editor.graph.getNode(chart.id)?.parentId).toBe(frame.id)
    expect(editor.graph.getNode(frame.id)).toMatchObject({ x: 40, y: 40 })
  })
})
