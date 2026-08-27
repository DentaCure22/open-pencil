<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { onMounted, ref, watchEffect } from 'vue'

const { active = false, levels = [] } = defineProps<{
  active?: boolean
  levels?: number[]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const reducedMotion = usePreferredReducedMotion()
const restingLevels = [0.08, 0.14, 0.2, 0.14, 0.08]

function drawWaveform() {
  const element = canvas.value
  if (!element) return

  const width = 18
  const height = 16
  const dpr = window.devicePixelRatio || 1
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (element.width !== pixelWidth || element.height !== pixelHeight) {
    element.width = pixelWidth
    element.height = pixelHeight
  }

  const context = element.getContext('2d')
  if (!context) return
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.strokeStyle = getComputedStyle(element).color
  context.lineCap = 'round'
  context.lineWidth = 1.6

  const barGap = 3.5
  const firstBarX = width / 2 - (barGap * (restingLevels.length - 1)) / 2
  for (let index = 0; index < restingLevels.length; index += 1) {
    const measured = active && reducedMotion.value !== 'reduce' ? (levels[index] ?? 0) : 0
    const level = Math.max(restingLevels[index] ?? 0, Math.min(1, measured))
    const barHeight = 2.5 + level ** 0.72 * 10.5
    const x = firstBarX + index * barGap
    context.beginPath()
    context.moveTo(x, height / 2 - barHeight / 2)
    context.lineTo(x, height / 2 + barHeight / 2)
    context.stroke()
  }
}

onMounted(drawWaveform)
watchEffect(drawWaveform)
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" class="h-4 w-[18px]" />
</template>
