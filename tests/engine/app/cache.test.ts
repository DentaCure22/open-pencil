import { afterEach, describe, expect, test } from 'bun:test'

function installLocalStorage() {
  const data = new Map<string, string>()
  const storage = {
    get length() {
      return data.size
    },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null
  } satisfies Pick<Storage, 'length' | 'getItem' | 'setItem' | 'removeItem' | 'key'>

  const storageProp = ['local', 'Storage'].join('')
  Object.assign(globalThis, { window: Object.fromEntries([[storageProp, storage]]) })
  return data
}

function installIndexedDb() {
  const data = new Map<IDBValidKey, unknown>()

  function requestFor<T>(operation: () => T) {
    const request = {
      error: null as DOMException | null,
      onerror: null as ((event: Event) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      result: undefined as T
    }
    queueMicrotask(() => {
      try {
        request.result = operation()
        request.onsuccess?.(new Event('success'))
      } catch (error) {
        request.error = error instanceof DOMException ? error : new DOMException(String(error))
        request.onerror?.(new Event('error'))
      }
    })
    return request as unknown as IDBRequest<T>
  }

  const store = {
    delete: (key: IDBValidKey) => requestFor(() => data.delete(key)),
    get: (key: IDBValidKey) => requestFor(() => data.get(key)),
    put: (value: unknown, key: IDBValidKey) =>
      requestFor(() => {
        data.set(key, value)
        return key
      })
  }
  const database = {
    close: () => undefined,
    createObjectStore: () => store,
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store })
  } as unknown as IDBDatabase
  const indexedDB = {
    open: () => {
      const request = {
        error: null as DOMException | null,
        onerror: null as ((event: Event) => void) | null,
        onsuccess: null as ((event: Event) => void) | null,
        onupgradeneeded: null as ((event: Event) => void) | null,
        result: database
      }
      queueMicrotask(() => request.onsuccess?.(new Event('success')))
      return request as unknown as IDBOpenDBRequest
    }
  } as Pick<IDBFactory, 'open'>

  Object.assign(window, { indexedDB })
  return data
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('app cache', () => {
  test('stores text in the web cache namespace', async () => {
    const storage = installLocalStorage()
    const { readCacheText, writeCacheText } = await import('@/app/cache')

    await writeCacheText('providers/models', 'cached')

    expect(storage.get('open-pencil:cache:v1:providers/models')).toBe('cached')
    await expect(readCacheText('providers/models')).resolves.toBe('cached')
  })

  test('expires JSON values by max age', async () => {
    installLocalStorage()
    const { readCacheJson, writeCacheJson } = await import('@/app/cache')

    await writeCacheJson('json/key', { ok: true })

    await expect(readCacheJson('json/key', 60_000)).resolves.toEqual({ ok: true })
    await expect(readCacheJson('json/key', -1)).resolves.toBeNull()
  })

  test('uses the newest JSON envelope when localStorage and IndexedDB disagree', async () => {
    const storage = installLocalStorage()
    const indexedDb = installIndexedDb()
    const { readCacheJson } = await import('@/app/cache')
    const logicalKey = 'smylr-live-workspaces/v1'
    const storageKey = `open-pencil:cache:v1:${logicalKey}`

    indexedDb.set(logicalKey, { updatedAt: 100, value: { version: 'stale-idb' } })
    storage.set(storageKey, JSON.stringify({ updatedAt: 200, value: { version: 'fresh-local' } }))
    await expect(readCacheJson(logicalKey)).resolves.toEqual({ version: 'fresh-local' })

    indexedDb.set(logicalKey, { updatedAt: 300, value: { version: 'fresh-idb' } })
    await expect(readCacheJson(logicalKey)).resolves.toEqual({ version: 'fresh-idb' })
  })

  test('removes a web cache prefix', async () => {
    installLocalStorage()
    const { readCacheText, removeCachePrefix, writeCacheText } = await import('@/app/cache')

    await writeCacheText('openrouter/models', 'models')
    await writeCacheText('openrouter/other', 'other')
    await writeCacheText('fonts/manifest', 'fonts')

    await removeCachePrefix('openrouter')

    await expect(readCacheText('openrouter/models')).resolves.toBeNull()
    await expect(readCacheText('openrouter/other')).resolves.toBeNull()
    await expect(readCacheText('fonts/manifest')).resolves.toBe('fonts')
  })
})
