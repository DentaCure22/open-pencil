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
const progressStyle = computed(() => {
  const degrees = usedPercent.value * 3.6
  return {
    backgroundImage: `conic-gradient(currentColor 0deg ${String(degrees)}deg, transparent ${String(degrees)}deg 360deg)`,
    maskImage: 'radial-gradient(circle, transparent calc(50% - 3px), black calc(50% - 2px))',
    WebkitMaskImage: 'radial-gradient(circle, transparent calc(50% - 3px), black calc(50% - 2px))'
  }
})
const speedLabel = computed(() => {
  if (contextUsage.tokensPerSecondBasis !== 'streamed-output') return ''
  const speed = contextUsage.tokensPerSecond
  if (speed === undefined || speed <= 0) return ''
  return `${speed < 10 ? speed.toFixed(1) : String(Math.round(speed))} t/s`
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
  if (speedLabel.value) details.push(`${speedLabel.value} measured stream average`)
  if (contextUsage.lastCompactedAt) details.push('Compacted this session')
  return details.join(' · ')
})
</script>

<template>
  <Tip :label="tooltip">
    <span
      :aria-label="tooltip"
      class="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-1.5 text-muted outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-component/30"
      data-test-id="ai-context-indicator"
      role="status"
      tabindex="0"
    >
      <span
        aria-hidden="true"
        class="relative size-5 shrink-0 rounded-full bg-transparent text-component"
        :class="contextUsage.compacting ? 'animate-pulse' : ''"
        data-test-id="ai-context-ring"
      >
        <span class="absolute inset-0 rounded-full border-[3px] border-border/80" />
        <span
          class="absolute inset-0 rounded-full"
          data-test-id="ai-context-progress"
          :style="progressStyle"
        />
      </span>
      <span
        v-if="speedLabel"
        class="whitespace-nowrap font-mono text-[10px] leading-none tabular-nums"
        data-test-id="ai-context-throughput"
      >
        {{ speedLabel }}
      </span>
    </span>
  </Tip>
</template>
