<script setup lang="ts">
import { ref } from 'vue'

import { useEditor } from '#vue/editor/context'
import { useCanvas, type UseCanvasOptions } from '#vue/canvas/surface/use'
import { provideCanvas } from '#vue/canvas/context'

const {
  onError: onCanvasError,
  onReady: onCanvasReady,
  preserveDrawingBuffer,
  showRulers
} = defineProps<UseCanvasOptions>()

const editor = useEditor()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
const error = ref<unknown>(null)

const { renderNow, retryCanvasKit, hitTestSectionTitle, hitTestComponentLabel, hitTestFrameTitle } =
  useCanvas(canvasRef, editor, {
    showRulers,
    preserveDrawingBuffer,
    onError: (nextError) => {
      error.value = nextError
      onCanvasError?.(nextError)
    },
    onReady: () => {
      ready.value = true
      error.value = null
      onCanvasReady?.()
    }
  })

provideCanvas({
  canvasRef,
  ready,
  renderNow,
  hitTestSectionTitle,
  hitTestComponentLabel,
  hitTestFrameTitle
})
</script>

<template>
  <slot
    :canvas-ref="canvasRef"
    :error="error"
    :ready="ready"
    :render-now="renderNow"
    :retry="retryCanvasKit"
  />
</template>
