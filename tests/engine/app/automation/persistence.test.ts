import { describe, expect, test } from 'bun:test'

import {
  bindAutomationPersistence,
  requestAutomationPersistence
} from '@/app/automation/bridge/persistence'
import { createEditorStore } from '@/app/editor/session'

describe('automation persistence acknowledgement', () => {
  test('returns the exact durable authority acknowledgement', async () => {
    const store = createEditorStore()
    bindAutomationPersistence(store, (requestedSceneRevision) => {
      expect(requestedSceneRevision).toBe(17)
      return Promise.resolve({
        authority_id: 'authority:test',
        authority_revision: 42,
        content_hash: 'sha256:test',
        status: 'durable',
        target: 'local_workspace_authority'
      })
    })

    await expect(requestAutomationPersistence(store, 17, 50)).resolves.toMatchObject({
      authority_id: 'authority:test',
      authority_revision: 42,
      content_hash: 'sha256:test',
      requested_scene_revision: 17,
      status: 'durable',
      target: 'local_workspace_authority'
    })
  })

  test('returns unknown before the RPC deadline when persistence stalls', async () => {
    const store = createEditorStore()
    bindAutomationPersistence(
      store,
      () =>
        new Promise(() => {
          // Deliberately unresolved to exercise the bounded timeout.
        })
    )
    const startedAt = performance.now()

    const result = await requestAutomationPersistence(store, 9, 15)

    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(result).toMatchObject({
      reason: 'persistence_timeout',
      requested_scene_revision: 9,
      status: 'unknown'
    })
  })

  test('keeps a newer HMR binding when a stale owner releases', async () => {
    const store = createEditorStore()
    const releaseOld = bindAutomationPersistence(store, () =>
      Promise.resolve({ reason: 'save_not_acknowledged', status: 'unknown' })
    )
    bindAutomationPersistence(store, () =>
      Promise.resolve({ status: 'durable', target: 'browser_local' })
    )

    releaseOld()

    await expect(requestAutomationPersistence(store, 4, 50)).resolves.toMatchObject({
      requested_scene_revision: 4,
      status: 'durable',
      target: 'browser_local'
    })
  })

  test('reports an unavailable binding and a rejected save honestly', async () => {
    const unbound = createEditorStore()
    await expect(requestAutomationPersistence(unbound, 3, 50)).resolves.toMatchObject({
      reason: 'persistence_unavailable',
      status: 'unknown'
    })

    const rejected = createEditorStore()
    bindAutomationPersistence(rejected, () => Promise.reject(new Error('authority offline')))
    await expect(requestAutomationPersistence(rejected, 5, 50)).resolves.toMatchObject({
      reason: 'persistence_failed',
      status: 'unknown'
    })
  })
})
