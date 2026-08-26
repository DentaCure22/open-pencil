import { expect, test } from 'bun:test'

import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  formatCanvasZoomPercent,
  steppedCanvasZoom
} from '@/app/editor/canvas/zoom'

test('canvas zoom buttons step by 25% and clamp', () => {
  expect(steppedCanvasZoom(1, 1)).toBe(1.25)
  expect(steppedCanvasZoom(1, -1)).toBe(0.8)
  expect(steppedCanvasZoom(CANVAS_ZOOM_MAX, 1)).toBe(CANVAS_ZOOM_MAX)
  expect(steppedCanvasZoom(CANVAS_ZOOM_MIN, -1)).toBe(CANVAS_ZOOM_MIN)
})

test('canvas zoom percent is a rounded whole number', () => {
  expect(formatCanvasZoomPercent(0.347)).toBe('35%')
  expect(formatCanvasZoomPercent(1)).toBe('100%')
  expect(formatCanvasZoomPercent(1.5)).toBe('150%')
})

test('editor chrome mounts plus, minus, and percent zoom controls', async () => {
  const [editor, controls] = await Promise.all([
    Bun.file('src/views/EditorView.vue').text(),
    Bun.file('src/components/canvas/CanvasZoomControls.vue').text()
  ])
  expect(editor).toContain('<CanvasZoomControls v-if="showChrome" />')
  expect(controls).toContain('data-test-id="canvas-zoom-out"')
  expect(controls).toContain('data-test-id="canvas-zoom-percent"')
  expect(controls).toContain('data-test-id="canvas-zoom-in"')
})
