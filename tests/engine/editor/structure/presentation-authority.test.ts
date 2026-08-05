import { describe, expect, test } from 'bun:test'

import { createEditor } from '#core/editor'

describe('structure commands with transient position presentations', () => {
  test('groups from durable geometry and keeps Undo stable', () => {
    const editor = createEditor()
    const pageId = editor.state.currentPageId
    const first = editor.graph.createNode('RECTANGLE', pageId, {
      height: 40,
      width: 20,
      x: 10,
      y: 20
    })
    const second = editor.graph.createNode('RECTANGLE', pageId, {
      height: 40,
      width: 20,
      x: 50,
      y: 20
    })
    editor.graph.setNodePositionPresentation(first.id, { x: 110, y: 20 })
    editor.select([first.id, second.id])

    const groupId = editor.groupSelected()
    const group = groupId ? editor.graph.getNode(groupId) : undefined

    expect(group).toMatchObject({ height: 40, width: 60, x: 10, y: 20 })
    expect(editor.graph.getNode(first.id)).toMatchObject({ parentId: groupId, x: 0, y: 0 })
    expect(editor.graph.getNode(second.id)).toMatchObject({ parentId: groupId, x: 40, y: 0 })
    expect(editor.graph.hasNodePositionPresentations()).toBe(false)
    expect(editor.undo.undo()).toBe('Create group')
    expect(editor.graph.getNode(first.id)).toMatchObject({ parentId: pageId, x: 10, y: 20 })
    expect(editor.graph.getNode(second.id)).toMatchObject({ parentId: pageId, x: 50, y: 20 })
  })
})
