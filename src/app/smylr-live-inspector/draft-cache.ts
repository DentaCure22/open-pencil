import { readCacheJson, writeCacheJson } from '../cache'
import type { LiveInspectorPatchDraft } from './patch'

const LAST_DRAFT_CACHE_KEY = 'smylr-live-overrides/current-route'

type CachedLiveInspectorDrafts = {
  entries: Array<[string, LiveInspectorPatchDraft]>
  route: string
}

function draftCacheKey(route: string) {
  return `smylr-live-overrides/${privacySafeLiveInspectorRoute(route)}`
}

export function privacySafeLiveInspectorRoute(route: string) {
  try {
    return new URL(route, 'https://smylr.invalid').pathname || '/'
  } catch {
    const path = route.split('#', 1)[0]?.split('?', 1)[0]?.trim() ?? ''
    return path.startsWith('/') ? path : `/${path}`
  }
}

export async function readLiveInspectorDraftCache(route: string) {
  const entries = await readCacheJson<Array<[string, LiveInspectorPatchDraft]>>(
    draftCacheKey(route)
  )
  if (entries) return entries

  const fallback = await readCacheJson<CachedLiveInspectorDrafts>(LAST_DRAFT_CACHE_KEY)
  return fallback?.route === privacySafeLiveInspectorRoute(route) ? fallback.entries : null
}

export async function writeLiveInspectorDraftCache(
  route: string,
  drafts: ReadonlyMap<string, LiveInspectorPatchDraft>
) {
  const entries = [...drafts.entries()]
  // Every accepted draft is durable for the canvas session; there is no Save gate.
  await Promise.all([
    writeCacheJson(draftCacheKey(route), entries),
    writeCacheJson(LAST_DRAFT_CACHE_KEY, {
      entries,
      route: privacySafeLiveInspectorRoute(route)
    } satisfies CachedLiveInspectorDrafts)
  ])
}
