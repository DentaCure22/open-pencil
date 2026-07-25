<script setup lang="ts">
import { computed } from 'vue'

import type { DesignStyleDeclaration } from '@open-pencil/dom-css'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  createBoxModelBands,
  createGapMeasurements,
  resolveBoxModelMetrics,
  type BoxModelBand,
  type BoxModelLayer
} from '@/app/smylr-live-inspector/box-model'

type AlignmentGuide = {
  id: string
  style: Record<string, string>
}

type LiveSpacingMeasurementsProps = {
  children?: SmylrLiveContainerNode[]
  computedStyle?: DesignStyleDeclaration
  frameHeight: number
  frameWidth: number
  height: number
  offsetX: number
  offsetY: number
  previewStyle?: DesignStyleDeclaration
  width: number
  zoom: number
}

const BOX_MODEL_FILL_CLASSES: Record<BoxModelLayer, string> = {
  border: 'bg-amber-300/35',
  content: 'bg-sky-400/10',
  margin: 'bg-orange-400/25',
  padding: 'bg-emerald-400/25'
}
const BOX_MODEL_LABEL_CLASSES: Record<BoxModelLayer, string> = {
  border: 'bg-amber-500 text-amber-950',
  content: 'bg-sky-500 text-white',
  margin: 'bg-orange-500 text-white',
  padding: 'bg-emerald-500 text-emerald-950'
}

const props = defineProps<LiveSpacingMeasurementsProps>()

const measurementLabelStyle = computed(() => {
  const zoom = Math.max(props.zoom, 0.01)
  return {
    borderRadius: `${3 / zoom}px`,
    fontSize: `${9 / zoom}px`,
    lineHeight: `${14 / zoom}px`,
    padding: `0 ${4 / zoom}px`
  }
})

const centerAlignmentGuides = computed<AlignmentGuide[]>(() => {
  const stroke = 1 / Math.max(props.zoom, 0.01)
  const color = 'color-mix(in srgb, var(--color-accent) 72%, transparent)'
  const guides: AlignmentGuide[] = [
    {
      id: 'horizontal-center',
      style: {
        borderTopColor: color,
        borderTopStyle: 'dashed',
        borderTopWidth: `${stroke}px`,
        height: '0px',
        left: `${-props.offsetX}px`,
        top: `${props.height / 2}px`,
        width: `${props.frameWidth}px`
      }
    },
    {
      id: 'vertical-center',
      style: {
        borderLeftColor: color,
        borderLeftStyle: 'dashed',
        borderLeftWidth: `${stroke}px`,
        height: `${props.frameHeight}px`,
        left: `${props.width / 2}px`,
        top: `${-props.offsetY}px`,
        width: '0px'
      }
    }
  ]
  return guides
})

const boxModelBands = computed(() =>
  createBoxModelBands(
    resolveBoxModelMetrics(props.computedStyle, props.previewStyle),
    props.width,
    props.height
  )
)

const gapMeasurements = computed(() =>
  createGapMeasurements(props.children, props.width, props.height)
)

function rectStyle(rect: { height: number; width: number; x: number; y: number }) {
  return {
    height: `${rect.height}px`,
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`
  }
}

function displayMeasurement(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function boxModelLabel(band: BoxModelBand) {
  if (band.layer === 'content') {
    return `content ${displayMeasurement(band.rect.width)} × ${displayMeasurement(band.rect.height)}`
  }
  return displayMeasurement(band.value ?? 0)
}
</script>

<template>
  <span
    v-for="guide in centerAlignmentGuides"
    :key="guide.id"
    data-test-id="smylr-live-center-alignment-guide"
    :data-guide-axis="guide.id"
    class="pointer-events-none absolute"
    :style="guide.style"
  />
  <div
    v-for="(band, index) in boxModelBands"
    :key="`${band.layer}-${band.edge ?? 'box'}-${index}`"
    data-test-id="smylr-live-box-model-band"
    :data-box-model-layer="band.layer"
    :data-box-model-edge="band.edge"
    class="pointer-events-none absolute"
    :class="BOX_MODEL_FILL_CLASSES[band.layer]"
    :style="rectStyle(band.rect)"
  >
    <span
      v-if="band.showLabel"
      class="absolute top-1/2 left-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 font-medium whitespace-nowrap shadow-sm"
      :class="BOX_MODEL_LABEL_CLASSES[band.layer]"
      :style="measurementLabelStyle"
    >
      {{ boxModelLabel(band) }}
    </span>
  </div>
  <div
    v-for="(gap, index) in gapMeasurements"
    :key="`${gap.axis}-${gap.rect.x}-${gap.rect.y}-${index}`"
    data-test-id="smylr-live-gap-highlight"
    :data-gap-axis="gap.axis"
    class="pointer-events-none absolute bg-fuchsia-500/25"
    :style="rectStyle(gap.rect)"
  >
    <span
      v-if="gap.showLabel"
      class="absolute top-1/2 left-1/2 z-[3] -translate-x-1/2 -translate-y-1/2 bg-fuchsia-600 font-medium whitespace-nowrap text-white shadow-sm"
      :style="measurementLabelStyle"
    >
      gap {{ displayMeasurement(gap.value) }}
    </span>
  </div>
</template>
