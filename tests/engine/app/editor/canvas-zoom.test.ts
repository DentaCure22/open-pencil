import { expect, test } from 'bun:test'

test('editor chrome omits the floating zoom controls', async () => {
  const editor = await Bun.file('src/views/EditorView.vue').text()
  expect(editor).not.toContain('CanvasZoomControls')
  expect(editor).not.toContain('canvas-zoom-controls')
})
