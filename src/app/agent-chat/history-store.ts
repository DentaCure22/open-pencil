import { useIntervalFn } from '@vueuse/core'
import { onMounted, onUnmounted, readonly, ref, shallowReadonly, shallowRef } from 'vue'

import {
  getAgentConversation,
  getAgentConversationPage,
  listAgentConversations,
  mapRemoteAgentConversation,
  nativeAgentConversationMessageId,
  type AgentConversationHistory,
  type AgentConversationThread
} from './conversations'
import { agentHistorySignature } from './history-signature'
import {
  applyConversationPage,
  applyConversationPreviewMetadata,
  mapAgentConversationHistory,
  reconcileAgentConversationHistory,
  retainMissingOpenTranscripts,
  sameAgentConversationHistory
} from './reconcile'
import {
  LIVE_TRANSCRIPT_INTERVAL_MS,
  liveTranscriptAfterCursor,
  liveStreamingThreadIds,
  nextTranscriptHydrationBatch,
  resolvePreviewTranscriptSource,
  scheduleTranscriptHydration,
  type TranscriptHydrationHandle
} from './transcript-hydration'

const POLL_INTERVAL_MS = 2_500

const history = shallowRef<AgentConversationHistory | null>(null)
const error = ref('')
let subscribers = import.meta.hot?.data.agentHistorySubscribers ?? 0
let inFlight: Promise<void> | null = null
let historySignature = ''
const transcriptRetainers = new Map<string, number>()
const hydratedTranscripts = new Map<string, AgentConversationThread>()
const hydratedUpdatedAt = new Map<string, string>()
const TRANSCRIPT_CACHE_LIMIT = 12
const olderLoads = new Map<string, Promise<boolean>>()
const fullLoads = new Map<string, Promise<void>>()
let hydrateInFlight: Promise<void> | null = null
let hydrateAgain = false
let hydrateIdleHandle: TranscriptHydrationHandle | null = null
const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  () => void refreshAgentConversationHistory(),
  POLL_INTERVAL_MS,
  { immediate: false }
)
let liveInFlight: Promise<void> | null = null
const { pause: pauseLiveStream, resume: resumeLiveStream } = useIntervalFn(
  () => void refreshLiveTranscripts(),
  LIVE_TRANSCRIPT_INTERVAL_MS,
  { immediate: false }
)

function historyPollingAllowed() {
  if (typeof document === 'undefined') return true
  return document.visibilityState !== 'hidden'
}

function syncHistoryPolling() {
  const live = retainedRunningThreadIds().length > 0
  if (subscribers > 0 && historyPollingAllowed() && !live) resumePolling()
  else pausePolling()
  syncLiveStreaming()
}

function retainedRunningThreadIds(): string[] {
  return liveStreamingThreadIds(history.value?.threads ?? [], transcriptRetainers.keys())
}

function syncLiveStreaming() {
  if (subscribers > 0 && historyPollingAllowed() && retainedRunningThreadIds().length) {
    pausePolling()
    resumeLiveStream()
    return
  }
  pauseLiveStream()
  if (subscribers > 0 && historyPollingAllowed()) resumePolling()
}

function rememberHydratedThread(thread: AgentConversationThread): void {
  hydratedTranscripts.set(thread.id, thread)
  if (hydratedTranscripts.size <= TRANSCRIPT_CACHE_LIMIT) return
  for (const id of hydratedTranscripts.keys()) {
    if (transcriptRetainers.has(id) || id === thread.id) continue
    hydratedTranscripts.delete(id)
    hydratedUpdatedAt.delete(id)
    if (hydratedTranscripts.size <= TRANSCRIPT_CACHE_LIMIT) return
  }
}

function rememberAppliedPage(
  current: AgentConversationThread,
  page: AgentConversationThread,
  mode: 'delta' | 'older' | 'tail'
): AgentConversationThread {
  const next = applyConversationPage(current, page, mode)
  rememberHydratedThread(next)
  return next
}

