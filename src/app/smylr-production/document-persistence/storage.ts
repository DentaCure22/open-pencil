import { readCacheJson, readCacheValue } from '@/app/cache'

import {
  assembleIncrementalSmylrProductionDocument,
  INCREMENTAL_CACHE_VERSION,
  INCREMENTAL_MANIFEST_JSON_KEY,
  INCREMENTAL_MANIFEST_KEY,
  type CachedSmylrProductionDocument,
  type IncrementalSmylrProductionBoardRef,
  type IncrementalSmylrProductionBoardSnapshot,
  type IncrementalSmylrProductionManifest
} from './plan'

export type LoadedIncrementalSmylrProductionDocument = {
  cached: CachedSmylrProductionDocument
  manifest: IncrementalSmylrProductionManifest
}

function isIncrementalManifest(value: unknown): value is IncrementalSmylrProductionManifest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IncrementalSmylrProductionManifest>
  return Boolean(
    candidate.version === INCREMENTAL_CACHE_VERSION &&
    typeof candidate.generation === 'number' &&
    typeof candidate.rootId === 'string' &&
    candidate.rootNode &&
    typeof candidate.rootNode === 'object' &&
    Array.isArray(candidate.boardRefs) &&
    candidate.boardRefs.every(
      (ref) =>
        typeof ref.boardId === 'string' &&
        typeof ref.key === 'string' &&
        typeof ref.nodeCount === 'number' &&
        typeof ref.revision === 'number'
    ) &&
    Array.isArray(candidate.variables) &&
    Array.isArray(candidate.variableCollections) &&
    Array.isArray(candidate.activeMode)
  )
}

function isIncrementalBoardSnapshot(
  value: unknown
): value is IncrementalSmylrProductionBoardSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<IncrementalSmylrProductionBoardSnapshot>
  return Boolean(
    candidate.version === INCREMENTAL_CACHE_VERSION &&
    typeof candidate.boardId === 'string' &&
    typeof candidate.revision === 'number' &&
    Array.isArray(candidate.nodes)
  )
}

function isImageEntries(value: unknown): value is Array<[string, Uint8Array]> {
  return Boolean(
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[1] instanceof Uint8Array
    )
  )
}

async function readIncrementalManifest() {
  const cached = await readCacheValue<unknown>(INCREMENTAL_MANIFEST_KEY)
  if (isIncrementalManifest(cached)) return cached
  const fallback = await readCacheJson<unknown>(INCREMENTAL_MANIFEST_JSON_KEY)
  return isIncrementalManifest(fallback) ? fallback : null
}

async function readIncrementalBoardSnapshot(ref: IncrementalSmylrProductionBoardRef) {
  let cached = await readCacheValue<unknown>(ref.key)
  if (!isIncrementalBoardSnapshot(cached)) cached = await readCacheJson<unknown>(ref.key)
  if (
    !isIncrementalBoardSnapshot(cached) ||
    cached.boardId !== ref.boardId ||
    cached.revision !== ref.revision ||
    cached.nodes.length !== ref.nodeCount
  ) {
    return null
  }
  return cached
}

export async function loadIncrementalSmylrProductionDocument(
  cacheVersion: number
): Promise<LoadedIncrementalSmylrProductionDocument | null> {
  const manifest = await readIncrementalManifest()
  if (!manifest) return null

  const snapshots: IncrementalSmylrProductionBoardSnapshot[] = []
  const batchSize = 8
  for (let index = 0; index < manifest.boardRefs.length; index += batchSize) {
    const refs = manifest.boardRefs.slice(index, index + batchSize)
    const batch = await Promise.all(refs.map(readIncrementalBoardSnapshot))
    if (batch.some((snapshot) => snapshot === null)) return null
    for (const snapshot of batch) {
      if (snapshot) snapshots.push(snapshot)
    }
  }

  let images: Array<[string, Uint8Array]> = []
  if (manifest.assetRef) {
    const cachedImages = await readCacheValue<unknown>(manifest.assetRef.key)
    if (!isImageEntries(cachedImages)) return null
    images = cachedImages
  }
  const cached = assembleIncrementalSmylrProductionDocument(
    manifest,
    snapshots,
    images,
    cacheVersion
  )
  return cached ? { cached, manifest } : null
}
