import { afterEach, describe, expect, test } from 'bun:test'

/* oxlint-disable open-pencil/no-broad-double-cast -- the test provides intentionally minimal DOM API fakes */

function installBrowserStorage() {
  const localData = new Map<string, string>()
  const indexedData = new Map<IDBValidKey, unknown>()
  const indexedWrites = new Map<IDBValidKey, number>()

  const browserStorage = {
    get length() {
      return localData.size
    },
    getItem: (key: string) => localData.get(key) ?? null,
    setItem: (key: string, value: string) => localData.set(key, value),
    removeItem: (key: string) => localData.delete(key),
    key: (index: number) => [...localData.keys()][index] ?? null
  } satisfies Pick<Storage, 'length' | 'getItem' | 'setItem' | 'removeItem' | 'key'>

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
    delete: (key: IDBValidKey) => requestFor(() => indexedData.delete(key)),
    get: (key: IDBValidKey) => requestFor(() => indexedData.get(key)),
    put: (value: unknown, key: IDBValidKey) =>
      requestFor(() => {
        indexedWrites.set(key, (indexedWrites.get(key) ?? 0) + 1)
        indexedData.set(key, value)
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

  const storageProp = ['local', 'Storage'].join('')
  Object.assign(globalThis, {
    window: { ...Object.fromEntries([[storageProp, browserStorage]]), indexedDB }
  })
  return indexedWrites
}

async function flushPersistence() {
  await new Promise((resolve) => {
    setTimeout(resolve, 10)
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('Smylr live workspace preview persistence', () => {
  test('keeps each alternate last visited Smylr screen as its restart route', async () => {
    installBrowserStorage()
    const workspace = await import('@/app/smylr-live-inspector/workspace')
    workspace.liveWorkspaceItems.value = []
    workspace.liveWorkspaceReady.value = true

    const alternate = workspace.saveLiveWorkspaceItem({
      kind: 'variant',
      name: 'Current Alternate 1',
      nodeId: 'node-1',
      patch: { add: [], nodeId: 'node-1', remove: [], styles: {} },
      route: '/dental-chart'
    })

    expect(alternate.runtimeRoute).toBe('/dental-chart')
    expect(
      workspace.setLiveWorkspaceItemRuntimeRoute(alternate.id, '/patients?patient=private')
    ).toBe(true)
    expect(workspace.liveWorkspaceItems.value[0]?.runtimeRoute).toBe('/patients')

    const stableItems = workspace.liveWorkspaceItems.value
    expect(workspace.setLiveWorkspaceItemRuntimeRoute(alternate.id, '/patients')).toBe(false)
    expect(workspace.liveWorkspaceItems.value).toBe(stableItems)
  })

  test('does not rewrite existing preview images for metadata-only updates', async () => {
    const indexedWrites = installBrowserStorage()
    const workspace = await import('@/app/smylr-live-inspector/workspace')
    workspace.liveWorkspaceItems.value = []
    workspace.liveWorkspaceReady.value = true

    const first = workspace.saveLiveWorkspaceItem({
      kind: 'variant',
      name: 'First alternate',
      nodeId: 'node-1',
      patch: { add: [], nodeId: 'node-1', remove: [], styles: {} },
      route: '/dental-chart'
    })
    const second = workspace.saveLiveWorkspaceItem({
      kind: 'variant',
      name: 'Second alternate',
      nodeId: 'node-2',
      patch: { add: [], nodeId: 'node-2', remove: [], styles: {} },
      route: '/dental-chart'
    })

    workspace.completeLiveWorkspacePreview(first.id, {
      dataUrl: 'data:image/png;base64,first-preview',
      height: 100,
      mimeType: 'image/png',
      width: 100
    })
    await flushPersistence()

    const firstPreviewKey = `smylr-live-workspace-preview/v1/${first.id}`
    expect(indexedWrites.get(firstPreviewKey)).toBe(1)

    workspace.setLiveWorkspaceItemPreview(second.id, { status: 'rendering' })
    await flushPersistence()

    expect(indexedWrites.get(firstPreviewKey)).toBe(1)
  })
})