function restoreHydratedMessages(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory
): AgentConversationHistory {
  return retainMissingOpenTranscripts(
    previous,
    mapAgentConversationHistory(previous, next, (current, thread) => {
      const source = resolvePreviewTranscriptSource({
        cached: hydratedTranscripts.get(thread.id),
        current,
        retained: transcriptRetainers.has(thread.id)
      })
      if (!source) return thread
      const restored = applyConversationPreviewMetadata(source, thread)
      rememberHydratedThread(restored)
      return restored
    }),
    new Set([...transcriptRetainers.keys(), ...hydratedTranscripts.keys()])
  )
}

function applyPageToHistory(
  current: AgentConversationHistory,
  threadId: string,
  page: AgentConversationThread,
  mode: 'delta' | 'older' | 'tail'
): void {
  const nextThread = applyConversationPage(
    current.threads.find((thread) => thread.id === threadId) ?? page,
    page,
    mode
  )
  rememberHydratedThread(nextThread)
  history.value = reconcileAgentConversationHistory(current, {
    ...current,
    threads: current.threads.map((thread) => (thread.id === threadId ? nextThread : thread))
  })
}

function mappedPage(
  nativeThreadId: string,
  page: Awaited<ReturnType<typeof getAgentConversationPage>>
): AgentConversationThread {
  return {
    ...mapRemoteAgentConversation(page),
    id: `agent:${nativeThreadId}`,
    nativeThreadId
  }
}

async function fullConversationPage(nativeThreadId: string): Promise<AgentConversationThread> {
  return {
    ...mappedPage(nativeThreadId, await getAgentConversation(nativeThreadId)),
    hasNewer: false,
    hasOlder: false
  }
}

function olderNativeCursor(thread: AgentConversationThread): string | undefined {
  const cursor = thread.olderBefore
  if (!cursor)
    return thread.messages[0]
      ? nativeAgentConversationMessageId(thread.nativeThreadId, thread.messages[0].id)
      : undefined
  return nativeAgentConversationMessageId(thread.nativeThreadId, cursor)
}

function cancelScheduledHydration() {
  if (hydrateIdleHandle === null) return
  hydrateIdleHandle()
  hydrateIdleHandle = null
}

function scheduleRemainingHydration() {
  if (hydrateIdleHandle !== null) return
  hydrateIdleHandle = scheduleTranscriptHydration(() => {
    hydrateIdleHandle = null
    void hydrateRetainedTranscripts()
  })
}

async function hydrateRetainedTranscriptBatch(): Promise<boolean> {
  const current = history.value
  if (!current || transcriptRetainers.size === 0) return false
  const batch = nextTranscriptHydrationBatch([...transcriptRetainers.keys()], {
    hydratedUpdatedAt,
    updatedAtByThreadId: new Map(
      current.threads.map((thread) => [thread.id, thread.updatedAt] as const)
    )
  })
  if (batch.length === 0) return false
  const updates: Array<{
    mode: 'delta' | 'tail'
    page: AgentConversationThread
    threadId: string
  }> = []
  await Promise.all(
    batch.map(async (threadId) => {
      const thread = current.threads.find((candidate) => candidate.id === threadId)
      if (!thread) return
      const alreadyHydrated = hydratedUpdatedAt.has(threadId)
      const page = alreadyHydrated
        ? mappedPage(thread.nativeThreadId, await getAgentConversationPage(thread.nativeThreadId))
        : await fullConversationPage(thread.nativeThreadId).catch(async () =>
            mappedPage(thread.nativeThreadId, await getAgentConversationPage(thread.nativeThreadId))
          )
      updates.push({
        mode: alreadyHydrated ? 'delta' : 'tail',
        page,
        threadId
      })
      hydratedUpdatedAt.set(threadId, page.updatedAt)
    })
  )
  if (updates.length === 0 || history.value !== current) {
    return (
      nextTranscriptHydrationBatch([...transcriptRetainers.keys()], {
        hydratedUpdatedAt,
        updatedAtByThreadId: new Map(
          current.threads.map((thread) => [thread.id, thread.updatedAt] as const)
        )
      }).length > 0
    )
  }
  let next = current
  for (const update of updates) {
    const live = next.threads.find((thread) => thread.id === update.threadId)
    if (!live) continue
    next = {
      ...next,
      threads: next.threads.map((thread) =>
        thread.id === update.threadId
          ? rememberAppliedPage(thread, update.page, update.mode)
          : thread
      )
    }
  }
  const reconciled = reconcileAgentConversationHistory(current, next)
  if (!sameAgentConversationHistory(current, reconciled)) history.value = reconciled
  const committed = history.value
  queueOpenTranscriptCompletion()
  return (
    nextTranscriptHydrationBatch([...transcriptRetainers.keys()], {
      hydratedUpdatedAt,
      updatedAtByThreadId: new Map(
        committed.threads.map((thread) => [thread.id, thread.updatedAt] as const)
      )
    }).length > 0
  )
}

