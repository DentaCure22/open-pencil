/**
 * Durable record of live frames the user deleted from the production workspace.
 * Kept free of workspace.ts imports to avoid circular deps.
 */
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { readCacheJson, writeCacheJson } from '@/app/cache'

const TOMBSTONE_CACHE_KEY = 'smylr-production/deleted-live-frames-v1'
const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'

export type LiveFrameTombstone = {
  pageId: string
  route: string
  state: string
  workspaceItemId?: string
}

let tombstones: LiveFrameTombstone[] = []
let tombstonesLoaded = false
let tombstoneLoad: Promise<void> | null = null

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

export function isLiveAppFrameNode(node: SceneNode | null | undefined): boolean {
  return Boolean(node && pluginValue(node, 'kind') === LIVE_APP_KIND)
}

export function identityKey(
  t: Pick<LiveFrameTombstone, 'pageId' | 'route' | 'state' | 'workspaceItemId'>
) {
  if (t.workspaceItemId) return `item:${t.workspaceItemId}`
  return `frame:${t.pageId}|${t.route}|${t.state}`
}

export function tombstoneForNode(node: SceneNode): LiveFrameTombstone | null {
  if (!isLiveAppFrameNode(node)) return null
  return {
    pageId: pluginValue(node, 'pageId') ?? '',
    route: pluginValue(node, 'route') ?? '',
    state: pluginValue(node, 'state') ?? 'current',
    workspaceItemId: pluginValue(node, 'workspaceItemId') ?? undefined
  }
}

export function matchesTombstone(node: SceneNode, tombstone: LiveFrameTombstone): boolean {
  if (!isLiveAppFrameNode(node)) return false
  if (tombstone.workspaceItemId) {
    return pluginValue(node, 'workspaceItemId') === tombstone.workspaceItemId
  }
  return (
    (pluginValue(node, 'pageId') ?? '') === tombstone.pageId &&
    (pluginValue(node, 'route') ?? '') === tombstone.route &&
    (pluginValue(node, 'state') ?? 'current') === tombstone.state
  )
}

async function ensureTombstonesLoaded() {
  if (tombstonesLoaded) return
  if (!tombstoneLoad) {
    tombstoneLoad = (async () => {
      const restored = (await readCacheJson<LiveFrameTombstone[]>(TOMBSTONE_CACHE_KEY)) ?? []
      const fromDisk = Array.isArray(restored) ? restored : []
      // Merge — never clobber tombstones recorded before the async load finished.
      const byKey = new Map<string, LiveFrameTombstone>()
      for (const t of fromDisk) byKey.set(identityKey(t), t)
      for (const t of tombstones) byKey.set(identityKey(t), t)
      tombstones = [...byKey.values()]
      tombstonesLoaded = true
      if (tombstones.length > 0) persistTombstones()
    })().catch(() => {
      tombstonesLoaded = true
    })
  }
  await tombstoneLoad
}

function persistTombstones() {
  void writeCacheJson(TOMBSTONE_CACHE_KEY, tombstones)
}

export async function loadLiveFrameTombstones() {
  await ensureTombstonesLoaded()
  return tombstones
}

export function isLiveFrameTombstoned(node: SceneNode): boolean {
  const id = tombstoneForNode(node)
  if (!id) return false
  const key = identityKey(id)
  return tombstones.some((t) => identityKey(t) === key)
}

export function isWorkspaceItemTombstoned(itemId: string): boolean {
  return tombstones.some((t) => t.workspaceItemId === itemId)
}

export function addLiveFrameTombstone(tombstone: LiveFrameTombstone) {
  const key = identityKey(tombstone)
  if (tombstones.some((t) => identityKey(t) === key)) return
  tombstones = [...tombstones, tombstone]
  persistTombstones()
}

export function clearLiveFrameTombstones() {
  tombstones = []
  persistTombstones()
}

/** Drop any live frames the user previously deleted (seed / restore safe). */
export function applyLiveFrameTombstones(graph: SceneGraph): number {
  if (tombstones.length === 0) return 0
  const doomed: string[] = []
  for (const node of graph.getAllNodes()) {
    if (!isLiveAppFrameNode(node)) continue
    if (tombstones.some((t) => matchesTombstone(node, t))) doomed.push(node.id)
  }
  let removed = 0
  for (const id of doomed) {
    try {
      graph.deleteNode(id)
      removed += 1
    } catch {
      /* ignore */
    }
  }
  return removed
}
