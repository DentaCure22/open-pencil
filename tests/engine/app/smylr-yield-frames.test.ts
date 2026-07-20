import { afterEach, describe, expect, test } from 'bun:test'

import { yieldAnimationFrames } from '@/app/smylr-production/yield-frames'

const originalRequestAnimationFrame = globalThis.requestAnimationFrame

afterEach(() => {
  if (originalRequestAnimationFrame) globalThis.requestAnimationFrame = originalRequestAnimationFrame
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
})

describe('background-safe animation frame settling', () => {
  test('falls back when a backgrounded browser does not deliver animation frames', async () => {
    globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame
    const startedAt = performance.now()
    await yieldAnimationFrames(2, 20)
    expect(performance.now() - startedAt).toBeLessThan(200)
  })

  test('finishes immediately outside a browser animation runtime', async () => {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    await expect(yieldAnimationFrames(2)).resolves.toBeUndefined()
  })
})