async function hydrateRetainedTranscripts(): Promise<void> {
  if (hydrateInFlight) {
    hydrateAgain = true
    return hydrateInFlight
  }
  hydrateInFlight = (async () => {
    do {
      hydrateAgain = false
      const more = await hydrateRetainedTranscriptBatch()
      if (more) scheduleRemainingHydration()
      // A second caller can flip this flag while the awaited batch is running.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
    } while (hydrateAgain)
  })().finally(() => {
    hydrateInFlight = null
  })
  return hydrateInFlight
}

async function refreshLiveTranscripts(): Promise<void> {
  if (liveInFlight) return
  const threadIds = retainedRunningThreadIds()
  if (!threadIds.length) {
    pauseLiveStream()
    return
  }
  const current = history.value
  if (!current) return
  liveInFlight = (async () => {
    const updates: Array<{ page: AgentConversationThread; threadId: string }> = []
    await Promise.all(
      threadIds.map(async (threadId) => {
        const thread = current.threads.find((candidate) => candidate.id === threadId)
        if (!thread) return
        const after = liveTranscriptAfterCursor(thread.messages)
        const remote = await getAgentConversationPage(
          thread.nativeThreadId,
          after ? { after: nativeAgentConversationMessageId(thread.nativeThreadId, after) } : {}
        )
        updates.push({
          page: mappedPage(thread.nativeThreadId, remote),
          threadId
        })
        hydratedUpdatedAt.set(threadId, remote.updatedAt)
      })
    )
    if (!updates.length || history.value !== current) return
    let next = current
    for (const update of updates) {
      if (!next.threads.some((thread) => thread.id === update.threadId)) continue
      next = {
        ...next,
        threads: next.threads.map((thread) =>
          thread.id === update.threadId ? rememberAppliedPage(thread, update.page, 'delta') : thread
        )
      }
    }
    const reconciled = reconcileAgentConversationHistory(current, next)
    if (sameAgentConversationHistory(current, reconciled)) return
    history.value = reconciled
    historySignature = agentHistorySignature(history.value)
  })().finally(() => {
    liveInFlight = null
    syncLiveStreaming()
  })
  return liveInFlight
}

