import { IS_BROWSER, IS_TAURI } from '@open-pencil/core/constants'

const APP_CACHE_DIR = 'cache/v1'
const STORAGE_PREFIX = 'open-pencil:cache:v1:'
const BINARY_CACHE_DB = 'open-pencil-cache-v1'
const BINARY_CACHE_STORE = 'binary-entries'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function isTauriRuntime() {
  return IS_TAURI || ('window' in globalThis && '__TAURI_INTERNALS__' in window)
}

function isStorageAvailable() {
  return 'window' in globalThis && !!window.localStorage
}

function isIndexedDbAvailable() {
  return 'window' in globalThis && !!window.indexedDB
}

function openBinaryCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(BINARY_CACHE_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BINARY_CACHE_STORE)) {
        request.result.createObjectStore(BINARY_CACHE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

async function readIndexedDbValue<T>(key: string): Promise<T | null> {
  const db = await openBinaryCacheDb()
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(BINARY_CACHE_STORE, 'readonly')
        .objectStore(BINARY_CACHE_STORE)
        .get(key)
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
    })
  } finally {
    db.close()
  }
}

async function writeIndexedDbValue(key: string, value: unknown): Promise<void> {
  const db = await openBinaryCacheDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(BINARY_CACHE_STORE, 'readwrite')
        .objectStore(BINARY_CACHE_STORE)
        .put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
    })
  } finally {
    db.close()
  }
}

async function removeIndexedDbEntry(key: string): Promise<void> {
  const db = await openBinaryCacheDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(BINARY_CACHE_STORE, 'readwrite')
        .objectStore(BINARY_CACHE_STORE)
        .delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'))
    })
  } finally {
    db.close()
  }
}

async function removeIndexedDbPrefix(prefix: string): Promise<void> {
  const db = await openBinaryCacheDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(BINARY_CACHE_STORE, 'readwrite')
        .objectStore(BINARY_CACHE_STORE)
        .openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve()
          return
        }
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) cursor.delete()
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'))
    })
  } finally {
    db.close()
  }
}

function cachePath(key: string) {
  return `${APP_CACHE_DIR}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`
}

export function readSessionCacheText(key: string): string | null {
  if (!IS_BROWSER) return null
  try {
    return window.sessionStorage.getItem(storageKey(key))
  } catch {
    return null
  }
}

export function writeSessionCacheText(key: string, value: string): boolean {
  if (!IS_BROWSER) return false
  try {
    window.sessionStorage.setItem(storageKey(key), value)
    return true
  } catch {
    return false
  }
}

/** localStorage is typically ~5MB per origin; image payloads blow past that quickly. */
const LOCAL_STORAGE_JSON_SOFT_LIMIT = 64_000

function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22
    )
  }
  return error instanceof Error && /quota/i.test(error.message)
}

function removeLocalStorageCacheKey(key: string) {
  if (!isStorageAvailable()) return
  try {
    window.localStorage.removeItem(storageKey(key))
  } catch (error) {
    console.warn(`Local storage cache cleanup skipped for "${key}":`, error)
  }
}

export async function readCacheText(key: string): Promise<string | null> {
  // Prefer the webview-local copy when it exists. Embedded browsers can expose a
  // host app's Tauri globals even though this page is an ordinary HTTP origin.
  const storedValue = isStorageAvailable() ? window.localStorage.getItem(storageKey(key)) : null
  if (storedValue !== null) return storedValue

  if (isTauriRuntime()) {
    try {
      const { BaseDirectory, readFile } = await import('@tauri-apps/plugin-fs')
      return textDecoder.decode(
        await readFile(cachePath(key), { baseDir: BaseDirectory.AppLocalData })
      )
    } catch {
      return null
    }
  }

  return null
}

