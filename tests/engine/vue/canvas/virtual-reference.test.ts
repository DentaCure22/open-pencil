import { afterAll, beforeAll, expect, test } from 'bun:test'

import { computed, ref } from 'vue'

import { useCanvasVirtualReference } from '@open-pencil/vue'

class TestDOMRect implements DOMRect {
  bottom: number
  left: number
  right: number
  top: number

  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0
  ) {
    this.bottom = y + height
    this.left = x
    this.right = x + width
    this.top = y
  }

  static fromRect(rect: DOMRectInit = {}) {
    return new TestDOMRect(rect.x, rect.y, rect.width, rect.height)
  }

  toJSON() {
    return {
      bottom: this.bottom,
      height: this.height,
      left: this.left,
      right: this.right,
      top: this.top,
      width: this.width,
      x: this.x,
      y: this.y
    }
  }
}

const originalDOMRect = globalThis.DOMRect

beforeAll(() => {
  globalThis.DOMRect = TestDOMRect
})

afterAll(() => {
  globalThis.DOMRect = originalDOMRect
})

test('projects a canvas anchor from the shared presentation viewport snapshot', () => {
  const canvas = {
    getBoundingClientRect: () => new DOMRect(10, 20, 800, 600)
  } as HTMLElement
  const canvasRef = ref<HTMLElement | null>(canvas)
  const anchor = computed(() => ({ x: 50, y: 30 }))
  const viewport = ref({ panX: 5, panY: -10, zoom: 2 })
  const reference = useCanvasVirtualReference(canvasRef, anchor, viewport)

  expect(reference.value?.getBoundingClientRect()).toMatchObject({ x: 115, y: 70 })

  viewport.value = { panX: 45, panY: 15, zoom: 1.5 }

  expect(reference.value?.getBoundingClientRect()).toMatchObject({ x: 130, y: 80 })
})
