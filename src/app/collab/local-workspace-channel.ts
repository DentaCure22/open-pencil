import * as Y from 'yjs'

import type {
  DragPreviewMessage,
  DragPreviewTransport,
  OutboundDragPreview
} from '@/app/collab/drag-preview'
import { LOCAL_WORKSPACE_COLLAB_ORIGIN } from '@/app/collab/origins'

type LocalWorkspaceChannelMessage =
  | { sessionId: string; type: 'bootstrap-candidate' }
  | { sessionId: string; type: 'bootstrap-seeding' }
  | { requestId: string; stateVector: Uint8Array; type: 'sync-request' }
  | { requestId: string; type: 'sync-response'; update: Uint8Array }
  | { preview: DragPreviewMessage; type: 'drag-preview' }
  | { sessionId: string; type: 'preview-disconnect' }
  | { type: 'update'; update: Uint8Array }

export type LocalWorkspaceBootstrapResult = 'closed' | 'peer' | 'seeded'

export type LocalWorkspaceChannel = DragPreviewTransport & {
  bootstrap(seedDocument?: () => void, waitMs?: number): Promise<LocalWorkspaceBootstrapResult>
  close(): void
}

const LOCAL_WORKSPACE_BOOTSTRAP_WAIT_MS = 150
const LOCAL_WORKSPACE_BOOTSTRAP_FAILOVER_MS = 5_000
const LOCAL_WORKSPACE_BOOTSTRAP_RETRY_MAX_MS = 2_000

function isDragPreviewMessage(value: unknown): value is DragPreviewMessage {
  if (!value || typeof value !== 'object') return false
  const preview = value as Partial<DragPreviewMessage>
  return Boolean(
    typeof preview.gestureId === 'string' &&
    typeof preview.nodeId === 'string' &&
    typeof preview.pageId === 'string' &&
    (preview.phase === 'active' || preview.phase === 'cancelled' || preview.phase === 'terminal') &&
    Number.isSafeInteger(preview.sequence) &&
    Number(preview.sequence) > 0 &&
    typeof preview.sessionId === 'string' &&
    Number.isFinite(preview.x) &&
    Number.isFinite(preview.y)
  )
}

function isLocalWorkspaceChannelMessage(value: unknown): value is LocalWorkspaceChannelMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  const candidate = value as Partial<LocalWorkspaceChannelMessage>
  if (candidate.type === 'bootstrap-candidate' || candidate.type === 'bootstrap-seeding') {
    return typeof candidate.sessionId === 'string'
  }
  if (candidate.type === 'sync-request') {
    return typeof candidate.requestId === 'string' && candidate.stateVector instanceof Uint8Array
  }
  if (candidate.type === 'sync-response') {
    return typeof candidate.requestId === 'string' && candidate.update instanceof Uint8Array
  }
  if (candidate.type === 'preview-disconnect') return typeof candidate.sessionId === 'string'
  if (candidate.type === 'drag-preview') return isDragPreviewMessage(candidate.preview)
  return candidate.type === 'update' && candidate.update instanceof Uint8Array
}