export async function writeCacheText(key: string, value: string): Promise<void> {
  // Mirror synchronously to localStorage first. This keeps web drafts durable
  // across immediate reloads and provides a safe fallback in embedded webviews.
  let wroteLocalStorage = false
  if (isStorageAvailable()) {
    try {
      window.localStorage.setItem(storageKey(key), value)
      wroteLocalStorage = true
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error
      // Caller (writeCacheJson) may fall back to IndexedDB.
      if (!isTauriRuntime()) throw error
    }
  }

  if (isTauriRuntime()) {
    try {
      const { BaseDirectory, mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
      await mkdir(APP_CACHE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
      await writeFile(cachePath(key), textEncoder.encode(value), {
        baseDir: BaseDirectory.AppLocalData
      })
    } catch (error) {
      if (!wroteLocalStorage) throw error
    }
  }
}

export async function removeCacheEntry(key: string): Promise<void> {
  if (isStorageAvailable()) window.localStorage.removeItem(storageKey(key))
  if (isIndexedDbAvailable()) {
    try {
      await removeIndexedDbEntry(key)
    } catch (error) {
      console.warn(`IndexedDB cache delete skipped for "${key}":`, error)
    }
  }
  if (isTauriRuntime()) {
    try {
      const { BaseDirectory, remove } = await import('@tauri-apps/plugin-fs')
      await remove(cachePath(key), { baseDir: BaseDirectory.AppLocalData })
    } catch (error) {
      console.warn(`Cache delete skipped for "${key}":`, error)
    }
  }
}

export async function readCacheBytes(key: string): Promise<ArrayBuffer | null> {
  if (isIndexedDbAvailable()) {
    try {
      const value = await readIndexedDbValue<unknown>(key)
      if (value instanceof ArrayBuffer) return value
    } catch (error) {
      console.warn(`IndexedDB cache read skipped for "${key}":`, error)
    }
  }

  if (!isTauriRuntime()) return null

  try {
    const { BaseDirectory, readFile } = await import('@tauri-apps/plugin-fs')
    const data = await readFile(cachePath(key), { baseDir: BaseDirectory.AppLocalData })
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  } catch {
    return null
  }
}

export async function writeCacheBytes(key: string, value: ArrayBuffer): Promise<void> {
  let wroteBrowserCache = false
  if (isIndexedDbAvailable()) {
    try {
      await writeIndexedDbValue(key, value)
      wroteBrowserCache = true
    } catch (error) {
      console.warn(`IndexedDB cache write skipped for "${key}":`, error)
    }
  }

  if (!isTauriRuntime()) return

  try {
    const { BaseDirectory, mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
    await mkdir(APP_CACHE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
    await writeFile(cachePath(key), new Uint8Array(value), { baseDir: BaseDirectory.AppLocalData })
  } catch (error) {
    if (!wroteBrowserCache) throw error
  }
}

export async function readCacheValue<T>(key: string): Promise<T | null> {
  if (!isIndexedDbAvailable()) return null
  try {
    return await readIndexedDbValue<T>(key)
  } catch (error) {
    console.warn(`IndexedDB cache read skipped for "${key}":`, error)
    return null
  }
}

export async function writeCacheValue(key: string, value: unknown): Promise<void> {
  if (!isIndexedDbAvailable()) return
  try {
    await writeIndexedDbValue(key, value)
  } catch (error) {
    console.warn(`IndexedDB cache write skipped for "${key}":`, error)
    throw error
  }
}

export async function tryWriteCacheValue(key: string, value: unknown): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false
  try {
    await writeIndexedDbValue(key, value)
    return true
  } catch (error) {
    console.warn(`IndexedDB cache write skipped for "${key}":`, error)
    return false
  }
}

export async function removeCachePrefix(prefix: string): Promise<void> {
  if (isStorageAvailable()) {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(storageKey(prefix))) window.localStorage.removeItem(key)
    }
  }
  if (isIndexedDbAvailable()) {
    try {
      await removeIndexedDbPrefix(prefix)
    } catch (error) {
      console.warn(`IndexedDB cache prefix delete skipped for "${prefix}":`, error)
    }
  }
  if (isTauriRuntime()) {
    try {
      const { BaseDirectory, remove } = await import('@tauri-apps/plugin-fs')
      await remove(cachePath(prefix), { baseDir: BaseDirectory.AppLocalData, recursive: true })
    } catch (error) {
      console.warn(`Cache prefix delete skipped for "${prefix}":`, error)
    }
  }
}

type JsonCacheEnvelope<T> = {
  updatedAt: number
  value: T
}

function parseJsonEnvelope<T>(raw: string, maxAgeMs?: number): JsonCacheEnvelope<T> | null {
  try {
    const envelope = JSON.parse(raw) as Partial<JsonCacheEnvelope<T>>
    if (typeof envelope.updatedAt !== 'number' || !('value' in envelope)) return null
    if (maxAgeMs !== undefined && Date.now() - envelope.updatedAt > maxAgeMs) return null
    return { updatedAt: envelope.updatedAt, value: envelope.value as T }
  } catch {
    return null
  }
}

function coerceIndexedDbJsonValue<T>(
  stored: unknown,
  maxAgeMs?: number
): JsonCacheEnvelope<T> | null {
  // Envelope written by writeCacheJson / migrate helpers.
  if (stored && typeof stored === 'object' && 'value' in stored) {
    const envelope = stored as Partial<JsonCacheEnvelope<T>>
    if (typeof envelope.updatedAt === 'number') {
      if (maxAgeMs !== undefined && Date.now() - envelope.updatedAt > maxAgeMs) return null
      return { updatedAt: envelope.updatedAt, value: envelope.value as T }
    }
    // Partial / legacy object that still carries the value.
    return { updatedAt: 0, value: envelope.value as T }
  }
  // Raw data URL string written by some snapshot paths.
  if (typeof stored === 'string') return { updatedAt: 0, value: stored as T }
  return null
}

async function readIndexedDbJsonEnvelope<T>(
  key: string,
  maxAgeMs?: number
): Promise<JsonCacheEnvelope<T> | null> {
  if (!isIndexedDbAvailable()) return null
  try {
    const stored = await readIndexedDbValue<unknown>(key)
    return coerceIndexedDbJsonValue<T>(stored, maxAgeMs)
  } catch (error) {
    console.warn(`IndexedDB cache read skipped for "${key}":`, error)
    return null
  }
}

export async function readCacheJson<T>(key: string, maxAgeMs?: number): Promise<T | null> {
  // Compare both browser stores. A quota fallback can leave an older IndexedDB
  // envelope behind after later metadata-only writes return to localStorage.
  // Always choosing IndexedDB would resurrect that stale workspace on refresh.
  const fromIdb = await readIndexedDbJsonEnvelope<T>(key, maxAgeMs)
  const raw = await readCacheText(key)
  let fromText: JsonCacheEnvelope<T> | null = null
  if (raw) {
    fromText = parseJsonEnvelope<T>(raw, maxAgeMs)
    // Bare data URL persisted without an envelope.
    if (!fromText && raw.startsWith('data:')) fromText = { updatedAt: 0, value: raw as T }
  }

  if (!fromIdb) return fromText?.value ?? null
  if (!fromText) return fromIdb.value
  return (fromText.updatedAt >= fromIdb.updatedAt ? fromText : fromIdb).value
}

export async function writeCacheJson(key: string, value: unknown): Promise<void> {
  const envelope: JsonCacheEnvelope<unknown> = { updatedAt: Date.now(), value }
  const payload = JSON.stringify(envelope)
  const preferIndexedDb =
    payload.length >= LOCAL_STORAGE_JSON_SOFT_LIMIT ||
    (typeof value === 'string' && value.startsWith('data:image'))

  // Image payloads always go to IndexedDB — localStorage quota cannot hold them.
  if (preferIndexedDb && isIndexedDbAvailable()) {
    await writeIndexedDbValue(key, envelope)
    removeLocalStorageCacheKey(key)
    return
  }

  try {
    await writeCacheText(key, payload)
  } catch (error) {
    if (isQuotaExceededError(error) && isIndexedDbAvailable()) {
      await writeIndexedDbValue(key, envelope)
      removeLocalStorageCacheKey(key)
      return
    }
    throw error
  }
}
