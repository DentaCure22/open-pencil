import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { antigravityToolImages } from '#mcp/pi/antigravity-activity'

describe('Antigravity image activity', () => {
  test('attaches an edited image returned as a singular result path', () => {
    const imagePath = resolve('packages/demos/videos/toolbar.png')
    const images = antigravityToolImages(
      'ima2-media_edit_image',
      JSON.stringify({ result: { ok: true, path: imagePath }, status: 'completed' })
    )

    expect(images).toEqual([
      { alt: 'ima2-media_edit_image image', url: expect.stringContaining('data:image/png;base64,') }
    ])
  })
})
