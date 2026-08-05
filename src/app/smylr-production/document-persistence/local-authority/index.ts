import { useIntervalFn } from '@vueuse/core'

import {
  readLocalWorkspaceWriterLease,
  removeLocalWorkspaceWriterLease,
  writeLocalWorkspaceWriterLease
} from './storage'

const LOCAL_AUTHORITY_CHANNEL_PREFIX = 'openpencil-workspace-authority'
const LOCAL_WRITER_LOCK_PREFIX = 'openpencil-workspace-writer'
const FALLBACK_LEASE_DURATION_MS = 8_000
const FALLBACK_LEASE_HEARTBEAT_MS = 2_000

type LocalWorkspaceAuthorityMessage = {
  token: string
  type: 'head-committed'
}

type WriterLease = {
  isHeld(): boolean
  release(): void
  token: string
}

export type LocalWorkspaceAuthorityRole = 'viewer' | 'writer'

export type LocalWorkspaceAuthority = {
  canWrite(): boolean
  close(): void
  notifyHeadCommitted(): void
  role: LocalWorkspaceAuthorityRole
}

export type LocalWorkspaceAuthorityOptions = {
  allowConcurrentWriters?: boolean
  documentId: string
  onHeadCommitted?: () => void
  onWriterLost?: () => void
}

function writerLockName(documentId: string) {
  return `${LOCAL_WRITER_LOCK_PREFIX}:${documentId}`
}

function authorityChannelName(documentId: string) {
  return `${LOCAL_AUTHORITY_CHANNEL_PREFIX}:${documentId}`
}

function fallbackLeaseStorageKey(documentId: string) {
  return `${LOCAL_WRITER_LOCK_PREFIX}:${documentId}`
}

function browserLockManager(): LockManager | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null
  return navigator.locks
}

function acquireStorageWriterLease(documentId: string, token: string): WriterLease | null {
  const key = fallbackLeaseStorageKey(documentId)
  const now = Date.now()
  const current = readLocalWorkspaceWriterLease(key)
  if (current && current.expiresAt > now && current.token !== token) return null

  function writeLease() {
    return writeLocalWorkspaceWriterLease(key, {
      expiresAt: Date.now() + FALLBACK_LEASE_DURATION_MS,
      token
    })
  }

  if (!writeLease() || readLocalWorkspaceWriterLease(key)?.token !== token) return null

  let active = true

  function isHeld() {
    if (!active) return false
    const stored = readLocalWorkspaceWriterLease(key)
    if (stored?.token === token && stored.expiresAt > Date.now()) return true
    active = false
    heartbeat.pause()
    return false
  }

  const heartbeat = useIntervalFn(
    () => {
      if (!isHeld()) return
      if (writeLease()) return
      active = false
      heartbeat.pause()
    },
    FALLBACK_LEASE_HEARTBEAT_MS,
    { immediate: false }
  )
  heartbeat.resume()

  return {
    isHeld,
    token,
    release() {
      if (!active) return
      active = false
      heartbeat.pause()
      if (readLocalWorkspaceWriterLease(key)?.token === token) {
        removeLocalWorkspaceWriterLease(key)
      }
    }
  }
}

function acquireWebWriterLease(
  manager: LockManager,
  documentId: string,
  token: string
): Promise<WriterLease | null> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (lease: WriterLease | null) => {
      if (settled) return
      settled = true
      resolve(lease)
    }

    void manager
      .request(
        writerLockName(documentId),
        { ifAvailable: true, mode: 'exclusive' },
        async (lock) => {
          if (!lock) {
            settle(null)
            return
          }
          let active = true
          let releaseHold: () => void = () => undefined
          const hold = new Promise<void>((release) => {
            releaseHold = release
          })
          settle({
            isHeld: () => active,
            token,
            release() {
              if (!active) return
              active = false
              releaseHold()
            }
          })
          await hold
        }
      )
      .catch(() => {
        if (!settled) settle(acquireStorageWriterLease(documentId, token))
      })
  })
}

async function acquireWriterLease(documentId: string): Promise<WriterLease | null> {
  const token = crypto.randomUUID()
  const manager = browserLockManager()
  if (manager) return acquireWebWriterLease(manager, documentId, token)
  return acquireStorageWriterLease(documentId, token)
}

function createOptimisticWriterLease(): WriterLease {
  let active = true
  return {
    isHeld: () => active,
    token: crypto.randomUUID(),
    release() {
      active = false
    }
  }
}

function isAuthorityMessage(value: unknown): value is LocalWorkspaceAuthorityMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceAuthorityMessage>
  return candidate.type === 'head-committed' && typeof candidate.token === 'string'
}

export async function connectLocalWorkspaceAuthority({
  allowConcurrentWriters = false,
  documentId,
  onHeadCommitted,
  onWriterLost
}: LocalWorkspaceAuthorityOptions): Promise<LocalWorkspaceAuthority> {
  // The durable backend serializes writes with revision checks, so browser-profile
  // locks are only needed when the app falls back to browser-local persistence.
  const lease = allowConcurrentWriters
    ? createOptimisticWriterLease()
    : await acquireWriterLease(documentId)
  const role: LocalWorkspaceAuthorityRole = lease ? 'writer' : 'viewer'
  const channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(authorityChannelName(documentId))
  let closed = false
  let reportedWriterLoss = false

  function canWrite() {
    return !closed && Boolean(lease?.isHeld())
  }

  function reportWriterLoss() {
    if (reportedWriterLoss || role !== 'writer' || canWrite()) return
    reportedWriterLoss = true
    onWriterLost?.()
  }

  const writerMonitor = useIntervalFn(reportWriterLoss, FALLBACK_LEASE_HEARTBEAT_MS, {
    immediate: false
  })
  if (role === 'writer') writerMonitor.resume()

  const handleMessage = (event: MessageEvent<unknown>) => {
    if (!isAuthorityMessage(event.data) || event.data.token === lease?.token) return
    onHeadCommitted?.()
  }
  channel?.addEventListener('message', handleMessage)

  return {
    canWrite,
    role,
    notifyHeadCommitted() {
      if (!canWrite() || !channel || !lease) return
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
      channel.postMessage({ token: lease.token, type: 'head-committed' })
    },
    close() {
      if (closed) return
      closed = true
      writerMonitor.pause()
      channel?.removeEventListener('message', handleMessage)
      channel?.close()
      lease?.release()
    }
  }
}
