<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'

import {
  buildNarratedTraceActivityFeed,
  loadNarratedTraceActivityFeed,
  narratedTraceEvidenceAnnotationPath,
  narratedTraceHistory,
  narratedTraceSession,
  narratedTraceStatus,
  readNarratedTraceEvidenceImage
} from '@/app/narrated-trace'
import type { NarratedTraceActivityItem } from '@/app/narrated-trace'

const FEED_ITEM_LIMIT = 80

const historicalItems = shallowRef<NarratedTraceActivityItem[]>([])
const evidenceImages = shallowRef<Record<string, string>>({})
const expandedEventIds = ref(new Set<string>())
let refreshEpoch = 0

const currentItems = computed(() => {
  const session = narratedTraceSession.value
  if (!session) return []
  const title =
    narratedTraceHistory.value.find((record) => record.id === session.id)?.title ??
    session.title ??
    'Recent activity'
  return buildNarratedTraceActivityFeed([{ session, title }], FEED_ITEM_LIMIT)
})

const activityItems = computed(() => {
  const byId = new Map<string, NarratedTraceActivityItem>()
  for (const item of [...currentItems.value, ...historicalItems.value]) {
    const key = `${item.sessionId}:${item.event.id}`
    if (!byId.has(key)) byId.set(key, item)
  }
  return [...byId.values()]
    .sort(
      (first, second) =>
        second.occurredAtMs - first.occurredAtMs ||
        second.event.atMs - first.event.atMs ||
        first.event.id.localeCompare(second.event.id)
    )
    .slice(0, FEED_ITEM_LIMIT)
})

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

const isCapturing = computed(
  () => narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused'
)

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
  return null
}

function rowTime(item: NarratedTraceActivityItem) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
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
  const target = item.event.target
  const details = [
    target?.route,
    target?.path.join(' / '),
    target?.frameId ? `Frame ${target.frameId}` : undefined,
    target?.stableId ? `ID ${target.stableId}` : undefined
  ].filter((detail): detail is string => typeof detail === 'string' && detail.length > 0)
  return [...new Set(details)].join(' · ')
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
</script>

<template>
  <div data-test-id="narrated-trace-panel" class="flex min-h-0 flex-1 flex-col">
    <header class="flex min-h-14 shrink-0 items-center border-b border-white/[0.055] px-3 py-2.5">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h2 class="text-[12px] leading-5 font-semibold tracking-[-0.01em] text-surface">
            History
          </h2>
          <span
            v-if="isCapturing"
            data-test-id="narrated-trace-capture-status"
            class="size-1.5 rounded-full"
            :class="narratedTraceStatus === 'recording' ? 'bg-violet-300' : 'bg-amber-300'"
            aria-label="Capturing activity"
          />
        </div>
        <p class="truncate text-[9.5px] leading-3.5 text-muted/70">
          Trace gestures and completed editor actions
        </p>
      </div>
    </header>

    <div data-test-id="narrated-trace-history" class="min-h-0 flex-1 overflow-auto px-2.5 pb-1">
      <div v-if="activityItems.length === 0" class="px-1 pt-3 pb-4">
        <div class="flex items-start gap-2.5">
          <icon-lucide-history class="mt-0.5 size-4 shrink-0 text-muted/75" />
          <div class="min-w-0 flex-1 pt-0.5">
            <div class="text-[11.5px] leading-4 font-semibold text-surface">No activity yet</div>
            <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/75">
              Trace a region or make an editor change to build context.
            </div>
          </div>
        </div>
      </div>

      <div v-else data-test-id="narrated-trace-activity-feed" class="pt-1">
        <article
          v-for="item in activityItems"
          :key="`${item.sessionId}:${item.event.id}`"
          :data-test-id="'narrated-trace-row-' + item.event.kind"
          :aria-label="rowMetadata(item) || undefined"
          class="group grid grid-cols-[3.25rem_1.25rem_minmax(0,1fr)] gap-x-1.5 rounded-[7px] px-1.5 py-2.5 transition-colors hover:bg-white/[0.055]"
        >
          <time class="pt-0.5 text-[8.5px] leading-4 tabular-nums text-muted/55">
            {{ rowTime(item) }}
          </time>
          <div
            class="flex size-5 items-center justify-center text-muted"
            :aria-label="item.event.kind"
          >
            <icon-lucide-mouse-pointer-2
              v-if="item.event.kind === 'selection' || item.event.kind === 'tool'"
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

            <div
              v-if="rowDetail(item) || (item.event.changes?.length ?? 0) > 1"
              class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9.5px] leading-3.5"
            >
              <span
                v-if="rowDetail(item)"
                data-test-id="narrated-trace-row-meta"
                class="min-w-0 truncate font-mono text-muted/60"
              >
                {{ rowDetail(item) }}
              </span>
              <button
                v-if="(item.event.changes?.length ?? 0) > 1"
                class="flex shrink-0 items-center gap-0.5 text-muted/65 hover:text-surface"
                @click="toggleExpanded(item.event.id)"
              >
                <icon-lucide-chevron-right
                  class="size-2.5 transition-transform"
                  :class="isExpanded(item.event.id) ? 'rotate-90' : ''"
                />
                {{ item.event.changes?.length }} changes
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
