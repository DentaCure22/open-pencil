<script setup lang="ts">
import { computed } from 'vue'

import type { DesignStyleDeclaration } from '@open-pencil/dom-css'
import type { SceneNode } from '@open-pencil/scene-graph'

const { computedStyle, node } = defineProps<{
  computedStyle?: DesignStyleDeclaration
  node: SceneNode
}>()

type EdgeValues = {
  bottom: number
  left: number
  right: number
  top: number
}

type ComputedLayer = {
  boxClass: string
  label: string
  values: EdgeValues
}

const layerInsetClasses = ['inset-0', 'inset-[12px]', 'inset-[24px]'] as const
const contentInsetClasses = ['inset-0', 'inset-[12px]', 'inset-[24px]', 'inset-[36px]'] as const
const modelHeightClasses = ['h-[76px]', 'h-[76px]', 'h-[88px]', 'h-[100px]'] as const

function numberFrom(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function computedEdge(prefix: string, side: keyof EdgeValues) {
  return numberFrom(computedStyle?.[`${prefix}-${side}`])
}

const margin = computed<EdgeValues>(() => ({
  bottom: computedEdge('margin', 'bottom'),
  left: computedEdge('margin', 'left'),
  right: computedEdge('margin', 'right'),
  top: computedEdge('margin', 'top')
}))

const border = computed<EdgeValues>(() => {
  if (node.independentStrokeWeights) {
    return {
      bottom: numberFrom(node.borderBottomWeight),
      left: numberFrom(node.borderLeftWeight),
      right: numberFrom(node.borderRightWeight),
      top: numberFrom(node.borderTopWeight)
    }
  }

  const weight = numberFrom(node.strokes[0]?.weight)
  return { bottom: weight, left: weight, right: weight, top: weight }
})

const padding = computed<EdgeValues>(() => ({
  bottom: numberFrom(node.paddingBottom),
  left: numberFrom(node.paddingLeft),
  right: numberFrom(node.paddingRight),
  top: numberFrom(node.paddingTop)
}))

const contentSize = computed(() => ({
  height: Math.max(
    0,
    node.height - border.value.top - border.value.bottom - padding.value.top - padding.value.bottom
  ),
  width: Math.max(
    0,
    node.width - border.value.left - border.value.right - padding.value.left - padding.value.right
  )
}))

const gap = computed(() => ({
  cross: node.layoutWrap === 'WRAP' ? numberFrom(node.counterAxisSpacing) : 0,
  main: numberFrom(node.itemSpacing)
}))

function hasComputedEdge(values: EdgeValues) {
  return Object.values(values).some((value) => value !== 0)
}

const computedLayers = computed<ComputedLayer[]>(() =>
  [
    {
      boxClass: 'border-orange-400/35 bg-orange-400/10 text-orange-200',
      label: 'margin',
      values: margin.value
    },
    {
      boxClass: 'border-amber-300/40 bg-amber-300/10 text-amber-100',
      label: 'border',
      values: border.value
    },
    {
      boxClass: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
      label: 'padding',
      values: padding.value
    }
  ].filter(({ values }) => hasComputedEdge(values))
)

function layerInset(index: number) {
  return layerInsetClasses[index] ?? layerInsetClasses[0]
}

const contentInset = computed(
  () => contentInsetClasses[computedLayers.value.length] ?? contentInsetClasses[0]
)
const modelHeight = computed(
  () => modelHeightClasses[computedLayers.value.length] ?? modelHeightClasses[0]
)

function display(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}
</script>

<template>
  <div class="min-w-0" data-test-id="computed-box-model">
    <div class="mb-1 flex items-center justify-between">
      <label class="block text-[11px] text-muted">Computed box</label>
      <span class="text-[9px] uppercase tracking-wide text-muted/70">px</span>
    </div>

    <div
      class="relative text-[8px] leading-none"
      :class="modelHeight"
      aria-label="Computed margin, border, padding, content size, and auto-layout gap"
    >
      <div
        v-for="(layer, index) in computedLayers"
        :key="layer.label"
        class="absolute rounded border"
        :class="[layer.boxClass, layerInset(index)]"
      >
        <span class="absolute left-1 top-0.5">{{ layer.label }}</span>
        <span v-if="layer.values.top" class="absolute left-1/2 top-1 -translate-x-1/2">{{
          display(layer.values.top)
        }}</span>
        <span v-if="layer.values.right" class="absolute right-1 top-1/2 -translate-y-1/2">{{
          display(layer.values.right)
        }}</span>
        <span v-if="layer.values.bottom" class="absolute bottom-1 left-1/2 -translate-x-1/2">{{
          display(layer.values.bottom)
        }}</span>
        <span v-if="layer.values.left" class="absolute left-1 top-1/2 -translate-y-1/2">{{
          display(layer.values.left)
        }}</span>
      </div>

      <div
        class="absolute flex items-center justify-center rounded border border-sky-400/45 bg-sky-400/15 px-1 text-center text-sky-100"
        :class="contentInset"
      >
        <span>
          <span v-if="contentSize.width && contentSize.height">
            content {{ display(contentSize.width) }} × {{ display(contentSize.height) }}
          </span>
          <span v-else-if="contentSize.width">content width {{ display(contentSize.width) }}</span>
          <span v-else-if="contentSize.height"
            >content height {{ display(contentSize.height) }}</span
          >
          <span v-if="gap.main || gap.cross" class="mt-1 block text-[7px] text-sky-200/80">
            <template v-if="gap.main">gap {{ display(gap.main) }}</template>
            <template v-if="gap.main && gap.cross"> × </template>
            <template v-if="gap.cross">cross {{ display(gap.cross) }}</template>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>
