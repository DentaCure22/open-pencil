<script setup lang="ts">
import { computed } from 'vue'

import type { DesignStyleDeclaration } from '@open-pencil/dom-css'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  getBoxModelGapMetrics,
  getBoxModelMetrics,
  type BoxModelEdges
} from '@/app/smylr-live-inspector/box-model'

const { computedStyle, node } = defineProps<{
  computedStyle?: DesignStyleDeclaration
  node: SceneNode
}>()

const EDGE_ORDER: Array<keyof BoxModelEdges> = ['top', 'right', 'bottom', 'left']

const metrics = computed(() =>
  getBoxModelMetrics(
    { height: node.height, width: node.width, x: node.x, y: node.y },
    computedStyle
  )
)
const gap = computed(() => getBoxModelGapMetrics(computedStyle, undefined))

function display(value: number | null) {
  if (value === null) return '—'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function edgeSummary(edges: BoxModelEdges) {
  return EDGE_ORDER.map((edge) => display(edges[edge])).join('  ')
}

const contentSummary = computed(
  () => `${display(metrics.value.contentWidth)} × ${display(metrics.value.contentHeight)}`
)
const gapSummary = computed(() => `row ${display(gap.value.row)}  col ${display(gap.value.column)}`)
const boxSizing = computed(() => computedStyle?.['box-sizing']?.trim() || '—')
</script>

<template>
  <div
    class="min-w-0 rounded-md border border-border/70 bg-muted/[0.04] px-2.5 py-2 text-[10px]"
    data-test-id="computed-box-model"
    aria-label="Computed padding, margin, border, gaps, box sizing, and content size"
  >
    <div class="mb-1.5 flex items-center justify-between">
      <span class="text-[11px] font-medium text-surface">Computed box</span>
      <span class="text-[9px] text-muted">T R B L · px</span>
    </div>

    <dl class="grid grid-cols-[50px_minmax(0,1fr)] gap-x-2 gap-y-1 tabular-nums">
      <dt class="text-muted">Padding</dt>
      <dd data-test-id="computed-box-padding" class="truncate text-surface">
        {{ edgeSummary(metrics.padding) }}
      </dd>
      <dt class="text-muted">Gap</dt>
      <dd data-test-id="computed-box-gap" class="truncate text-surface">{{ gapSummary }}</dd>
      <dt class="text-muted">Margin</dt>
      <dd data-test-id="computed-box-margin" class="truncate text-surface">
        {{ edgeSummary(metrics.margin) }}
      </dd>
      <dt class="text-muted">Border</dt>
      <dd data-test-id="computed-box-border" class="truncate text-surface">
        {{ edgeSummary(metrics.border) }}
      </dd>
      <dt class="text-muted">Box</dt>
      <dd data-test-id="computed-box-sizing" class="truncate text-surface">{{ boxSizing }}</dd>
      <dt class="text-muted">Content</dt>
      <dd data-test-id="computed-box-content" class="truncate text-surface">
        {{ contentSummary }}
      </dd>
    </dl>

    <p class="mt-1.5 text-[9px] leading-tight text-muted/75">— unavailable · 0 computed zero</p>
  </div>
</template>
