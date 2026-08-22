<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

const {
  autoplay = false,
  controls = true,
  errorMessage,
  fit = 'contain',
  loop = false,
  muted = false,
  poster,
  preload = 'metadata',
  src,
  label = 'Video player'
} = defineProps<{
  autoplay?: boolean
  controls?: boolean
  errorMessage?: string
  fit?: 'contain' | 'cover'
  loop?: boolean
  muted?: boolean
  poster?: string
  preload?: 'auto' | 'metadata' | 'none'
  src: string
  label?: string
}>()

const emit = defineEmits<{
  error: []
  loaded: []
  pause: []
  play: []
}>()

const video = useTemplateRef<HTMLVideoElement>('video')
const loading = ref(Boolean(src))
const playbackError = ref('')
const resolvedError = computed(() => errorMessage || playbackError.value)

watch(
  () => src,
  (value) => {
    loading.value = Boolean(value)
    playbackError.value = ''
  }
)

function handleLoaded() {
  loading.value = false
  playbackError.value = ''
  emit('loaded')
}

function handleError() {
  loading.value = false
  playbackError.value = 'This video could not be loaded.'
  emit('error')
}

function mediaElement(): HTMLVideoElement | null {
  return video.value
}

defineExpose({ mediaElement })
</script>

<template>
  <div
    class="relative isolate size-full min-h-0 min-w-0 overflow-hidden bg-black text-white"
    data-test-id="video-player"
  >
    <video
      v-if="src"
      ref="video"
      :aria-label="label"
      :autoplay="autoplay"
      class="block size-full"
      :class="fit === 'cover' ? 'object-cover' : 'object-contain'"
      :controls="controls"
      :loop="loop"
      :muted="muted"
      :playsinline="true"
      :poster="poster"
      :preload="preload"
      :src="src"
      @error="handleError"
      @loadeddata="handleLoaded"
      @pause="emit('pause')"
      @play="emit('play')"
    />
    <div
      v-if="loading && !resolvedError"
      class="pointer-events-none absolute inset-0 grid place-items-center bg-black/30"
      role="status"
    >
      <span class="flex items-center gap-2 text-[11px] text-white/75">
        <icon-lucide-loader-circle class="size-4 animate-spin" />
        Loading video…
      </span>
    </div>
    <div
      v-if="resolvedError || !src"
      class="absolute inset-0 grid place-items-center bg-black px-5 text-center"
      role="alert"
    >
      <span class="flex max-w-xs flex-col items-center gap-2 text-[11px] text-white/65">
        <icon-lucide-video-off class="size-5" />
        {{ resolvedError || 'No video source is available.' }}
      </span>
    </div>
  </div>
</template>
