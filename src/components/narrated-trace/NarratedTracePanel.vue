<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import {
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, ref, shallowRef, watch } from 'vue'

import {
  mutationRequestReceipts,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import {
  readLocalWorkspaceTraceEvidenceOverview,
  type LocalWorkspaceTraceEvidenceOverview
} from '@/app/workspace-document/local-authority/client'
import {
  buildNarratedTraceActivityFeed,
  clearNarratedTraceMicTurns,
  loadNarratedTraceActivityPage,
  narratedTraceActivityMetadata,
  narratedTraceEvidenceAnnotationPath,
  narratedTraceHistory,
  narratedTraceLastQuery,
  narratedTraceMicError,
  narratedTraceMicInterimText,
  narratedTraceMicPhase,
  narratedTraceMicTurns,
  narratedTraceSession,
  narratedTraceStatus,
  readNarratedTraceEvidenceImage,
  removeNarratedTraceMicTurn,
  summarizeNarratedTraceRetrieval
} from '@/app/narrated-trace'
import type {
  NarratedTraceActivityPage,
  NarratedTraceActivityItem,
  NarratedTraceRetrievalEventSummary
} from '@/app/narrated-trace'
import Tip from '@/components/ui/Tip.vue'

const FEED_ITEM_LIMIT = 80
const AGENT_RECEIPT_LIMIT = 8
const EAGER_EVIDENCE_PREVIEW_LIMIT = 12

const store = useEditorStore()
const { copy } = useClipboard()
const historicalPage = shallowRef<NarratedTraceActivityPage>({
  hasMore: false,
  items: [],
  nextCursor: null
})
const retainedItems = shallowRef<NarratedTraceActivityItem[]>([])
const evidenceImages = shallowRef<Record<string, string>>({})
const evidenceOverview = shallowRef<LocalWorkspaceTraceEvidenceOverview | null>(null)
const expandedEventIds = ref(new Set<string>())
const activityCursor = ref<string | null>(null)
const newerActivityCursors = ref<Array<string | null>>([])
const activityLoading = ref(false)
const activityLoadError = ref<string | null>(null)
let refreshEpoch = 0
let evidenceRefreshEpoch = 0

function activityTitle(session: NonNullable<typeof narratedTraceSession.value>) {
  return (
    narratedTraceHistory.value.find((record) => record.id === session.id)?.title ??
    session.title ??
    'Recent activity'
  )
}

const currentItems = computed(() => {
  const session = narratedTraceSession.value
  if (!session) return []
  return buildNarratedTraceActivityFeed(
    [{ session, title: activityTitle(session) }],
    FEED_ITEM_LIMIT
  )
})

watch(narratedTraceSession, (session, previousSession) => {
  if (!session || !previousSession || session.id === previousSession.id) return
  retainedItems.value = [
    ...buildNarratedTraceActivityFeed(
      [{ session: previousSession, title: activityTitle(previousSession) }],
      FEED_ITEM_LIMIT
    ),
    ...retainedItems.value
  ].slice(0, FEED_ITEM_LIMIT)
})

const micItems = computed<NarratedTraceActivityItem[]>(() =>
  narratedTraceMicTurns.value.map((turn) => ({
    context: {
      included: true,
      removed: false,
      sourceEventId: turn.id
    },
    event: {
      atMs: 0,
      durationMs: Math.max(0, turn.endedAtEpochMs - turn.startedAtEpochMs),
      id: turn.id,
      kind: 'transcript',
      label: turn.text,
      text: turn.text
    },
    occurredAtMs: turn.startedAtEpochMs,
    scope: structuredClone(turn.scope),
    sessionId: turn.id,
    sessionStartedAt: turn.startedAt,
    title: 'Mic transcript'
  }))
)
const micTurnIds = computed(() => new Set(narratedTraceMicTurns.value.map((turn) => turn.id)))

function micSourceTurnId(item: NarratedTraceActivityItem) {
  if (item.event.origin?.kind === 'voice') return item.event.origin.sourceSessionId ?? null
  return micTurnIds.value.has(item.event.id) ? item.event.id : null
}

watch(micTurnIds, (current, previous) => {
  if (!previous) return
  const removed = new Set([...previous].filter((turnId) => !current.has(turnId)))
  if (removed.size === 0) return
  expandedEventIds.value = new Set(
    [...expandedEventIds.value].filter((eventId) => !removed.has(eventId))
  )
})

function compactRepeatedSelections(items: NarratedTraceActivityItem[]) {
  const compacted: NarratedTraceActivityItem[] = []
  let previousSelectionKey: string | null = null
  for (const item of items) {
    const selectionKey =
      item.event.kind === 'selection' && !item.event.evidence
        ? [
            item.scope?.workspaceId ?? '',
            item.scope?.documentId ?? '',
            item.scope?.pageId ?? '',
            item.event.target?.frameId ?? '',
            item.event.target?.stableId ?? ''
          ].join(':')
        : null
    if (selectionKey && selectionKey === previousSelectionKey) continue
    compacted.push(item)
    previousSelectionKey = selectionKey
  }
  return compacted
}

const activityItems = computed(() => {
  if (activityCursor.value !== null) return historicalPage.value.items
  const byId = new Map<string, NarratedTraceActivityItem>()
  for (const item of [
    ...currentItems.value,
    ...retainedItems.value,
    ...micItems.value,
    ...historicalPage.value.items
  ]) {
    const sourceTurnId = micSourceTurnId(item)
    const key = sourceTurnId ? `voice:${sourceTurnId}` : `${item.sessionId}:${item.event.id}`
    if (!byId.has(key)) byId.set(key, item)
  }
  const ordered = [...byId.values()].sort(
    (first, second) =>
      second.occurredAtMs - first.occurredAtMs ||
      second.event.atMs - first.event.atMs ||
      first.event.id.localeCompare(second.event.id)
  )
  return compactRepeatedSelections(ordered).slice(0, FEED_ITEM_LIMIT)
})

const agentReceipts = computed(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  try {
    return mutationRequestReceipts(store.graph.getNode(store.state.currentPageId))
      .slice(-AGENT_RECEIPT_LIMIT)
      .reverse()
  } catch {
    return []
  }
})