async function requestHistory(): Promise<void> {
  try {
    const nextHistory = await listAgentConversations({ preview: true })
    const nextSignature = agentHistorySignature(nextHistory)
    if (nextSignature !== historySignature) {
      history.value = restoreHydratedMessages(
        history.value,
        reconcileAgentConversationHistory(history.value, nextHistory)
      )
      historySignature = nextSignature
    }
    if (transcriptRetainers.size > 0) await hydrateRetainedTranscripts()
    error.value = ''
    syncLiveStreaming()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function refreshAgentConversationHistory(fresh = false): Promise<void> {
  if (inFlight) {
    await inFlight
    if (!fresh) return
  }
  inFlight = requestHistory().finally(() => {
    inFlight = null
  })
  await inFlight
}

export function retainAgentConversationTranscript(threadId: string): void {
  if (!threadId) return
  transcriptRetainers.set(threadId, (transcriptRetainers.get(threadId) ?? 0) + 1)
  const current = history.value
  const cached = hydratedTranscripts.get(threadId)
  const thread = current?.threads.find((candidate) => candidate.id === threadId)
  if (current && thread && cached) {
    applyPageToHistory(current, threadId, applyConversationPreviewMetadata(cached, thread), 'delta')
  }
  void hydrateRetainedTranscripts()
  queueOpenTranscriptCompletion()
  syncLiveStreaming()
}

export function releaseAgentConversationTranscript(threadId: string): void {
  if (!threadId) return
  const current = transcriptRetainers.get(threadId) ?? 0
  if (current <= 1) {
    transcriptRetainers.delete(threadId)
    olderLoads.delete(threadId)
    fullLoads.delete(threadId)
    if (transcriptRetainers.size === 0) cancelScheduledHydration()
    syncLiveStreaming()
    return
  }
  transcriptRetainers.set(threadId, current - 1)
}

function queueOpenTranscriptCompletion(): void {
  const current = history.value
  if (!current) return
  for (const thread of current.threads) {
    if (!transcriptRetainers.has(thread.id) || thread.hasOlder !== true) continue
    void completeOpenTranscript(thread.id)
  }
}

async function completeOpenTranscript(threadId: string): Promise<void> {
  const pending = fullLoads.get(threadId)
  if (pending) return pending
  const work = (async () => {
    const current = history.value
    if (!current) return
    const thread = current.threads.find((candidate) => candidate.id === threadId)
    if (thread?.hasOlder !== true) return
    try {
      const page = await fullConversationPage(thread.nativeThreadId)
      if (history.value !== current) return
      applyPageToHistory(current, threadId, { ...page, hasNewer: false, hasOlder: false }, 'tail')
    } catch {
      for (let attempt = 0; attempt < 48; attempt += 1) {
        const loaded = await loadOlderAgentConversationTranscript(threadId)
        if (!loaded) return
      }
    }
  })().finally(() => {
    if (fullLoads.get(threadId) === work) fullLoads.delete(threadId)
  })
  fullLoads.set(threadId, work)
  return work
}

export async function loadOlderAgentConversationTranscript(threadId: string): Promise<boolean> {
  const pending = olderLoads.get(threadId)
  if (pending) return pending
  const work = (async () => {
    const current = history.value
    const thread = current?.threads.find((candidate) => candidate.id === threadId)
    if (!current || !thread || thread.hasOlder === false) return false
    const before = olderNativeCursor(thread)
    if (!before) return false
    const remote = await getAgentConversationPage(thread.nativeThreadId, { before })
    if (history.value !== current) return false
    const page = mappedPage(thread.nativeThreadId, remote)
    if (page.messages.length === 0) {
      applyPageToHistory(current, threadId, { ...thread, ...page, hasOlder: false }, 'older')
      return false
    }
    applyPageToHistory(current, threadId, page, 'older')
    return true
  })().finally(() => {
    if (olderLoads.get(threadId) === work) olderLoads.delete(threadId)
  })
  olderLoads.set(threadId, work)
  return work
}

export async function revealAgentConversationChapter(
  threadId: string,
  chapterId: string
): Promise<boolean> {
  const nativeId = (() => {
    const thread = history.value?.threads.find((candidate) => candidate.id === threadId)
    return thread ? nativeAgentConversationMessageId(thread.nativeThreadId, chapterId) : chapterId
  })()
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const thread = history.value?.threads.find((candidate) => candidate.id === threadId)
    if (!thread) return false
    if (
      thread.messages.some(
        (message) =>
          message.id === chapterId ||
          nativeAgentConversationMessageId(thread.nativeThreadId, message.id) === nativeId
      )
    ) {
      return true
    }
    if (thread.hasOlder === false) return false
    const loaded = await loadOlderAgentConversationTranscript(threadId)
    if (!loaded) return false
  }
  return false
}

function retainHistoryFeed() {
  subscribers += 1
  if (subscribers !== 1) return
  void refreshAgentConversationHistory()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', syncHistoryPolling)
  }
  syncHistoryPolling()
}

function releaseHistoryFeed() {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers !== 0) return
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', syncHistoryPolling)
  }
  pausePolling()
  pauseLiveStream()
}

export { refreshAgentConversationHistory }

export function useAgentConversationHistory() {
  onMounted(retainHistoryFeed)
  onUnmounted(releaseHistoryFeed)
  return {
    error: readonly(error),
    history: shallowReadonly(history),
    refresh: refreshAgentConversationHistory
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    pausePolling()
    pauseLiveStream()
    data.agentHistorySubscribers = subscribers
  })
  if (subscribers > 0) {
    void refreshAgentConversationHistory()
    syncHistoryPolling()
  }
}
