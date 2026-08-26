import { afterAll, describe, expect, test } from 'bun:test'

type RuntimeListener = (
  message: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response: unknown) => void
) => boolean

const globalTarget = globalThis as typeof globalThis & { chrome: unknown }
const originalChrome = globalTarget.chrome
const runtimeListeners: RuntimeListener[] = []
const offscreenMessages: Array<Record<string, unknown>> = []
const captureCalls: Array<{ options: unknown; windowId: number }> = []
const storageState: Record<string, unknown> = {}

function storageResult(key: string | string[]) {
  const keys = Array.isArray(key) ? key : [key]
  return Object.fromEntries(keys.map((entry) => [entry, storageState[entry]]))
}

globalTarget.chrome = {
  action: {
    onClicked: { addListener: () => undefined },
    setBadgeBackgroundColor: async () => undefined,
    setBadgeText: async () => undefined
  },
  offscreen: {
    createDocument: async () => undefined,
    hasDocument: async () => true
  },
  runtime: {
    getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
    getURL: (path: string) => `chrome-extension://openpencil/${path}`,
    onMessage: {
      addListener: (listener: RuntimeListener) => runtimeListeners.push(listener)
    },
    onInstalled: { addListener: () => undefined },
    sendMessage: async (message: Record<string, unknown>) => {
      offscreenMessages.push(structuredClone(message))
      if (message.kind === 'start-frame-recording') {
        return {
          mimeType: 'video/webm',
          ok: true,
          startedAt: message.startedAt
        }
      }
      return { ok: true }
    }
  },
  scripting: {
    executeScript: async () => []
  },
  storage: {
    session: {
      get: async (key: string | string[]) => storageResult(key),
      remove: async (key: string) => {
        Reflect.deleteProperty(storageState, key)
      },
      set: async (values: Record<string, unknown>) => {
        Object.assign(storageState, structuredClone(values))
      }
    }
  },
  tabCapture: {
    getMediaStreamId: async () => {
      throw new Error('Extension has not been invoked for the current page')
    }
  },
  tabs: {
    captureVisibleTab: async (windowId: number, options: unknown) => {
      captureCalls.push({ options, windowId })
      return 'data:image/jpeg;base64,frame'
    },
    get: async () => ({ active: true, id: 17, windowId: 9 }),
    onActivated: { addListener: () => undefined },
    onRemoved: { addListener: () => undefined },
    onUpdated: { addListener: () => undefined },
    query: async () => [],
    sendMessage: async () => ({ ok: true })
  }
}

const serviceWorkerUrl = new URL(
  '../../../../extensions/openpencil-chrome/service-worker.js',
  import.meta.url
)
serviceWorkerUrl.searchParams.set('recording-test', String(Date.now()))
await import(serviceWorkerUrl.href)

function sendRuntimeMessage(message: Record<string, unknown>, sender = {}) {
  const listener = runtimeListeners.at(-1)
  if (!listener) throw new Error('Service worker runtime listener was not registered')
  return new Promise<unknown>((resolve) => {
    expect(listener(message, sender, resolve)).toBe(true)
  })
}

afterAll(() => {
  globalTarget.chrome = originalChrome
})

describe('Inspect Chrome motion recording fallback', () => {
  test('samples visible frames when tabCapture lacks an extension user gesture', async () => {
    const captureSessionId = 'capture-session-fallback'
    const response = (await sendRuntimeMessage(
      {
        captureSessionId,
        kind: 'start-browser-motion-recording'
      },
      { tab: { id: 17, windowId: 9 } }
    )) as { mode?: string; ok?: boolean }

    expect(response).toEqual(
      expect.objectContaining({
        mode: 'frame-sampling',
        ok: true
      })
    )
    expect(offscreenMessages).toContainEqual(
      expect.objectContaining({
        captureSessionId,
        kind: 'start-frame-recording',
        target: 'offscreen'
      })
    )
    expect(storageState['openpencil-recording-sources-v1']).toEqual({
      [captureSessionId]: {
        mode: 'frame-sampling',
        tabId: 17,
        windowId: 9
      }
    })

    const frame = await sendRuntimeMessage({
      captureSessionId,
      kind: 'capture-motion-frame',
      target: 'service-worker'
    })
    expect(frame).toEqual({ dataUrl: 'data:image/jpeg;base64,frame', ok: true })
    expect(captureCalls).toEqual([
      {
        options: { format: 'jpeg', quality: 82 },
        windowId: 9
      }
    ])
  })
})
