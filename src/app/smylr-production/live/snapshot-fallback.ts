type SnapshotSource = string | null | undefined

export type SnapshotFallbackPolicy = 'legacy-capture' | 'source-only'

export const SMYLR_LIVE_FRAME_SNAPSHOT_CACHE_NAMESPACE = 'smylr-live-frame-snapshot/v5'

export function resolveSnapshotSource({
  cachedSnapshot,
  captureSrc,
  sharpPersistedPreview,
  policy = 'legacy-capture'
}: {
  cachedSnapshot?: SnapshotSource
  captureSrc?: SnapshotSource
  policy?: SnapshotFallbackPolicy
  sharpPersistedPreview?: SnapshotSource
}): string | null {
  return (
    sharpPersistedPreview ??
    cachedSnapshot ??
    (policy === 'source-only' ? null : captureSrc) ??
    null
  )
}
