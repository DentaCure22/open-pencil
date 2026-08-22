<script setup lang="ts">
import type { DesignStyleDeclaration } from '@open-pencil/dom-css'
import { computed } from 'vue'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  type BoxModelEdge,
  type BoxModelEdges,
  getBoxModelMetrics,
  getGapMeasurements
} from '@/app/smylr-live-inspector/box-model'

type SpacingMeasurementsProps = {
  frameHeight: number
  frameWidth: number
  height: number
  node: SmylrLiveContainerNode
  originX: number
  originY: number
  previewStyle?: DesignStyleDeclaration
  width: number
  zoom: number
}
type BoxModelLayer = 'margin' | 'border' | 'padding'
type BoxModelMarker = {
  edge: BoxModelEdge
  label: string
  layer: BoxModelLayer
  style: Record<string, string>
}

const { frameHeight, frameWidth, height, node, originX, originY, previewStyle, width, zoom } =
  defineProps<SpacingMeasurementsProps>()
const EDGE_ORDER: BoxModelEdge[] = ['top', 'right', 'bottom', 'left']
const safeZoom = computed(() => Math.max(zoom, 0.01))
const metrics = computed(() =>
  getBoxModelMetrics({ height, width, x: originX, y: originY }, node.computedStyle, previewStyle)
)

function value(edges: BoxModelEdges, edge: BoxModelEdge) {
  return Math.max(0, edges[edge] ?? 0)
}

function markerStyle(layer: BoxModelLayer, edge: BoxModelEdge) {
  const border = metrics.value.border
  const amount = value(metrics.value[layer], edge)
  const borderLeft = value(border, 'left')
  const borderRight = value(border, 'right')
  const borderTop = value(border, 'top')
  const borderBottom = value(border, 'bottom')
  const insetX = layer === 'padding' ? borderLeft : 0
  const insetY = layer === 'padding' ? borderTop : 0
  const innerWidth = width - (layer === 'padding' ? borderLeft + borderRight : 0)
  const innerHeight = height - (layer === 'padding' ? borderTop + borderBottom : 0)

  if (layer === 'margin') {
    if (edge === 'top')
      return { height: `${amount}px`, left: '0', top: `${-amount}px`, width: '100%' }
    if (edge === 'right') return { height: '100%', left: '100%', top: '0', width: `${amount}px` }
    if (edge === 'bottom') return { height: `${amount}px`, left: '0', top: '100%', width: '100%' }
    return { height: '100%', left: `${-amount}px`, top: '0', width: `${amount}px` }
  }
  if (edge === 'top') {
    return {
      height: `${amount}px`,
      left: `${insetX}px`,
      top: `${insetY}px`,
      width: `${Math.max(0, innerWidth)}px`
    }
  }
  if (edge === 'right') {
    return {
      height: `${Math.max(0, innerHeight)}px`,
      left: `${insetX + innerWidth - amount}px`,
      top: `${insetY}px`,
      width: `${amount}px`
    }
  }
  if (edge === 'bottom') {
    return {
      height: `${amount}px`,
      left: `${insetX}px`,
      top: `${insetY + innerHeight - amount}px`,
      width: `${Math.max(0, innerWidth)}px`
    }
  }
  return {
    height: `${Math.max(0, innerHeight)}px`,
    left: `${insetX}px`,
    top: `${insetY}px`,
    width: `${amount}px`
  }
}

