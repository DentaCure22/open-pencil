import { describe, expect, test } from 'bun:test'

import {
  resolveSnapshotSource,
  SMYLR_LIVE_FRAME_SNAPSHOT_CACHE_NAMESPACE
} from '@/app/smylr-production/live/snapshot-fallback'

describe('Smylr snapshot fallback', () => {
  test('uses a new cache namespace for source-backed frame snapshots', () => {
    expect(SMYLR_LIVE_FRAME_SNAPSHOT_CACHE_NAMESPACE).toBe('smylr-live-frame-snapshot/v5')
  })

  test('prefers a sharp persisted preview over cached or capture sources', () => {
    expect(
      resolveSnapshotSource({
        cachedSnapshot: 'cached',
        captureSrc: '/smylr-flow-captures/calendar.png',
        sharpPersistedPreview: 'persisted'
      })
    ).toBe('persisted')
  })

  test('uses the cached snapshot before the source capture', () => {
    expect(
      resolveSnapshotSource({
        cachedSnapshot: 'cached',
        captureSrc: '/smylr-flow-captures/calendar.png'
      })
    ).toBe('cached')
  })

  test('uses captureSrc only when no persisted or cached snapshot exists', () => {
    expect(resolveSnapshotSource({ captureSrc: '/smylr-flow-captures/calendar.png' })).toBe(
      '/smylr-flow-captures/calendar.png'
    )
    expect(resolveSnapshotSource({})).toBeNull()
  })

  test('does not use a static capture source for source-only runtime previews', () => {
    expect(
      resolveSnapshotSource({
        captureSrc: '/smylr-flow-captures/calendar.png',
        policy: 'source-only'
      })
    ).toBeNull()
  })
})
