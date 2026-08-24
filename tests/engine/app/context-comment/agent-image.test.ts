import { describe, expect, test } from 'bun:test'

import { readImagePreviewSize } from '@/app/context-comment/agent-image'

describe('agent image preview size', () => {
  test('prefers a decoded preview and falls back to known snapshot dimensions', async () => {
    await expect(readImagePreviewSize({ naturalHeight: 180, naturalWidth: 320 })).resolves.toEqual({
      height: 180,
      width: 320
    })

    await expect(
      readImagePreviewSize(
        {
          decode: async () => undefined,
          naturalHeight: 0,
          naturalWidth: 0
        },
        { height: 180, width: 320 }
      )
    ).resolves.toEqual({ height: 180, width: 320 })

    await expect(readImagePreviewSize({ naturalHeight: 0, naturalWidth: 0 })).rejects.toThrow(
      'The image preview is not ready yet.'
    )
  })
})
