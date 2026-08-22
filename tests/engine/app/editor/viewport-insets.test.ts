import { afterEach, describe, expect, test } from 'bun:test'

import { editorViewportInsets } from '@/app/editor/viewport-insets'

type RectFixture = Pick<DOMRect, 'bottom' | 'height' | 'left' | 'right' | 'top' | 'width'>

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')

afterEach(() => {
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

function installDocument(rects: Partial<Record<string, RectFixture>>) {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector(selector: string) {
        const rect = rects[selector]
        return rect ? { getBoundingClientRect: () => rect } : null
      }
    }
  })
}

function rect(left: number, top: number, width: number, height: number): RectFixture {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width
  }
}

describe('editor viewport insets', () => {
  test('keeps fitted content clear of desktop panels and the mobile drawer', () => {
    installDocument({
      '[data-test-id="canvas-area"]': rect(100, 50, 1000, 700),
      '[data-test-id="layers-shell"]': rect(112, 62, 220, 676),
      '[data-test-id="mobile-drawer"]': rect(100, 620, 1000, 130),
      '[data-test-id="properties-panel"]': rect(870, 62, 218, 676),
      '[data-test-id="toolbar"]': rect(450, 64, 300, 42)
    })

    expect(editorViewportInsets()).toEqual({
      bottom: 144,
      left: 246,
      right: 244,
      top: 70
    })
  })
})
