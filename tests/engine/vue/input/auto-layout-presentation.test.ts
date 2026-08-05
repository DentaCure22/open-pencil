import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { computeAutoLayoutIndicatorForFrame } from '#vue/shared/input/auto-layout'

describe('auto-layout presentation geometry', () => {
  test('places a visible drop indicator against a transiently presented parent', () => {
    const editor = createEditor()
    const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      height: 100,
      itemSpacing: 10,
      layoutMode: 'HORIZONTAL',
      width: 200,
      x: 0,
      y: 0
    })
    editor.graph.createNode('RECTANGLE', frame.id, {
      height: 40,
      width: 40,
      x: 10,
      y: 10
    })
    editor.graph.setNodePositionPresentation(frame.id, { x: 100, y: 0 })

    computeAutoLayoutIndicatorForFrame(frame, 105, 20, editor, new Set())

    expect(editor.state.layoutInsertIndicator).toMatchObject({
      index: 0,
      parentId: frame.id,
      x: 105
    })
  })
})
