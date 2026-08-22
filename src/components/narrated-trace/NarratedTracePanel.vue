<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'

import {
  mutationRequestReceipts,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { currentLocalWorkspaceAuthorityStatus } from '@/app/workspace-document/local-authority/client'
import {
  DURABLE_HISTORY_LABEL,
  latestAppliedBoardTransaction
} from '@/app/workspace-document/local-authority/history'
import {
  buildNarratedTraceActivityFeed,
  clearNarratedTraceMicTurns,
  loadNarratedTraceActivityFeed,
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
  NarratedTraceActivityItem,
  NarratedTraceRetrievalEventSummary
} from '@/app/narrated-trace'
import Tip from '@/components/ui/Tip.vue'

const FEED_ITEM_LIMIT = 80
const AGENT_RECEIPT_LIMIT = 8

const store = useEditorStore()
const { copy } = useClipboard()
const historicalItems = shallowRef<NarratedTraceActivityItem[]>([])
const retainedItems = shallowRef<NarratedTraceActivityItem[]>([])
const evidenceImages = shallowRef<Record<string, string>>({})
const expandedEventIds = ref(new Set<string>())
const historyEpoch = ref(0)
let refreshEpoch = 0

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
  const byId = new Map<string, NarratedTraceActivityItem>()
  for (const item of [
    ...currentItems.value,
    ...retainedItems.value,
    ...micItems.value,
    ...historicalItems.value
  ]) {
    const key = `${item.sessionId}:${item.event.id}`
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

const latestUndoableAgentRequestId = computed(() => {
  void store.state.sceneVersion
  void historyEpoch.value
  const authority = currentLocalWorkspaceAuthorityStatus()
  if (!authority || authority.state !== 'ready' || store.undo.undoLabel !== DURABLE_HISTORY_LABEL) {
    return null
  }
  const transaction = latestAppliedBoardTransaction(store, authority.revision)
  return transaction?.pageId === store.state.currentPageId ? transaction.requestId : null
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

function undoAgentReceipt(receipt: MutationRequestReceipt) {
  if (latestUndoableAgentRequestId.value !== receipt.requestId) return
  store.undoAction()
  historyEpoch.value += 1
}

async function refreshHistory() {
  const epoch = ++refreshEpoch
  const loaded = await loadNarratedTraceActivityFeed({ itemLimit: FEED_ITEM_LIMIT })
  if (epoch === refreshEpoch) historicalItems.value = loaded
}

watch(narratedTraceHistory, () => void refreshHistory(), { immediate: true })

watch(
  activityItems,
  async (items) => {
    const evidence = items.flatMap((item) => (item.event.evidence ? [item.event.evidence] : []))
    const loaded = await Promise.all(
      evidence.map(
        async (item) => [item.evidenceId, await readNarratedTraceEvidenceImage(item)] as const
      )
    )
    evidenceImages.value = Object.fromEntries(
      loaded.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
    )
  },
  { immediate: true }
)

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

function isMicTranscript(item: NarratedTraceActivityItem) {
  return item.event.kind === 'transcript' && micTurnIds.value.has(item.event.id)
}

function deleteMicTranscript(item: NarratedTraceActivityItem) {
  if (!isMicTranscript(item)) return
  removeNarratedTraceMicTurn(item.event.id)
}

function rowTime(item: NarratedTraceActivityItem) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
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
  else next.add(eventId)
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
    <header class="flex min-h-14 shrink-0 items-center border-b border-white/[0.055] px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
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
        <p class="truncate text-[9.5px] leading-3.5 text-muted/70">
          Human and agent changes, anchored to this Board
        </p>
      </div>
      <div class="ml-2 flex shrink-0 items-center gap-1">
        <IconButton
          v-if="narratedTraceMicTurns.length > 0"
          data-test-id="narrated-trace-mic-clear"
          label="Clear spoken Trace turns"
          @click="clearNarratedTraceMicTurns"
        >
          <icon-lucide-trash-2 class="size-3.5" />
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
                <span class="text-muted/65">{{ event.kind }}</span> · {{ event.label }}
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
              v-if="latestUndoableAgentRequestId === receipt.requestId"
              type="button"
              data-test-id="agent-activity-undo"
              aria-label="Undo latest agent change"
              class="flex h-6 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[9px] font-medium text-muted/70 hover:bg-violet-300/10 hover:text-surface"
              @click="undoAgentReceipt(receipt)"
            >
              <icon-lucide-undo-2 class="size-3" />
              Undo
            </button>
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
              <icon-lucide-chevron-right
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

      <div v-if="activityItems.length === 0 && agentReceipts.length === 0" class="px-1 pt-3 pb-4">
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

      <div v-if="activityItems.length > 0" data-test-id="narrated-trace-activity-feed" class="pt-1">
        <article
          v-for="item in activityItems"
          :key="`${item.sessionId}:${item.event.id}`"
          :data-test-id="'narrated-trace-row-' + item.event.kind"
          :aria-label="rowMetadata(item) || undefined"
          class="group grid grid-cols-[3.75rem_1.25rem_minmax(0,1fr)] gap-x-1.5 rounded-[7px] px-1.5 py-2.5 transition-colors hover:bg-white/[0.055]"
        >
          <time class="pt-0.5 text-[8.5px] leading-4 tabular-nums text-muted/55">
            {{ rowTime(item) }}
          </time>
          <div
            class="flex size-5 items-center justify-center text-muted"
            :aria-label="item.event.kind"
          >
            <icon-lucide-mic
              v-if="item.event.kind === 'transcript'"
              class="size-3.5 text-violet-200"
            />
            <icon-lucide-mouse-pointer-2
              v-else-if="item.event.kind === 'selection' || item.event.kind === 'tool'"
              class="size-3"
            />
            <icon-lucide-pencil
              v-else-if="item.event.kind === 'shape' || item.event.kind === 'ink'"
              class="size-3.5"
            />
            <icon-lucide-scan-search
              v-else-if="item.event.kind === 'screenshot'"
              class="size-3.5 text-violet-200"
            />
            <icon-lucide-braces v-else-if="item.event.kind === 'edit'" class="size-3.5" />
            <icon-lucide-message-square v-else class="size-3.5" />
          </div>

          <div class="min-w-0">
            <div class="flex min-w-0 items-start gap-1.5">
              <div
                data-test-id="narrated-trace-row-title"
                class="min-w-0 flex-1 truncate pt-0.5 text-[11px] leading-4 font-medium text-surface"
              >
                {{ rowTitle(item) }}
              </div>
              <span
                v-if="rowAction(item)"
                data-test-id="narrated-trace-row-action"
                class="shrink-0 pt-0.5 text-[9px] leading-4 text-muted/65"
              >
                {{ rowAction(item) }}
              </span>
              <Tip v-if="isMicTranscript(item)" label="Delete spoken turn">
                <button
                  type="button"
                  data-test-id="narrated-trace-mic-turn-delete"
                  :aria-label="`Delete spoken turn ${item.event.id}`"
                  class="flex size-5 shrink-0 items-center justify-center rounded text-muted/45 transition-colors hover:bg-white/[0.055] hover:text-surface focus-visible:text-surface"
                  @click.stop="deleteMicTranscript(item)"
                >
                  <icon-lucide-trash-2 class="size-3" />
                </button>
              </Tip>
              <button
                v-if="item.event.evidence"
                type="button"
                data-test-id="narrated-trace-evidence-toggle"
                class="relative size-11 shrink-0 overflow-hidden rounded-[6px] border border-border/70 bg-black/15 transition-colors hover:border-white/20"
                :aria-label="isExpanded(item.event.id) ? 'Collapse evidence' : 'Expand evidence'"
                @click="toggleExpanded(item.event.id)"
              >
                <img
                  v-if="evidenceImages[item.event.evidence.evidenceId]"
                  data-test-id="narrated-trace-evidence-image"
                  :data-evidence-source="item.event.evidence.source"
                  :src="evidenceImages[item.event.evidence.evidenceId]"
                  :alt="`Context snapshot for ${rowTitle(item)}`"
                  class="size-full object-cover"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-[8px] text-muted"
                >
                  …
                </span>
              </button>
            </div>

            <div
              v-if="rowCoordinates(item)"
              data-test-id="narrated-trace-row-coordinates"
              class="mt-0.5 font-mono text-[9.5px] leading-3.5 tabular-nums text-violet-200/75"
            >
              {{ rowCoordinates(item) }}
            </div>

            <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9.5px] leading-3.5">
              <span
                v-if="rowDetail(item)"
                data-test-id="narrated-trace-row-meta"
                class="min-w-0 truncate font-mono text-muted/60"
              >
                {{ rowDetail(item) }}
              </span>
              <button
                v-if="rowMetadata(item) || item.event.changes?.length"
                type="button"
                data-test-id="narrated-trace-row-details-toggle"
                class="flex shrink-0 items-center gap-0.5 text-muted/65 hover:text-surface"
                :aria-label="
                  isExpanded(item.event.id) ? 'Hide Trace details' : 'Show Trace details'
                "
                @click="toggleExpanded(item.event.id)"
              >
                <icon-lucide-chevron-right
                  class="size-2.5 transition-transform"
                  :class="isExpanded(item.event.id) ? 'rotate-90' : ''"
                />
                <span v-if="(item.event.changes?.length ?? 0) > 1">
                  {{ item.event.changes?.length }} changes
                </span>
              </button>
            </div>

            <div
              v-if="item.event.evidence && isExpanded(item.event.id)"
              class="relative mt-2 overflow-hidden rounded-md border border-border/70 bg-black/20"
            >
              <img
                v-if="evidenceImages[item.event.evidence.evidenceId]"
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
              v-else-if="!item.event.evidence && item.event.evidenceStatus"
              data-test-id="narrated-trace-evidence-status"
              class="mt-2 flex h-16 items-center justify-center rounded-md border border-border/70 bg-black/10 px-3 text-center text-[9px]"
              :class="
                item.event.evidenceStatus === 'failed'
                  ? 'text-[var(--color-warning-text)]'
                  : 'text-muted'
              "
            >
              {{
                item.event.evidenceStatus === 'failed'
                  ? 'Screenshot unavailable. Try Focus again.'
                  : 'Capturing the highlighted screen…'
              }}
            </div>

            <div v-if="isExpanded(item.event.id)" class="mt-2 rounded-md bg-hover/60 p-2">
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
                  >: {{ change.before ?? 'unknown' }} → {{ change.after ?? 'removed' }}
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
