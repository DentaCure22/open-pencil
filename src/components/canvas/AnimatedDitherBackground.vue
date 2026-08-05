<script setup lang="ts">
import { createDitheredWaves } from 'ditherwave/vanilla'
import { onMounted, onUnmounted, useTemplateRef, watch } from 'vue'

import type { DitheredWavesHandle, DitheredWavesOptions } from 'ditherwave/vanilla'

import { useAppTheme } from '@/app/shell/theme'

type DitherPresentation = 'overlay' | 'surface'

const DITHER_MAX_FPS = 15
const DITHER_PIXEL_RATIO = 0.5

const { presentation = 'surface', quiet = false } = defineProps<{
  presentation?: DitherPresentation
  quiet?: boolean
}>()

const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const { resolvedTheme } = useAppTheme()

let waves: DitheredWavesHandle | null = null

function themeOptions(theme: 'dark' | 'light'): DitheredWavesOptions {
  return theme === 'dark'
    ? {
        baseColor: '#101114',
        colorNum: 5,
        waveAmplitude: 0.56,
        waveColor: '#797d86',
        waveFrequency: 1.85
      }
    : {
        baseColor: '#fafafa',
        colorNum: 3,
        waveAmplitude: 0.38,
        waveColor: '#adadad',
        waveFrequency: 2.35
      }
}

onMounted(() => {
  if (!canvas.value) return
  waves = createDitheredWaves(canvas.value, {
    mode: 'bayer',
    matrixSize: 8,
    waveSpeed: 0.035,
    pixelSize: 1,
    disableAnimation: false,
    enableMouseInteraction: false,
    maxFps: DITHER_MAX_FPS,
    pixelRatio: DITHER_PIXEL_RATIO,
    ...themeOptions(resolvedTheme.value)
  })
})

watch(resolvedTheme, (theme) => {
  waves?.setOptions(themeOptions(theme))
})

onUnmounted(() => {
  waves?.destroy()
  waves = null
})
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 overflow-hidden forced-colors:hidden"
    :class="presentation === 'surface' ? 'z-[3] bg-canvas' : 'z-0 bg-transparent'"
    data-test-id="animated-dither-background"
    data-animation="continuous"
    :data-max-fps="DITHER_MAX_FPS"
    :data-presentation="presentation"
    aria-hidden="true"
  >
    <canvas
      ref="canvas"
      class="block size-full [image-rendering:pixelated]"
      :class="
        quiet
          ? 'opacity-[0.015] [[data-theme=dark]_&]:opacity-[0.03]'
          : presentation === 'surface'
            ? 'opacity-[0.22] [[data-theme=dark]_&]:opacity-[0.62]'
            : 'opacity-10 [[data-theme=dark]_&]:opacity-[0.19]'
      "
    />
    <div
      v-if="presentation === 'surface'"
      class="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,transparent_0%,transparent_24%,var(--color-canvas)_92%)] opacity-35"
    />
  </div>
</template>
