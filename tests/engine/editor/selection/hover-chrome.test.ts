import { describe, expect, test } from 'bun:test'

import { CODE_OBJECT_KIND, CODE_OBJECT_PLUGIN_ID } from '@open-pencil/core/code-object'
import { createEditor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('Code Object hover chrome', () => {
  test('does not request an overlay paint when hover stays on Code Object chrome', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected the default page')
    const card = graph.createNode('FRAME', page.id, {
      name: 'Agent card',
      pluginData: [{ key: 'kind', pluginId: CODE_OBJECT_PLUGIN_ID, value: CODE_OBJECT_KIND }]
    })
    const rectangle = graph.createNode('RECTANGLE', page.id, { name: 'Rectangle' })
    const editor = createEditor({ graph })
    let overlayRequests = 0
    editor.onEditorEvent('overlay:requested', () => {
      overlayRequests += 1
    })

    editor.setHoveredNode(card.id)
    expect(overlayRequests).toBe(0)
    expect(editor.state.hoveredNodeId).toBe(card.id)
    await Promise.resolve()

    editor.setHoveredNode(null)
    expect(overlayRequests).toBe(0)
    await Promise.resolve()

    editor.setHoveredNode(rectangle.id)
    expect(overlayRequests).toBe(1)
    await Promise.resolve()

    editor.setHoveredNode(card.id)
    expect(overlayRequests).toBe(2)
    await Promise.resolve()

    editor.setHoveredNode(null)
    expect(overlayRequests).toBe(2)
  })

  test('keeps hover when the pointer leaves the canvas onto a Code Object host', async () => {
    const input = await Bun.file('packages/vue/src/canvas/useCanvasInput.ts').text()
    expect(input).toContain('[data-code-object-id], [data-test-id="code-object-design-hit-target"]')
  })
})
