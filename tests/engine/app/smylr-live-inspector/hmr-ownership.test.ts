import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  liveInspectorReloadTickFor,
  reloadLiveInspectorFrame
} from '@/app/smylr-live-inspector/session'

const root = resolve(import.meta.dir, '../../../..')

describe('Smylr iframe HMR ownership', () => {
  test('leaves the Next dev-server connection exclusively to the embedded app', () => {
    const trustedWebApp = readFileSync(
      resolve(root, 'src/components/code-object/SmylrTrustedWebApp.vue'),
      'utf8'
    )

    expect(trustedWebApp).not.toContain('dev-server-watchdog')
    expect(trustedWebApp).not.toContain('acquireSmylrDevServerWatch')
    expect(trustedWebApp).not.toContain('/_next/hmr')
    expect(trustedWebApp).not.toContain('new WebSocket')
  })

  test('targets explicit reloads to one resident frame', () => {
    const firstFrameId = 'hmr-frame-a'
    const secondFrameId = 'hmr-frame-b'

    expect(reloadLiveInspectorFrame(firstFrameId)).toBe(true)
    expect(liveInspectorReloadTickFor(firstFrameId)).toBe(1)
    expect(liveInspectorReloadTickFor(secondFrameId)).toBe(0)

    expect(reloadLiveInspectorFrame(secondFrameId)).toBe(true)
    expect(liveInspectorReloadTickFor(firstFrameId)).toBe(1)
    expect(liveInspectorReloadTickFor(secondFrameId)).toBe(1)
  })
})
