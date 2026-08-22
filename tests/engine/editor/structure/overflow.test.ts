import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

describe('outside-frame membership', () => {
  test('deleting a frame leaves a child that is fully outside it', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const inside = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Inside',
      x: 20,
      y: 20,
      width: 80,
      height: 80
    })
    const outside = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Outside',
      x: 500,
      y: 20,
      width: 80,
      height: 80
    })

    editor.select([frame.id])
    editor.deleteSelected()

    expect(editor.graph.getNode(frame.id)).toBeUndefined()
    expect(editor.graph.getNode(inside.id)).toBeUndefined()
    expect(editor.graph.getNode(outside.id)?.parentId).toBe(pageId)
  })

  test('deleting a frame still deletes children that overlap it', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 400,
      height: 400
    })
    const overlapping = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Overlap',
      x: 360,
      y: 20,
      width: 80,
      height: 80
    })

    editor.select([frame.id])
    editor.deleteSelected()

    expect(editor.graph.getNode(frame.id)).toBeUndefined()
    expect(editor.graph.getNode(overlapping.id)).toBeUndefined()
  })

  test('shrinking a frame detaches children that no longer overlap it', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const frame = editor.graph.createNode('FRAME', pageId, {
      name: 'Workspace',
      x: 0,
      y: 0,
      width: 800,
      height: 400
    })
    const chart = editor.graph.createNode('RECTANGLE', frame.id, {
      name: 'Chart',
      x: 500,
      y: 20,
      width: 200,
      height: 200
    })

    editor.graph.updateNode(frame.id, { width: 400 })
    editor.detachOutsideFrameMembership([frame.id])

    expect(editor.graph.getNode(chart.id)?.parentId).toBe(pageId)
  })
})