const boxModelMarkers = computed<BoxModelMarker[]>(() => {
  const layers: BoxModelLayer[] = ['margin', 'border', 'padding']
  return layers.flatMap((layer) => {
    const seen = new Set<number>()
    return EDGE_ORDER.flatMap((edge) => {
      const amount = value(metrics.value[layer], edge)
      if (amount <= 0) return []
      const showLabel = !seen.has(amount)
      seen.add(amount)
      return [
        {
          edge,
          label: showLabel ? `${Math.round(amount * 10) / 10}` : '',
          layer,
          style: markerStyle(layer, edge)
        }
      ]
    })
  })
})
const contentStyle = computed(() => {
  const border = metrics.value.border
  const padding = metrics.value.padding
  return {
    height: `${metrics.value.contentHeight}px`,
    left: `${value(border, 'left') + value(padding, 'left')}px`,
    top: `${value(border, 'top') + value(padding, 'top')}px`,
    width: `${metrics.value.contentWidth}px`
  }
})
const contentLabel = computed(
  () => `${Math.round(metrics.value.contentWidth)} × ${Math.round(metrics.value.contentHeight)}`
)
const gaps = computed(() => getGapMeasurements(node, previewStyle))
const labeledGapKeys = computed(() => {
  const seen = new Set<string>()
  return gaps.value.map((gap) => {
    const key = `${gap.axis}:${gap.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})
const guideStyle = computed(() => {
  const stroke = 1 / safeZoom.value
  const dash = 5 / safeZoom.value
  const gap = 4 / safeZoom.value
  return { dash, gap, stroke }
})
const labelStyle = computed(() => ({
  borderRadius: `${2 / safeZoom.value}px`,
  fontSize: `${9 / safeZoom.value}px`,
  padding: `${1 / safeZoom.value}px ${3 / safeZoom.value}px`
}))
</script>

<template>
  <span
    data-test-id="smylr-live-center-guide-horizontal"
    class="pointer-events-none absolute"
    :style="{
      height: `${guideStyle.stroke}px`,
      left: `${-originX}px`,
      top: '50%',
      width: `${frameWidth}px`,
      backgroundImage: `repeating-linear-gradient(to right, color-mix(in srgb, var(--color-accent) 58%, transparent) 0 ${guideStyle.dash}px, transparent ${guideStyle.dash}px ${guideStyle.dash + guideStyle.gap}px)`
    }"
  />
  <span
    data-test-id="smylr-live-center-guide-vertical"
    class="pointer-events-none absolute"
    :style="{
      height: `${frameHeight}px`,
      left: '50%',
      top: `${-originY}px`,
      width: `${guideStyle.stroke}px`,
      backgroundImage: `repeating-linear-gradient(to bottom, color-mix(in srgb, var(--color-accent) 58%, transparent) 0 ${guideStyle.dash}px, transparent ${guideStyle.dash}px ${guideStyle.dash + guideStyle.gap}px)`
    }"
  />

  <span
    v-for="marker in boxModelMarkers"
    :key="`${marker.layer}:${marker.edge}`"
    data-test-id="smylr-live-box-model-layer"
    :data-layer="marker.layer"
    class="pointer-events-none absolute flex items-center justify-center"
    :class="{
      'bg-amber-400/35': marker.layer === 'border',
      'bg-emerald-400/22': marker.layer === 'padding',
      'bg-orange-400/18': marker.layer === 'margin'
    }"
    :style="marker.style"
  >
    <span
      v-if="marker.label"
      class="bg-neutral-950/78 font-medium leading-none text-white shadow-sm"
      :style="labelStyle"
    >
      {{ marker.label }}
    </span>
  </span>

  <span
    data-test-id="smylr-live-box-model-content"
    class="pointer-events-none absolute flex items-center justify-center bg-sky-400/8"
    :style="contentStyle"
  >
    <span
      v-if="metrics.contentWidth * zoom > 70 && metrics.contentHeight * zoom > 28"
      class="bg-neutral-950/66 font-medium leading-none text-white/90 shadow-sm"
      :style="labelStyle"
    >
      {{ contentLabel }}
    </span>
  </span>

  <span
    v-for="(gap, index) in gaps"
    :key="`${gap.axis}:${gap.x}:${gap.y}:${gap.width}:${gap.height}`"
    data-test-id="smylr-live-gap-measurement"
    class="pointer-events-none absolute flex items-center justify-center bg-fuchsia-400/24"
    :style="{
      height: `${gap.height}px`,
      left: `${gap.x}px`,
      top: `${gap.y}px`,
      width: `${gap.width}px`
    }"
  >
    <span
      v-if="labeledGapKeys[index]"
      class="bg-fuchsia-700/88 font-medium leading-none text-white shadow-sm"
      :style="labelStyle"
    >
      {{ Math.round(gap.value * 10) / 10 }}
    </span>
  </span>
</template>
