import { describe, expect, test } from 'bun:test'

import { resolveBrowserAssetPath } from '#core/browser-assets'

describe('browser asset paths', () => {
  test('recovers the OpenPencil mount path when Vite runs with a root base', () => {
    expect(resolveBrowserAssetPath('canvaskit.wasm', '/', '/open-pencil')).toBe(
      '/open-pencil/canvaskit.wasm'
    )
    expect(resolveBrowserAssetPath('/Inter-Regular.ttf', '/', '/open-pencil/board')).toBe(
      '/open-pencil/Inter-Regular.ttf'
    )
  })

  test('preserves configured and root asset bases', () => {
    expect(resolveBrowserAssetPath('canvaskit.wasm', '/open-pencil/', '/open-pencil')).toBe(
      '/open-pencil/canvaskit.wasm'
    )
    expect(resolveBrowserAssetPath('canvaskit.wasm', '/', '/')).toBe('/canvaskit.wasm')
  })
})
