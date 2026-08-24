<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { loadModelMeter } from '@/app/model-meter/load'
import {
  MODEL_METER_RING_RADIUS,
  MODEL_METER_WINDOWS,
  formatMeterPercent,
  formatMeterTokens,
  formatMeterWhen,
  modelMeterAreaPath,
  modelMeterBarWidth,
  modelMeterChartRows,
  modelMeterLinePath,
  modelMeterRingDash,
  modelMeterTotals
} from '@/app/model-meter/presentation'
import type { ModelMeterSnapshot } from '@/app/model-meter/types'
import { useButtonUI } from '@/components/ui/button'

const snapshot = ref<ModelMeterSnapshot | null>(null)
const loading = ref(false)
const days = ref<(typeof MODEL_METER_WINDOWS)[number]>(7)
const refreshButton = useButtonUI({ tone: 'ghost', size: 'sm', bordered: true })

const totals = computed(() =>
  snapshot.value ? modelMeterTotals(snapshot.value) : modelMeterTotals({ rows: [], turns: 0 })
)
const ready = computed(() => Boolean(snapshot.value?.available && snapshot.value.rows.length))
const empty = computed(() => Boolean(snapshot.value) && !ready.value && !loading.value)
const ring = computed(() => modelMeterRingDash(totals.value.tokenCachePercent))
const chartRows = computed(() => (snapshot.value ? modelMeterChartRows(snapshot.value.rows) : []))
const series = computed(() => snapshot.value?.series ?? [])
const linePath = computed(() => modelMeterLinePath(series.value))
const areaPath = computed(() => modelMeterAreaPath(series.value))
const seriesStart = computed(() => series.value[0]?.at ?? null)
const seriesEnd = computed(() => series.value[series.value.length - 1]?.at ?? null)
const status = computed(() => {
  const current = snapshot.value
  if (!current || loading.value) return 'Reading cache…'
  if (!current.available) return 'Could not read the cache log. Refresh after the local chat server reloads.'
  if (current.turns === 0) return 'No turns yet. Finish a chat turn and it will show up here.'
  return `Last ${String(current.days)} days. Prompts are never stored.`
})
const fleetStats = computed(() => [
  { label: 'turns', value: String(totals.value.turns) },
  { label: 'tokens', value: formatMeterTokens(totals.value.promptTokens) },
  { label: 'hits', value: formatMeterPercent(totals.value.callHitPercent) },
  { label: 'cached', value: formatMeterTokens(totals.value.cacheTokens) },
  { label: 'models', value: String(totals.value.models) },
  { label: 'last', value: formatMeterWhen(snapshot.value?.lastAt ?? null) }
])

async function refresh(): Promise<void> {
  loading.value = true
  try {
    snapshot.value = await loadModelMeter(days.value)
  } finally {
    loading.value = false
  }
}

watch(days, () => {
  void refresh()
})

void refresh()
</script>

