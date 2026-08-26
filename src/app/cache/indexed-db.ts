const CACHE_DATABASE = 'open-pencil-cache-v1'
const CACHE_STORE = 'binary-entries'

export function isIndexedDbAvailable(): boolean {
  return 'window' in globalThis && !!window.indexedDB
}

function openCacheDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(CACHE_DATABASE, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

export async function readIndexedDbValue<T>(key: string): Promise<T | null> {
  const database = await openCacheDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction(CACHE_STORE, 'readonly')
        .objectStore(CACHE_STORE)
        .get(key)
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
    })
  } finally {
    database.close()
  }
}

export async function writeIndexedDbValue(key: string, value: unknown): Promise<void> {
  const database = await openCacheDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(CACHE_STORE, 'readwrite')
        .objectStore(CACHE_STORE)
        .put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
    })
  } finally {
    database.close()
  }
}

export async function removeIndexedDbEntry(key: string): Promise<void> {
  const database = await openCacheDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(CACHE_STORE, 'readwrite')
        .objectStore(CACHE_STORE)
        .delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'))
    })
  } finally {
    database.close()
  }
}

export async function removeIndexedDbPrefix(prefix: string): Promise<void> {
  const database = await openCacheDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database
        .transaction(CACHE_STORE, 'readwrite')
        .objectStore(CACHE_STORE)
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
    database.close()
  }
}
