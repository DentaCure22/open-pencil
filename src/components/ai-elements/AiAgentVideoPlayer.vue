<script setup lang="ts">
import { ref, watch } from 'vue'

import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'
import VideoPlayer from '@/components/ui/VideoPlayer.vue'

const {
  autoplay = false,
  controls = true,
  fit = 'contain',
  loop = false,
  muted = false,
  poster,
  source,
  label = 'Generated video'
} = defineProps<{
  autoplay?: boolean
  controls?: boolean
  fit?: 'contain' | 'cover'
  loop?: boolean
  muted?: boolean
  poster?: string
  source: { mimeType?: string; name?: string; url: string }
  label?: string
}>()

const playbackUrl = ref('')
const fetchError = ref('')

watch(
  () => source.url,
  async (url, _, onCleanup) => {
    playbackUrl.value = ''
    fetchError.value = ''
    if (!url.startsWith('/agent-router/v1/pi/media/')) {
      playbackUrl.value = url
      return
    }

    const abortController = new AbortController()
    let objectUrl = ''
    onCleanup(() => {
      abortController.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    })
    try {
      const response = await localWorkspaceAuthorityFetch(url, {
        signal: abortController.signal
      })
      if (!response.ok) throw new Error(`Video request failed (${String(response.status)})`)
      objectUrl = URL.createObjectURL(await response.blob())
      playbackUrl.value = objectUrl
    } catch (error) {
      if (abortController.signal.aborted) return
      fetchError.value = error instanceof Error ? error.message : 'The video could not be loaded.'
    }
  },
  { immediate: true }
)
</script>

<template>
  <VideoPlayer
    :autoplay="autoplay"
    :controls="controls"
    :error-message="fetchError"
    :fit="fit"
    :loop="loop"
    :muted="muted"
    :poster="poster"
    :src="playbackUrl"
    :label="label"
  />
</template>
