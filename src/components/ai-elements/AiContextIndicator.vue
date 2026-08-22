<script setup lang="ts">
import { computed } from 'vue'

import Tip from '@/components/ui/Tip.vue'

import type { AgentConversationContextUsage } from '@/app/agent-chat/client'

const { contextUsage } = defineProps<{
  contextUsage: AgentConversationContextUsage
}>()

function boundedPercent(value: number | null): number {
  if (value === null) return 0
  return Math.min(100, Math.max(0, value))
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

function formatEstimatedPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}%`
}

const usedPercent = computed(() => boundedPercent(contextUsage.percent))
const remainingPercent = computed(() => Math.max(0, 100 - usedPercent.value))
const ringCircumference = 2 * Math.PI * 5
const progressDasharray = computed(
  () => `${String((usedPercent.value / 100) * ringCircumference)} ${String(ringCircumference)}`
)
const hasThroughput = computed(
  () =>
    contextUsage.tokensPerSecondBasis === 'streamed-output' &&
    contextUsage.tokensPerSecond !== undefined &&
    contextUsage.tokensPerSecond > 0
)
const speedLabel = computed(() => {
  if (!hasThroughput.value) return '— t/s'
  const speed = contextUsage.tokensPerSecond
  if (speed === undefined) return '— t/s'
  const prefix = contextUsage.tokensPerSecondEstimated ? '~' : ''
  return `${prefix}${speed < 10 ? speed.toFixed(1) : String(Math.round(speed))} t/s`
})
const tooltip = computed(() => {
  if (contextUsage.compacting) return 'Compacting context…'
  const remaining = contextUsage.tokensEstimated
    ? formatEstimatedPercent(remainingPercent.value)
    : formatPercent(remainingPercent.value)
  const context =
    contextUsage.tokens === null
      ? 'Context recalculating'
      : `${contextUsage.tokensEstimated ? '~' : ''}${remaining} context left · ${contextUsage.tokensEstimated ? '~' : ''}${formatTokens(contextUsage.tokens)} / ${formatTokens(contextUsage.contextWindow)}`
  const details = [
    context,
    contextUsage.autoCompactionEnabled ? 'Auto-compaction on' : 'Auto-compaction off'
  ]
  if (contextUsage.cacheHitPercent !== undefined) {
    details.push(`${formatPercent(contextUsage.cacheHitPercent)} cached`)
  }
  details.push(
    hasThroughput.value
      ? `${speedLabel.value} ${contextUsage.tokensPerSecondEstimated ? 'estimated from streamed text' : 'measured stream average'}`
      : 'Throughput unavailable'
  )
  if (contextUsage.lastCompactedAt) details.push('Compacted this session')
  return details.join(' · ')
})
</script>

<template>
  <Tip :label="tooltip">
    <span
      :aria-label="tooltip"
      class="flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-1 text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-component/30"
      data-test-id="ai-context-indicator"
      role="status"
      tabindex="0"
    >
      <svg
        aria-hidden="true"
        class="relative size-3 shrink-0 overflow-hidden rounded-full bg-transparent text-component"
        :class="contextUsage.compacting ? 'animate-pulse' : ''"
        data-test-id="ai-context-ring"
        viewBox="0 0 12 12"
      >
        <circle
          class="stroke-border"
          cx="6"
          cy="6"
          fill="none"
          opacity="0.8"
          r="5"
          stroke-width="1"
        />
        <circle
          :class="contextUsage.compacting ? 'opacity-45' : ''"
          cx="6"
          cy="6"
          data-test-id="ai-context-progress"
          fill="none"
          r="5"
          stroke="currentColor"
          :stroke-dasharray="progressDasharray"
          stroke-linecap="round"
          stroke-width="1.1"
          transform="rotate(-90 6 6)"
        />
      </svg>
      <span
        class="whitespace-nowrap font-mono text-[9.5px] font-medium leading-none tracking-[-0.02em] tabular-nums"
        :class="hasThroughput ? '' : 'text-muted/55'"
        data-test-id="ai-context-throughput"
      >
        {{ speedLabel }}
      </span>
    </span>
  </Tip>
</template>