export function connectLocalWorkspaceChannel(
  roomId: string,
  ydoc: Y.Doc
): LocalWorkspaceChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(`openpencil-workspace:${roomId}`)
  const sessionId = crypto.randomUUID()
  const previewListeners = new Set<(preview: DragPreviewMessage) => void>()
  const disconnectListeners = new Set<(sessionId: string) => void>()
  const pendingSyncRequests = new Map<string, Uint8Array>()
  const bootstrapCandidates = new Set<string>()
  let activeRequestId: string | null = null
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null
  let bootstrapCommitTimer: ReturnType<typeof setTimeout> | null = null
  let bootstrapFailoverTimer: ReturnType<typeof setTimeout> | null = null
  let bootstrapWaitMs = LOCAL_WORKSPACE_BOOTSTRAP_WAIT_MS
  let electedSeederId: string | null = null
  let bootstrapRetryTimer: ReturnType<typeof setTimeout> | null = null
  let finishBootstrap: ((result: LocalWorkspaceBootstrapResult) => void) | null = null
  let seedDocument: (() => void) | null = null
  let ready = false
  let closed = false

  function postUpdate(update: Uint8Array) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
    channel.postMessage({ type: 'update', update })
  }

  function handleDocumentUpdate(update: Uint8Array, origin: unknown) {
    if (!ready || origin === LOCAL_WORKSPACE_COLLAB_ORIGIN) return
    postUpdate(update)
  }

  function postSyncResponse(requestId: string, stateVector: Uint8Array) {
    const message: LocalWorkspaceChannelMessage = {
      requestId,
      type: 'sync-response',
      update: Y.encodeStateAsUpdate(ydoc, stateVector)
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
    channel.postMessage(message)
  }

  function becomeReady(result: LocalWorkspaceBootstrapResult) {
    if (ready || closed) return
    ready = true
    if (bootstrapTimer) clearTimeout(bootstrapTimer)
    if (bootstrapCommitTimer) clearTimeout(bootstrapCommitTimer)
    if (bootstrapFailoverTimer) clearTimeout(bootstrapFailoverTimer)
    if (bootstrapRetryTimer) clearTimeout(bootstrapRetryTimer)
    bootstrapTimer = null
    bootstrapCommitTimer = null
    bootstrapFailoverTimer = null
    bootstrapRetryTimer = null
    seedDocument = null
    for (const [requestId, stateVector] of pendingSyncRequests) {
      postSyncResponse(requestId, stateVector)
    }
    pendingSyncRequests.clear()
    finishBootstrap?.(result)
    finishBootstrap = null
  }

  function postSyncRequest() {
    if (!activeRequestId || ready || closed) return
    const message: LocalWorkspaceChannelMessage = {
      requestId: activeRequestId,
      stateVector: Y.encodeStateVector(ydoc),
      type: 'sync-request'
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
    channel.postMessage(message)
  }

  function scheduleBootstrapRetry(waitMs: number) {
    if (ready || closed) return
    bootstrapRetryTimer = setTimeout(
      () => {
        bootstrapRetryTimer = null
        postSyncRequest()
        scheduleBootstrapRetry(Math.min(waitMs * 2, LOCAL_WORKSPACE_BOOTSTRAP_RETRY_MAX_MS))
      },
      Math.max(1, waitMs)
    )
  }

  function postBootstrapMessage(type: 'bootstrap-candidate' | 'bootstrap-seeding') {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
    channel.postMessage({ sessionId, type })
  }

  function clearBootstrapCommit() {
    if (!bootstrapCommitTimer) return
    clearTimeout(bootstrapCommitTimer)
    bootstrapCommitTimer = null
  }

  function armBootstrapFailover(candidateSessionId: string) {
    if (bootstrapFailoverTimer) clearTimeout(bootstrapFailoverTimer)
    bootstrapFailoverTimer = setTimeout(
      () => {
        bootstrapFailoverTimer = null
        if (ready || closed || !seedDocument) return
        bootstrapCandidates.delete(candidateSessionId)
        if (electedSeederId === candidateSessionId) electedSeederId = null
        scheduleSeedElection()
      },
      Math.max(LOCAL_WORKSPACE_BOOTSTRAP_FAILOVER_MS, bootstrapWaitMs * 20)
    )
  }

  function commitSeed() {
    bootstrapCommitTimer = null
    if (ready || closed || electedSeederId !== sessionId || !seedDocument) return
    seedDocument()
    becomeReady('seeded')
  }

  function electSeeder() {
    bootstrapTimer = null
    if (ready || closed || !seedDocument) return
    bootstrapCandidates.add(sessionId)
    const winner = [...bootstrapCandidates].sort()[0]
    if (!winner) return
    electedSeederId = winner
    if (winner !== sessionId) {
      armBootstrapFailover(winner)
      return
    }
    postBootstrapMessage('bootstrap-seeding')
    clearBootstrapCommit()
    bootstrapCommitTimer = setTimeout(commitSeed, bootstrapWaitMs)
  }

  function scheduleSeedElection() {
    if (ready || closed || !seedDocument || bootstrapTimer || bootstrapCommitTimer) return
    bootstrapTimer = setTimeout(electSeeder, bootstrapWaitMs)
  }

  function handleBootstrapCandidate(candidateSessionId: string) {
    if (ready || candidateSessionId === sessionId) return
    bootstrapCandidates.add(candidateSessionId)
    if (electedSeederId !== sessionId || candidateSessionId >= sessionId) return
    electedSeederId = candidateSessionId
    clearBootstrapCommit()
    armBootstrapFailover(candidateSessionId)
  }

  function handleBootstrapSeeder(candidateSessionId: string) {
    if (ready || candidateSessionId === sessionId) return
    bootstrapCandidates.add(candidateSessionId)
    if (!electedSeederId || candidateSessionId < electedSeederId) {
      electedSeederId = candidateSessionId
    }
    if (electedSeederId !== sessionId) clearBootstrapCommit()
    armBootstrapFailover(electedSeederId)
  }

  function handleSessionDisconnect(disconnectedSessionId: string) {
    bootstrapCandidates.delete(disconnectedSessionId)
    if (electedSeederId === disconnectedSessionId) {
      electedSeederId = null
      if (bootstrapFailoverTimer) clearTimeout(bootstrapFailoverTimer)
      bootstrapFailoverTimer = null
      scheduleSeedElection()
    }
    for (const listener of disconnectListeners) listener(disconnectedSessionId)
  }

  function handleChannelMessage(event: MessageEvent<unknown>) {
    if (!isLocalWorkspaceChannelMessage(event.data)) return
    if (event.data.type === 'bootstrap-candidate') {
      handleBootstrapCandidate(event.data.sessionId)
      return
    }
    if (event.data.type === 'bootstrap-seeding') {
      handleBootstrapSeeder(event.data.sessionId)
      return
    }
    if (event.data.type === 'drag-preview') {
      if (!ready) return
      for (const listener of previewListeners) listener(event.data.preview)
      return
    }
    if (event.data.type === 'preview-disconnect') {
      handleSessionDisconnect(event.data.sessionId)
      return
    }
    if (event.data.type === 'sync-request') {
      if (ready) postSyncResponse(event.data.requestId, event.data.stateVector)
      else pendingSyncRequests.set(event.data.requestId, event.data.stateVector)
      return
    }
    if (event.data.type === 'sync-response') {
      if (event.data.requestId !== activeRequestId) return
      Y.applyUpdate(ydoc, event.data.update, LOCAL_WORKSPACE_COLLAB_ORIGIN)
      becomeReady('peer')
      return
    }
    Y.applyUpdate(ydoc, event.data.update, LOCAL_WORKSPACE_COLLAB_ORIGIN)
  }

  ydoc.on('update', handleDocumentUpdate)
  channel.addEventListener('message', handleChannelMessage)

  return {
    sessionId,
    publishDragPreview(preview: OutboundDragPreview) {
      if (!ready || closed) return
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
      channel.postMessage({ preview: { ...preview, sessionId }, type: 'drag-preview' })
    },
    subscribeDragPreview(listener) {
      previewListeners.add(listener)
      return () => previewListeners.delete(listener)
    },
    subscribeSessionDisconnect(listener) {
      disconnectListeners.add(listener)
      return () => disconnectListeners.delete(listener)
    },
    bootstrap(seed, waitMs = LOCAL_WORKSPACE_BOOTSTRAP_WAIT_MS) {
      if (closed) return Promise.resolve('closed')
      if (ready) return Promise.resolve('peer')
      if (finishBootstrap) {
        throw new Error('Local workspace channel bootstrap already started')
      }
      activeRequestId = crypto.randomUUID()
      bootstrapWaitMs = Math.max(1, waitMs)
      seedDocument = seed ?? null
      const result = new Promise<LocalWorkspaceBootstrapResult>((resolve) => {
        finishBootstrap = resolve
      })
      postSyncRequest()
      // A seedless follower may start before the exclusive browser-local writer.
      // Retrying lets a later writer answer without ever allowing the follower
      // to seed its potentially stale SceneGraph as a second authority.
      scheduleBootstrapRetry(bootstrapWaitMs)
      if (seedDocument) {
        bootstrapCandidates.add(sessionId)
        postBootstrapMessage('bootstrap-candidate')
        scheduleSeedElection()
      }
      return result
    },
    close() {
      if (closed) return
      closed = true
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
      channel.postMessage({ sessionId, type: 'preview-disconnect' })
      if (bootstrapTimer) clearTimeout(bootstrapTimer)
      if (bootstrapCommitTimer) clearTimeout(bootstrapCommitTimer)
      if (bootstrapFailoverTimer) clearTimeout(bootstrapFailoverTimer)
      if (bootstrapRetryTimer) clearTimeout(bootstrapRetryTimer)
      bootstrapTimer = null
      bootstrapCommitTimer = null
      bootstrapFailoverTimer = null
      bootstrapRetryTimer = null
      seedDocument = null
      finishBootstrap?.('closed')
      finishBootstrap = null
      ydoc.off('update', handleDocumentUpdate)
      channel.removeEventListener('message', handleChannelMessage)
      channel.close()
      previewListeners.clear()
      disconnectListeners.clear()
    }
  }
}