<template>
  <div data-test-id="model-meter-panel" class="flex min-h-0 flex-1 flex-col overflow-clip">
    <div class="mx-3 mt-2 mb-1 flex shrink-0 items-center gap-1">
      <div
        class="grid flex-1 grid-cols-3 rounded-[12px] bg-chrome-control p-1 ring-1 ring-inset ring-chrome-control-border"
      >
        <button
          v-for="window in MODEL_METER_WINDOWS"
          :key="window"
          type="button"
          class="h-7 cursor-pointer rounded-[9px] text-[11px] font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border"
          :class="
            days === window
              ? 'border-chrome-control-border bg-chrome-control-active text-surface shadow-sm'
              : 'text-muted hover:bg-hover hover:text-surface'
          "
          :data-test-id="`model-meter-days-${String(window)}`"
          @click="days = window"
        >
          {{ window }}d
        </button>
      </div>
      <button
        type="button"
        data-test-id="model-meter-refresh"
        aria-label="Refresh"
        class="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-1 focus-visible:ring-border"
        :disabled="loading"
        @click="refresh"
      >
        <icon-lucide-refresh-cw class="size-3.5" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col px-3 pt-3 pb-3">
      <p v-if="!ready" class="sr-only">{{ status }}</p>

      <div v-if="ready" class="flex min-h-0 flex-1 flex-col gap-4">
        <div class="relative mx-auto size-[120px] shrink-0">
          <svg viewBox="0 0 120 120" class="size-full -rotate-90" aria-hidden="true">
            <circle
              cx="60"
              cy="60"
              :r="MODEL_METER_RING_RADIUS"
              fill="none"
              class="stroke-border"
              stroke-width="7"
            />
            <circle
              cx="60"
              cy="60"
              :r="MODEL_METER_RING_RADIUS"
              fill="none"
              class="stroke-surface"
              stroke-width="7"
              stroke-linecap="round"
              :stroke-dasharray="`${String(ring.dash)} ${String(ring.gap)}`"
            />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-[24px] leading-none font-semibold tracking-[-0.05em] text-surface tabular-nums">
              {{ formatMeterPercent(totals.tokenCachePercent) }}
            </span>
            <span class="mt-1 text-[10px] text-muted">cached</span>
          </div>
        </div>

        <div class="grid w-full grid-cols-3 gap-x-3 gap-y-3">
          <div v-for="stat in fleetStats" :key="stat.label" class="min-w-0 text-center">
            <div class="truncate text-[16px] leading-none font-semibold tracking-[-0.03em] text-surface tabular-nums">
              {{ stat.value }}
            </div>
            <div class="mt-1 text-[10px] text-muted">{{ stat.label }}</div>
          </div>
        </div>

        <div v-if="totals.promptTokens > 0" class="shrink-0">
          <div class="flex h-1.5 overflow-hidden rounded-full bg-border/70">
            <div
              v-for="(row, index) in chartRows"
              :key="`${row.key}-mix`"
              class="h-full bg-surface"
              :style="{
                width: `${String(row.share)}%`,
                opacity: String(Math.max(0.34, 1 - index * 0.22))
              }"
            />
          </div>
          <div class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
            <span v-for="row in chartRows" :key="`${row.key}-legend`">
              {{ row.shortLabel }} {{ row.share }}%
            </span>
          </div>
        </div>

        <section class="shrink-0 space-y-3">
          <article
            v-for="row in chartRows"
            :key="row.key"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="min-w-0 truncate text-[13px] text-surface">{{ row.shortLabel }}</span>
              <span class="shrink-0 text-[13px] text-muted tabular-nums">
                {{ formatMeterPercent(row.cachePercent) }}
              </span>
            </div>
            <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div
                class="h-full rounded-full bg-surface"
                :style="{ width: modelMeterBarWidth(row.cachePercent) }"
              />
            </div>
            <div class="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted">
              <span>
                {{ row.turns }} {{ row.turns === 1 ? 'turn' : 'turns' }} ·
                {{ formatMeterTokens(row.promptTokens) }} ·
                {{ formatMeterPercent(row.callHitPercent) }} hits
              </span>
              <span>{{ formatMeterWhen(row.lastAt) }}</span>
            </div>
          </article>
        </section>

        <section v-if="series.length" class="flex min-h-[160px] flex-1 flex-col">
          <div class="mb-2 flex items-center justify-between gap-2 text-[10px] text-muted">
            <span>Cache over time</span>
            <span v-if="seriesStart && seriesEnd">
              {{ formatMeterWhen(seriesStart) }} → {{ formatMeterWhen(seriesEnd) }}
            </span>
          </div>
          <svg
            class="min-h-0 w-full flex-1 text-surface"
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path :d="areaPath" fill="currentColor" class="opacity-10" />
            <path
              :d="linePath"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.4"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </section>
      </div>

      <div v-else-if="loading" class="flex min-h-0 flex-1 flex-col gap-4">
        <div class="mx-auto size-[120px] animate-pulse rounded-full bg-border/60" />
        <div class="grid grid-cols-3 gap-3">
          <div v-for="slot in 6" :key="slot" class="h-8 animate-pulse rounded bg-border/50" />
        </div>
        <div class="min-h-[160px] flex-1 animate-pulse rounded bg-border/40" />
      </div>

      <div v-else-if="empty" class="flex flex-1 flex-col items-center justify-center px-2 text-center">
        <p class="text-[13px] text-surface">No cache yet</p>
        <p class="mt-1 max-w-[16rem] text-[11px] leading-5 text-muted">{{ status }}</p>
        <button
          type="button"
          :class="[refreshButton.base, 'mt-4']"
          :disabled="loading"
          @click="refresh"
        >
          Try again
        </button>
      </div>
    </div>
  </div>
</template>
