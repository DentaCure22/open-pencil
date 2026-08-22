import { useIntervalFn } from '@vueuse/core'

import { reloadLiveInspectorFrame } from './session'

/**
 * Live frames keep a dead document when Fast Refresh does not apply, and
 * after the Smylr dev server restarts. HTTP polling misses fast restarts
 * (down for less than one interval). The parent therefore holds its own
 * Next HMR socket and remounts on real Turbopack updates or a new session.
 */

const POLL_INTERVAL_MS = 3000
const HMR_RECONNECT_MS = 500
const HMR_ENDPOINT_PATH = '/_next/hmr'

export type SmylrServerProbe = (origin: string) => Promise<boolean>

/** Opaque no-cors probe: we only need reachable/unreachable, never response contents. */
async function defaultProbe(origin: string): Promise<boolean> {
  try {
    await fetch(`${origin}/`, { cache: 'no-store', mode: 'no-cors' })
    return true
  } catch {
    return false
  }
}

/** Pure transition rule: reload only on a down -> up edge, never on steady states. */
export function shouldReloadOnTransition(wasUp: boolean | null, isUp: boolean): boolean {
  return wasUp === false && isUp
}

/** Remount when a new Turbopack process announces a different session. */
export function shouldReloadOnSessionChange(
  previousSessionId: string | null,
  nextSessionId: string
): boolean {
  return previousSessionId !== null && previousSessionId !== nextSessionId
}

export function hmrSocketUrlFor(origin: string): string {
  const url = new URL(origin)
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${url.host}${HMR_ENDPOINT_PATH}`
}

export function parseHmrPayload(data: unknown): { type?: string } | null {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data) as { type?: string }
  } catch {
    return null
  }
}

export function parseHmrSessionId(data: unknown): string | null {
  const payload = parseHmrPayload(data)
  if (payload?.type !== 'turbopack-connected') return null
  const sessionId = (payload as { data?: { sessionId?: number | string } }).data?.sessionId
  return sessionId === undefined ? null : String(sessionId)
}

/**
 * Next 16 also emits a stream of `built` hash-0 events that are not module
 * updates. Remount only on the Turbopack payloads that follow a real save.
 */
const REMOUNT_MESSAGE_TYPES = new Set([
  'clientChanges',
  'serverComponentChanges',
  'turbopack-message',
  'reload',
  'reloadPage'
])

export function isHmrRemountMessage(data: unknown): boolean {
  const type = parseHmrPayload(data)?.type
  return type !== undefined && REMOUNT_MESSAGE_TYPES.has(type)
}

let watcherCount = 0
let serverWasUp: boolean | null = null
let watchedOrigin: string | null = null
let activeProbe: SmylrServerProbe = defaultProbe
let hmrSocket: WebSocket | null = null
let hmrSessionId: string | null = null
let hmrReconnectTimer = 0

async function poll(): Promise<void> {
  if (!watchedOrigin) return
  const isUp = await activeProbe(watchedOrigin)
  if (watcherCount > 0 && shouldReloadOnTransition(serverWasUp, isUp)) {
    reloadLiveInspectorFrame()
  }
  serverWasUp = isUp
}

const pollInterval = useIntervalFn(() => void poll(), POLL_INTERVAL_MS, { immediate: false })

function connectHmr(origin: string): void {
  if (typeof WebSocket === 'undefined') return
  hmrSocket?.close()
  const socket = new WebSocket(hmrSocketUrlFor(origin))
  hmrSocket = socket
  socket.addEventListener('message', (event) => {
    if (watcherCount > 0 && isHmrRemountMessage(event.data)) {
      reloadLiveInspectorFrame()
    }
    const nextSessionId = parseHmrSessionId(event.data)
    if (!nextSessionId) return
    if (watcherCount > 0 && shouldReloadOnSessionChange(hmrSessionId, nextSessionId)) {
      reloadLiveInspectorFrame()
    }
    hmrSessionId = nextSessionId
  })
  socket.addEventListener('close', () => {
    if (watcherCount === 0 || watchedOrigin !== origin) return
    window.clearTimeout(hmrReconnectTimer)
    hmrReconnectTimer = window.setTimeout(() => connectHmr(origin), HMR_RECONNECT_MS)
  })
}

function disconnectHmr(): void {
  window.clearTimeout(hmrReconnectTimer)
  const socket = hmrSocket
  hmrSocket = null
  hmrSessionId = null
  socket?.close()
}

export function acquireSmylrDevServerWatch(
  origin: string,
  probe: SmylrServerProbe = defaultProbe
): void {
  watcherCount += 1
  watchedOrigin = origin
  activeProbe = probe
  pollInterval.resume()
  if (watcherCount === 1) connectHmr(origin)
}

export function releaseSmylrDevServerWatch(): void {
  watcherCount = Math.max(0, watcherCount - 1)
  if (watcherCount > 0) return
  pollInterval.pause()
  disconnectHmr()
  serverWasUp = null
  watchedOrigin = null
  activeProbe = defaultProbe
}