function agentReceiptKey(receipt: MutationRequestReceipt) {
  return `agent:${receipt.requestId}`
}

function agentRouteLabel(route: string) {
  const label = route.replace(/[-_]/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function revealAgentReceipt(receipt: MutationRequestReceipt) {
  const objectIds = revealableAgentObjectIds(receipt)
  if (objectIds.length === 0) return
  store.select(objectIds)
  requestAnimationFrame(() => store.zoomToSelection(editorViewportInsets()))
}

function revealableAgentObjectIds(receipt: MutationRequestReceipt) {
  return receipt.objectIds.filter((id) => Boolean(store.graph.getNode(id)))
}

function canRevealAgentReceipt(receipt: MutationRequestReceipt) {
  return revealableAgentObjectIds(receipt).length > 0
}

function copyAgentReceipt(receipt: MutationRequestReceipt) {
  void copy(JSON.stringify(receipt, null, 2))
}

async function refreshHistory() {
  const epoch = ++refreshEpoch
  activityLoading.value = true
  try {
    const loaded = await loadNarratedTraceActivityPage({
      ...(activityCursor.value ? { before: activityCursor.value } : {}),
      itemLimit: FEED_ITEM_LIMIT
    })
    if (epoch !== refreshEpoch) return false
    historicalPage.value = loaded
    activityLoadError.value = null
    return true
  } catch (error) {
    if (epoch === refreshEpoch) {
      activityLoadError.value = error instanceof Error ? error.message : 'Activity history failed'
    }
    return false
  } finally {
    if (epoch === refreshEpoch) activityLoading.value = false
  }
}

watch(
  narratedTraceHistory,
  () => {
    if (activityCursor.value === null) void refreshHistory()
  },
  { immediate: true }
)

async function showOlderActivity() {
  const cursor = historicalPage.value.nextCursor
  if (!cursor || activityLoading.value) return
  const previousCursor = activityCursor.value
  activityCursor.value = cursor
  if (await refreshHistory()) {
    newerActivityCursors.value = [...newerActivityCursors.value, previousCursor]
  } else {
    activityCursor.value = previousCursor
  }
}

async function showNewerActivity() {
  if (newerActivityCursors.value.length === 0 || activityLoading.value) return
  const cursors = [...newerActivityCursors.value]
  const cursor = cursors.pop() ?? null
  const previousCursor = activityCursor.value
  activityCursor.value = cursor
  if (await refreshHistory()) newerActivityCursors.value = cursors
  else activityCursor.value = previousCursor
}

async function showLatestActivity() {
  if (activityCursor.value === null || activityLoading.value) return
  const previousCursor = activityCursor.value
  const previousNewerCursors = newerActivityCursors.value
  activityCursor.value = null
  if (await refreshHistory()) newerActivityCursors.value = []
  else {
    activityCursor.value = previousCursor
    newerActivityCursors.value = previousNewerCursors
  }
}

function activityEvidence(items = activityItems.value) {
  const byId = new Map<string, NonNullable<NarratedTraceActivityItem['event']['evidence']>>()
  for (const item of items) {
    if (item.event.evidence && !byId.has(item.event.evidence.evidenceId)) {
      byId.set(item.event.evidence.evidenceId, item.event.evidence)
    }
  }
  return [...byId.values()]
}

async function refreshEvidenceOverview(items = activityItems.value) {
  const epoch = ++evidenceRefreshEpoch
  const evidence = activityEvidence(items)
  let overview: LocalWorkspaceTraceEvidenceOverview | null = null
  try {
    overview = await readLocalWorkspaceTraceEvidenceOverview(
      evidence.map((item) => item.evidenceId)
    )
  } catch {
    overview = null
  }
  if (epoch !== evidenceRefreshEpoch) return
  evidenceOverview.value = overview
  const visibleEvidenceIds = new Set(evidence.map((item) => item.evidenceId))
  evidenceImages.value = Object.fromEntries(
    Object.entries(evidenceImages.value).filter(
      ([evidenceId]) =>
        visibleEvidenceIds.has(evidenceId) &&
        overview?.evidence[evidenceId]?.status !== 'evicted' &&
        overview?.evidence[evidenceId]?.status !== 'missing'
    )
  )
  for (const item of evidence.slice(0, EAGER_EVIDENCE_PREVIEW_LIMIT)) {
    void loadEvidenceImage(item.evidenceId)
  }
}

watch(activityItems, (items) => void refreshEvidenceOverview(items), {
  immediate: true
})

const loadingEvidenceIds = new Set<string>()

async function loadEvidenceImage(evidenceId: string) {
  if (evidenceImages.value[evidenceId] || loadingEvidenceIds.has(evidenceId)) return
  const status = evidenceOverview.value?.evidence[evidenceId]?.status
  if (status === 'evicted' || status === 'missing') return
  const evidence = activityEvidence().find((item) => item.evidenceId === evidenceId)
  if (!evidence) return
  loadingEvidenceIds.add(evidenceId)
  try {
    const image = await readNarratedTraceEvidenceImage(evidence)
    if (image && activityEvidence().some((item) => item.evidenceId === evidenceId)) {
      evidenceImages.value = { ...evidenceImages.value, [evidenceId]: image }
    }
  } finally {
    loadingEvidenceIds.delete(evidenceId)
  }
}

const isCapturing = computed(() => narratedTraceStatus.value === 'recording')
const retrievalSummary = computed(() => {
  const receipt = narratedTraceLastQuery.value
  return receipt ? summarizeNarratedTraceRetrieval(receipt) : null
})

function rowText(item: NarratedTraceActivityItem) {
  return item.context.editedText || item.event.text || item.event.label
}

function rowTitle(item: NarratedTraceActivityItem) {
  if (item.event.kind === 'transcript' || item.event.kind === 'tool') return rowText(item)
  return item.event.target?.name?.trim() || rowText(item)
}

function rowAction(item: NarratedTraceActivityItem) {
  const label = item.event.label
  if (label.startsWith('Deleted ')) return 'Deleted'
  if (item.event.kind === 'edit') return 'Edited'
  if (item.event.kind === 'shape') return 'Created'
  if (item.event.kind === 'selection') return 'Selected'
  if (item.event.kind === 'ink') return 'Traced'
  if (item.event.kind === 'screenshot') return 'Focused'
  if (item.event.kind === 'transcript') return 'Spoken'
  return null
}

function rowEvidenceStatus(item: NarratedTraceActivityItem) {
  const evidenceId = item.event.evidence?.evidenceId
  if (evidenceId) {
    return (
      evidenceOverview.value?.evidence[evidenceId]?.status ??
      item.event.evidenceStatus ??
      (evidenceImages.value[evidenceId] ? 'ready' : 'pending')
    )
  }
  return item.event.evidenceStatus ?? null
}

function rowEvidencePinned(item: NarratedTraceActivityItem) {
  const evidenceId = item.event.evidence?.evidenceId
  return evidenceId ? evidenceOverview.value?.evidence[evidenceId]?.pinned === true : false
}

function rowEvidenceLabel(item: NarratedTraceActivityItem) {
  if (rowEvidencePinned(item)) return 'Pinned to active task'
  const status = rowEvidenceStatus(item)
  if (status === 'evicted') return 'Image removed · event kept'
  if (status === 'missing') return 'Image missing'
  if (status === 'failed') return 'Screenshot unavailable'
  if (status === 'pending') return 'Capturing screenshot'
  return null
}

function rowEvidenceTone(item: NarratedTraceActivityItem) {
  if (rowEvidencePinned(item)) return 'text-violet-200/85 bg-violet-300/[0.08]'
  const status = rowEvidenceStatus(item)
  if (status === 'failed' || status === 'missing') {
    return 'text-[var(--color-warning-text)] bg-[var(--color-warning-text)]/[0.06]'
  }
  return 'text-muted/65 bg-white/[0.035]'
}

const evidenceLimitCount = computed(() => evidenceOverview.value?.limits.count ?? 100)
const evidenceLimitBytes = computed(() => evidenceOverview.value?.limits.bytes ?? 250 * 1024 * 1024)
const evidenceCapacityPercent = computed(() => {
  const overview = evidenceOverview.value
  if (!overview) return 0
  const countRatio = overview.usage.count / Math.max(overview.limits.count, 1)
  const byteRatio = overview.usage.bytes / Math.max(overview.limits.bytes, 1)
  return Math.min(100, Math.max(countRatio, byteRatio) * 100)
})

function formatEvidenceBytes(value: number | undefined) {
  if (value === undefined) return '—'
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`
}

function evidenceMenuOpenChanged(open: boolean) {
  if (open) void refreshEvidenceOverview()
}

function isMicTranscript(item: NarratedTraceActivityItem) {
  const turnId = micSourceTurnId(item)
  return item.event.kind === 'transcript' && Boolean(turnId && micTurnIds.value.has(turnId))
}

function deleteMicTranscript(item: NarratedTraceActivityItem) {
  const turnId = micSourceTurnId(item)
  if (!turnId || !isMicTranscript(item)) return
  removeNarratedTraceMicTurn(turnId)
}

function rowTime(item: NarratedTraceActivityItem) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(activityCursor.value !== null ? { day: 'numeric', month: 'short' } : {})
  }).format(new Date(item.occurredAtMs))
}

function compactValue(value: string | undefined) {
  if (!value) return '—'
  const numeric = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) ? Number(value) : null
  if (numeric !== null && Number.isFinite(numeric)) {
    return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  return value.length > 26 ? `${value.slice(0, 23)}…` : value
}

function propertyLabel(property: string) {
  const leaf = property.split('.').at(-1) ?? property
  const spaced = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function rowDetail(item: NarratedTraceActivityItem) {
  const change = item.event.changes?.[0]
  if (!change) return null
  return `${propertyLabel(change.property)} ${compactValue(change.before)} → ${compactValue(change.after)}`
}

function coordinateValue(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function rowCoordinates(item: NarratedTraceActivityItem) {
  const point = item.event.anchor?.pagePoint
  if (!point) return null
  return `x ${coordinateValue(point.x)} · y ${coordinateValue(point.y)}`
}

function rowMetadata(item: NarratedTraceActivityItem) {
  return narratedTraceActivityMetadata(item)
}

function isExpanded(eventId: string) {
  return expandedEventIds.value.has(eventId)
}

function toggleExpanded(eventId: string) {
  const next = new Set(expandedEventIds.value)
  if (next.has(eventId)) next.delete(eventId)
  else {
    next.add(eventId)
    const evidenceId = activityItems.value.find((item) => item.event.id === eventId)?.event.evidence
      ?.evidenceId
    if (evidenceId) void loadEvidenceImage(evidenceId)
  }
  expandedEventIds.value = next
}

function exactTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function retrievalWindowLabel() {
  const window = retrievalSummary.value?.window
  if (!window) return null
  return `${exactTimestamp(window.startedAt)} → ${exactTimestamp(window.endedAt)}`
}

function retrievalEventCoordinates(event: NarratedTraceRetrievalEventSummary) {
  if (!event.anchor) return null
  return `x ${coordinateValue(event.anchor.x)} · y ${coordinateValue(event.anchor.y)}`
}
</script>

<template>
  <div data-test-id="narrated-trace-panel" class="flex min-h-0 flex-1 flex-col">
    <header class="flex min-h-10 shrink-0 items-center border-b border-white/[0.055] px-3 py-1.5">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <h2 class="text-[12px] leading-5 font-semibold tracking-[-0.01em] text-surface">
          Board activity
        </h2>
        <span
          v-if="isCapturing"
          data-test-id="narrated-trace-capture-status"
          class="size-1.5 rounded-full bg-violet-300"
          aria-label="Capturing activity"
        />
      </div>
      <div class="ml-2 flex shrink-0 items-center gap-1">
        <DropdownMenuRoot :modal="false" @update:open="evidenceMenuOpenChanged">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              data-test-id="narrated-trace-evidence-overview-trigger"
              aria-label="Trace evidence storage"
              class="flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[9px] font-medium text-muted/70 outline-none transition-colors hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-component/30 data-[state=open]:bg-hover data-[state=open]:text-surface"
            >
              <icon-lucide-database class="size-3.5" />
              <span v-if="evidenceOverview" class="tabular-nums">
                {{ evidenceOverview.usage.count }}
              </span>
              <IconlyIcon name="arrow-down" class="size-2.5 text-muted/60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              data-test-id="narrated-trace-evidence-overview"
              :side-offset="5"
              align="end"
              class="z-[130] w-[264px] rounded-[12px] border border-chrome-border bg-chrome-raised p-3.5 text-surface shadow-chrome-menu backdrop-blur-2xl outline-none"
            >
              <div class="flex items-start gap-2.5">
                <div
                  class="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-chrome-control-border bg-chrome-control text-component shadow-sm"
                >
                  <icon-lucide-hard-drive class="size-3.5" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[10.5px] font-semibold text-surface">Evidence buffer</span>
                    <span
                      class="flex items-center gap-1 rounded-full bg-[var(--color-success)]/10 px-1.5 py-0.5 text-[8px] font-medium text-[var(--color-success)] ring-1 ring-inset ring-[var(--color-success)]/20"
                    >
                      <icon-lucide-check class="size-2.5" /> Automatic
                    </span>
                  </div>
                  <p class="mt-1 text-[8.5px] leading-3.5 text-muted/75">
                    Oldest unpinned images are removed first. Trace events stay searchable.
                  </p>
                </div>
              </div>

              <div
                class="mt-3 h-1.5 overflow-hidden rounded-full bg-chrome-control ring-1 ring-inset ring-chrome-control-border"
              >
                <div
                  data-test-id="narrated-trace-evidence-capacity"
                  class="h-full rounded-full bg-component transition-[width]"
                  :style="{ width: `${String(evidenceCapacityPercent)}%` }"
                />
              </div>

              <div class="mt-3 grid grid-cols-2 gap-1.5">
                <div
                  class="rounded-[7px] bg-chrome-detail px-2 py-1.5 ring-1 ring-inset ring-chrome-control-border"
                >
                  <div class="text-[8px] font-medium text-muted/70">Captures</div>
                  <div class="mt-0.5 text-[10px] font-medium tabular-nums text-surface">
                    {{ evidenceOverview?.usage.count ?? '—' }} /
                    {{ evidenceLimitCount }}
                  </div>
                </div>
                <div
                  class="rounded-[7px] bg-chrome-detail px-2 py-1.5 ring-1 ring-inset ring-chrome-control-border"
                >
                  <div class="text-[8px] font-medium text-muted/70">Storage</div>
                  <div class="mt-0.5 text-[10px] font-medium tabular-nums text-surface">
                    {{ formatEvidenceBytes(evidenceOverview?.usage.bytes) }} /
                    {{ formatEvidenceBytes(evidenceLimitBytes) }}
                  </div>
                </div>
                <div
                  class="rounded-[7px] bg-chrome-detail px-2 py-1.5 ring-1 ring-inset ring-chrome-control-border"
                >
                  <div class="text-[8px] font-medium text-muted/70">Pinned</div>
                  <div class="mt-0.5 text-[10px] font-medium tabular-nums text-surface">
                    {{ evidenceOverview?.usage.pinnedCount ?? '—' }}
                    {{ evidenceOverview?.usage.pinnedCount === 1 ? 'capture' : 'captures' }}
                  </div>
                </div>
                <div
                  class="rounded-[7px] bg-chrome-detail px-2 py-1.5 ring-1 ring-inset ring-chrome-control-border"
                >
                  <div class="text-[8px] font-medium text-muted/70">Evicted</div>
                  <div class="mt-0.5 text-[10px] font-medium tabular-nums text-surface">
                    {{ evidenceOverview?.usage.evictedCount ?? '—' }} events kept
                  </div>
                </div>
              </div>

              <div
                v-if="evidenceOverview && evidenceOverview.usage.deduplicatedCount > 0"
                class="mt-2.5 flex items-center gap-1.5 border-t border-chrome-border pt-2.5 text-[8.5px] text-muted/70"
              >
                <icon-lucide-copy-check class="size-3 text-component/80" />
                {{ evidenceOverview.usage.deduplicatedCount }} duplicate
                {{ evidenceOverview.usage.deduplicatedCount === 1 ? 'capture' : 'captures' }}
                reused
              </div>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
        <IconButton
          v-if="narratedTraceMicTurns.length > 0"
          data-test-id="narrated-trace-mic-clear"
          label="Clear spoken Trace turns"
          @click="clearNarratedTraceMicTurns"
        >
          <IconlyIcon name="delete" class="size-3.5" />
        </IconButton>
      </div>
    </header>

    <div
      v-if="narratedTraceMicPhase === 'listening'"
      data-test-id="narrated-trace-mic-listening"
      class="border-b border-white/[0.055] px-3 py-2 text-[10px] leading-4 text-violet-200"
    >
      {{ narratedTraceMicInterimText || narratedTraceMicError || 'Listening until you stop…' }}
    </div>
    <div
      v-else-if="narratedTraceMicError"
      data-test-id="narrated-trace-mic-error"
      class="border-b border-white/[0.055] px-3 py-2 text-[10px] leading-4 text-[var(--color-warning-text)]"
    >
      {{ narratedTraceMicError }}
    </div>

    <section
      v-if="retrievalSummary"
      data-test-id="narrated-trace-retrieval-result"
      :data-status="retrievalSummary.status"
      class="mx-2.5 mt-2 rounded-[8px] border border-white/[0.07] bg-white/[0.035] px-2.5 py-2"
    >
      <div class="flex items-start gap-2">
        <icon-lucide-search-check
          class="mt-0.5 size-3.5 shrink-0"
          :class="
            retrievalSummary.status === 'matched'
              ? 'text-emerald-300'
              : retrievalSummary.status === 'error'
                ? 'text-[var(--color-warning-text)]'
                : 'text-amber-200'
          "
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[10.5px] leading-4 font-semibold text-surface">
              {{ retrievalSummary.title }}
            </div>
            <div class="shrink-0 text-[8.5px] leading-4 tabular-nums text-muted/55">
              {{ retrievalSummary.eventCountLabel }}
            </div>
          </div>
          <div
            data-test-id="narrated-trace-retrieval-detail"
            class="mt-0.5 text-[9px] leading-3.5 text-muted/75"
          >
            {{ retrievalSummary.detail }}
          </div>
          <div
            data-test-id="narrated-trace-retrieval-scope"
            class="mt-1 break-words text-[8.5px] leading-3.5 text-muted/55"
          >
            {{ retrievalSummary.scopeLabel }}
          </div>
          <div
            v-if="retrievalSummary.sourceSpokenTurn"
            data-test-id="narrated-trace-retrieval-spoken-turn"
            class="mt-1.5 rounded-md bg-black/10 px-2 py-1.5"
          >
            <div class="font-mono text-[8px] leading-3.5 text-muted/55">
              Spoken turn · {{ retrievalSummary.sourceSpokenTurn.id }}
            </div>
            <div class="mt-0.5 break-words text-[9.5px] leading-4 text-surface/90">
              “{{ retrievalSummary.sourceSpokenTurn.text }}”
            </div>
          </div>
          <div
            v-if="retrievalWindowLabel()"
            data-test-id="narrated-trace-retrieval-window"
            class="mt-1 break-all font-mono text-[8px] leading-3.5 text-muted/55"
          >
            Window {{ retrievalWindowLabel() }}
          </div>
          <div
            v-if="retrievalSummary.matchedBy.length > 0"
            data-test-id="narrated-trace-retrieval-matched-by"
            class="mt-1 text-[8.5px] leading-3.5 text-violet-200/75"
          >
            Matched by {{ retrievalSummary.matchedBy.join(' · ') }}
          </div>
          <ul
            v-if="retrievalSummary.eventSummaries.length > 0"
            data-test-id="narrated-trace-retrieval-events"
            class="mt-1.5 space-y-1 border-t border-white/[0.055] pt-1.5"
          >
            <li v-for="event in retrievalSummary.eventSummaries" :key="event.id" class="min-w-0">
              <div class="truncate text-[9px] leading-3.5 text-surface/85">
                <span class="text-muted/65">{{ event.kind }}</span> ·
                {{ event.label }}
              </div>
              <div
                v-if="event.target || retrievalEventCoordinates(event)"
                data-test-id="narrated-trace-retrieval-event-target"
                class="flex min-w-0 flex-wrap gap-x-1.5 font-mono text-[8px] leading-3.5 text-muted/55"
              >
                <span v-if="event.target" class="min-w-0 truncate">
                  {{ event.target.name }} · ID {{ event.target.stableId }}
                </span>
                <span v-if="retrievalEventCoordinates(event)" class="text-violet-200/70">
                  {{ retrievalEventCoordinates(event) }}
                </span>
              </div>
            </li>
          </ul>
          <div
            v-else-if="retrievalSummary.matchedTitle"
            class="mt-1 text-[8.5px] leading-3.5 text-violet-200/75"
          >
            {{ retrievalSummary.matchedTitle }}
          </div>
        </div>
      </div>
    </section>

    <div data-test-id="narrated-trace-history" class="min-h-0 flex-1 overflow-auto px-2.5 pb-1">
      <section
        v-if="agentReceipts.length > 0"
        data-test-id="agent-activity-feed"
        aria-label="Recent agent changes"
        class="mt-2 overflow-hidden rounded-[8px] border border-violet-300/15 bg-violet-300/[0.035]"
      >
        <div
          class="flex items-center gap-2 border-b border-violet-300/10 px-2.5 py-2 text-[9px] font-semibold tracking-[0.04em] text-violet-200/80 uppercase"
        >
          <icon-lucide-bot class="size-3.5" />
          <span>Agent changes</span>
          <span class="ml-auto tabular-nums text-muted/55">{{ agentReceipts.length }}</span>
        </div>
        <article
          v-for="receipt in agentReceipts"
          :key="receipt.requestId"
          data-test-id="agent-activity-row"
          class="border-b border-violet-300/10 px-2.5 py-2.5 last:border-b-0"
        >
          <div class="flex min-w-0 items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="truncate text-[10.5px] leading-4 font-medium text-surface">
                {{ agentRouteLabel(receipt.route) }}
              </div>
              <div class="mt-0.5 text-[8.5px] leading-3.5 text-muted/65">
                {{ receipt.objectIds.length }}
                {{ receipt.objectIds.length === 1 ? 'object' : 'objects' }} · revision
                {{ receipt.mutationReceipt.appliedRevision }}
              </div>
            </div>
            <button
              type="button"
              data-test-id="agent-activity-reveal"
              class="flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[9px] font-medium text-violet-200/80 hover:bg-violet-300/10 hover:text-violet-100 disabled:opacity-40"
              :disabled="!canRevealAgentReceipt(receipt)"
              @click="revealAgentReceipt(receipt)"
            >
              <icon-lucide-scan-search class="size-3" />
              Reveal
            </button>
            <button
              type="button"
              data-test-id="agent-activity-details"
              class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted/60 hover:bg-violet-300/10 hover:text-surface"
              :aria-label="
                isExpanded(agentReceiptKey(receipt))
                  ? 'Hide agent receipt details'
                  : 'Show agent receipt details'
              "
              @click="toggleExpanded(agentReceiptKey(receipt))"
            >
              <IconlyIcon
                name="arrow-right"
                class="size-3 transition-transform"
                :class="isExpanded(agentReceiptKey(receipt)) ? 'rotate-90' : ''"
              />
            </button>
          </div>
          <div
            v-if="isExpanded(agentReceiptKey(receipt))"
            data-test-id="agent-activity-receipt"
            class="mt-2 rounded-md bg-black/10 p-2 font-mono text-[8px] leading-3.5 text-muted/70"
          >
            <div class="break-all text-surface/80">Request {{ receipt.requestId }}</div>
            <div v-if="receipt.taskId" class="mt-1 break-all">Task {{ receipt.taskId }}</div>
            <div v-if="receipt.traceId" class="break-all">Trace {{ receipt.traceId }}</div>
            <div v-if="receipt.mutationReceipt.touchedProperties.length > 0" class="mt-1">
              {{ receipt.mutationReceipt.touchedProperties.join(' · ') }}
            </div>
            <button
              type="button"
              data-test-id="agent-activity-copy"
              class="mt-2 rounded-[4px] bg-white/[0.055] px-2 py-1 font-sans text-[8.5px] font-medium text-surface hover:bg-white/[0.09]"
              @click="copyAgentReceipt(receipt)"
            >
              Copy receipt
            </button>
          </div>
        </article>
      </section>

      <div
        v-if="activityLoading && activityItems.length === 0 && agentReceipts.length === 0"
        data-test-id="narrated-trace-activity-loading"
        class="flex items-center gap-2 px-1 pt-3 pb-4 text-[9.5px] text-muted/65"
      >
        <icon-lucide-loader-circle class="size-3.5 animate-spin" />
        Loading Board activity…
      </div>

      <div
        v-else-if="activityItems.length === 0 && agentReceipts.length === 0"
        class="px-1 pt-3 pb-4"
      >
        <div class="flex items-start gap-2.5">
          <icon-lucide-history class="mt-0.5 size-4 shrink-0 text-muted/75" />
          <div class="min-w-0 flex-1 pt-0.5">
            <div class="text-[11.5px] leading-4 font-semibold text-surface">
              No Board activity yet
            </div>
            <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/75">
              Agent changes, editor actions, and Trace evidence will appear here.
            </div>
          </div>
        </div>
      </div>

      <section
        v-if="activityItems.length > 0"
        data-test-id="narrated-trace-activity-feed"
        class="mt-1 px-2.5"
      >
        <article
          v-for="item in activityItems"
          :key="`${item.sessionId}:${item.event.id}`"
          :data-test-id="'narrated-trace-row-' + item.event.kind"
          :aria-label="rowMetadata(item) || undefined"
          class="group flex min-w-0 gap-2.5 border-b border-white/[0.05] px-1 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.025]"
        >
          <div
            class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.035] text-muted/75 ring-1 ring-inset ring-white/[0.045]"
            :aria-label="item.event.kind"
          >
            <IconlyIcon
              name="voice"
              v-if="item.event.kind === 'transcript'"
              class="size-3.5 text-violet-200"
            />
            <icon-lucide-mouse-pointer-2
              v-else-if="item.event.kind === 'selection' || item.event.kind === 'tool'"
              class="size-3"
            />
            <IconlyIcon
              name="edit"
              v-else-if="item.event.kind === 'shape' || item.event.kind === 'ink'"
              class="size-3.5"
            />
            <icon-lucide-scan-search
              v-else-if="item.event.kind === 'screenshot'"
              class="size-3.5 text-violet-200"
            />
            <icon-lucide-braces v-else-if="item.event.kind === 'edit'" class="size-3.5" />
            <IconlyIcon name="chat" v-else class="size-3.5" />
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <div
                data-test-id="narrated-trace-row-title"
                class="min-w-0 flex-1 truncate text-[10.5px] leading-4 font-medium text-surface"
              >
                {{ rowTitle(item) }}
              </div>
              <time class="shrink-0 text-[8px] tabular-nums text-muted/45">
                {{ rowTime(item) }}
              </time>
              <Tip v-if="isMicTranscript(item)" label="Delete spoken turn">
                <button
                  type="button"
                  data-test-id="narrated-trace-mic-turn-delete"
                  :aria-label="`Delete spoken turn ${item.event.id}`"
                  class="flex size-5 shrink-0 items-center justify-center rounded text-muted/45 transition-colors hover:bg-white/[0.055] hover:text-surface focus-visible:text-surface"
                  @click.stop="deleteMicTranscript(item)"
                >
                  <IconlyIcon name="delete" class="size-3" />
                </button>
              </Tip>
            </div>

            <div class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <span
                v-if="rowAction(item)"
                data-test-id="narrated-trace-row-action"
                class="shrink-0 text-[8.5px] text-muted/55"
              >
                {{ rowAction(item) }}
              </span>
              <span
                v-if="rowCoordinates(item)"
                data-test-id="narrated-trace-row-coordinates"
                class="font-mono text-[8.5px] tabular-nums text-violet-200/70"
              >
                {{ rowCoordinates(item) }}
              </span>
              <span
                v-if="rowDetail(item)"
                data-test-id="narrated-trace-row-meta"
                class="min-w-0 max-w-full truncate font-mono text-[8.5px] text-muted/55"
              >
                {{ rowDetail(item) }}
              </span>
              <span
                v-if="rowEvidenceLabel(item)"
                data-test-id="narrated-trace-evidence-status"
                class="flex h-4 items-center gap-1 rounded px-1.5 text-[8px]"
                :class="rowEvidenceTone(item)"
              >
                <icon-lucide-pin v-if="rowEvidencePinned(item)" class="size-2.5" />
                <icon-lucide-image-off
                  v-else-if="rowEvidenceStatus(item) === 'evicted'"
                  class="size-2.5"
                />
                <icon-lucide-loader-circle
                  v-else-if="rowEvidenceStatus(item) === 'pending'"
                  class="size-2.5 animate-spin"
                />
                <IconlyIcon name="danger" v-else class="size-2.5" />
                {{ rowEvidenceLabel(item) }}
              </span>
              <button
                v-if="item.event.evidence || rowMetadata(item) || item.event.changes?.length"
                type="button"
                data-test-id="narrated-trace-row-details-toggle"
                class="pointer-events-none ml-auto flex size-4 shrink-0 items-center justify-center rounded text-muted/55 opacity-0 transition-[opacity,background-color,color] hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 data-[expanded=true]:pointer-events-auto data-[expanded=true]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                :aria-expanded="isExpanded(item.event.id)"
                :aria-label="
                  isExpanded(item.event.id) ? 'Hide Trace details' : 'Show Trace details'
                "
                :data-expanded="isExpanded(item.event.id)"
                @click.stop="toggleExpanded(item.event.id)"
              >
                <IconlyIcon
                  name="arrow-right"
                  class="size-3 transition-transform duration-150"
                  :class="isExpanded(item.event.id) ? 'rotate-90' : ''"
                />
              </button>
            </div>

            <div
              v-if="
                item.event.evidence &&
                evidenceImages[item.event.evidence.evidenceId] &&
                isExpanded(item.event.id)
              "
              class="relative mt-2 overflow-hidden rounded-md border border-border/70 bg-black/20"
            >
              <img
                :src="evidenceImages[item.event.evidence.evidenceId]"
                :alt="`Expanded context snapshot for ${rowTitle(item)}`"
                class="block w-full"
              />
              <svg
                v-if="
                  !item.event.evidence.annotationBaked && item.event.evidence.omissions.length === 0
                "
                class="pointer-events-none absolute inset-0 size-full"
                :viewBox="`0 0 ${item.event.evidence.cropBounds.width} ${item.event.evidence.cropBounds.height}`"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <path
                  :d="
                    narratedTraceEvidenceAnnotationPath({
                      context: item.context,
                      event: item.event
                    })
                  "
                  fill="none"
                  :stroke="item.event.evidence.annotation.color"
                  :stroke-width="item.event.evidence.annotation.strokeWidth"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>

            <div
              v-if="isExpanded(item.event.id) && (rowMetadata(item) || item.event.changes?.length)"
              class="mt-2 rounded-md bg-hover/60 p-2"
            >
              <div v-if="rowMetadata(item)" class="mb-2 break-words text-[8.5px] text-muted/65">
                {{ rowMetadata(item) }}
              </div>
              <div v-if="item.event.changes?.length" class="space-y-1">
                <div
                  v-for="change in item.event.changes"
                  :key="change.property"
                  class="break-words font-mono text-[9px] leading-3.5 text-muted"
                >
                  <span class="text-surface">{{ change.property }}</span
                  >: {{ change.before ?? 'unknown' }} →
                  {{ change.after ?? 'removed' }}
                </div>
              </div>
            </div>
          </div>

          <button
            v-if="item.event.evidence && evidenceImages[item.event.evidence.evidenceId]"
            type="button"
            data-test-id="narrated-trace-evidence-toggle"
            class="relative size-9 shrink-0 overflow-hidden rounded-[6px] border border-border/65 bg-black/15 transition-colors hover:border-white/20"
            :aria-label="isExpanded(item.event.id) ? 'Collapse evidence' : 'Expand evidence'"
            @click="toggleExpanded(item.event.id)"
          >
            <img
              data-test-id="narrated-trace-evidence-image"
              :data-evidence-source="item.event.evidence.source"
              :src="evidenceImages[item.event.evidence.evidenceId]"
              :alt="`Context snapshot for ${rowTitle(item)}`"
              class="size-full object-cover"
            />
          </button>
          <button
            v-else-if="item.event.evidence && rowEvidenceStatus(item) === 'ready'"
            type="button"
            data-test-id="narrated-trace-evidence-load"
            class="flex size-9 shrink-0 items-center justify-center rounded-[6px] border border-border/55 bg-black/10 text-muted/50 transition-colors hover:border-white/20 hover:text-surface"
            :aria-label="`Load context snapshot for ${rowTitle(item)}`"
            @click="toggleExpanded(item.event.id)"
          >
            <IconlyIcon name="image" class="size-3.5" />
          </button>
          <div
            v-else-if="item.event.evidence && rowEvidenceStatus(item) !== 'pending'"
            class="flex size-9 shrink-0 items-center justify-center rounded-[6px] border border-border/55 bg-black/10 text-muted/40"
            aria-hidden="true"
          >
            <icon-lucide-image-off class="size-3.5" />
          </div>
        </article>

        <div
          v-if="
            historicalPage.nextCursor ||
            newerActivityCursors.length > 0 ||
            activityLoadError ||
            activityLoading
          "
          data-test-id="narrated-trace-activity-pagination"
          class="flex min-h-9 items-center gap-1.5 border-t border-white/[0.055] px-2 py-1.5"
        >
          <button
            v-if="newerActivityCursors.length > 0"
            type="button"
            data-test-id="narrated-trace-activity-newer"
            :disabled="activityLoading"
            class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[8.5px] font-medium text-muted/70 hover:bg-white/[0.055] hover:text-surface disabled:opacity-40"
            @click="showNewerActivity"
          >
            <IconlyIcon name="arrow-up" class="size-3" /> Newer
          </button>
          <button
            v-if="activityCursor !== null"
            type="button"
            data-test-id="narrated-trace-activity-latest"
            :disabled="activityLoading"
            class="h-6 rounded-[5px] px-1.5 text-[8.5px] font-medium text-muted/55 hover:bg-white/[0.055] hover:text-surface disabled:opacity-40"
            @click="showLatestActivity"
          >
            Latest
          </button>
          <span
            v-if="activityLoadError"
            data-test-id="narrated-trace-activity-error"
            class="min-w-0 flex-1 truncate text-[8px] text-[var(--color-warning-text)]"
          >
            {{ activityLoadError }}
          </span>
          <span v-else class="flex-1" />
          <icon-lucide-loader-circle
            v-if="activityLoading"
            class="size-3 animate-spin text-muted/50"
          />
          <button
            v-if="historicalPage.nextCursor"
            type="button"
            data-test-id="narrated-trace-activity-older"
            :disabled="activityLoading"
            class="flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[8.5px] font-medium text-violet-200/75 hover:bg-violet-300/10 hover:text-violet-100 disabled:opacity-40"
            @click="showOlderActivity"
          >
            Earlier <IconlyIcon name="arrow-down" class="size-3" />
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
