<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, ref } from 'vue'

import { useDialogUI } from '@/components/ui/dialog'

import AiAgentVideoPlayer from './AiAgentVideoPlayer.vue'
import {
  isVideoGenerationTool,
  messageParts,
  resolveToolActivityState,
  videoGenerationPrompt
} from './model'
import type { AiConversationStatus, AiMessage, AiMessagePart } from './types'

const { messages, status } = defineProps<{
  messages: AiMessage[]
  status: AiConversationStatus
}>()

type VideoSource = { mimeType?: string; name?: string; url: string }
type VideoTool = Extract<AiMessagePart, { type: 'tool' }>

const viewerOpen = ref(false)
const viewerVideo = ref<VideoSource | null>(null)
const viewerDialog = useDialogUI({
  content:
    'flex h-fit max-h-[92vh] w-[min(92vw,1040px)] items-center justify-center overflow-hidden border-white/10 bg-black p-2',
  overlay: 'bg-black/75 backdrop-blur-sm'
})

const activityCount = computed(() =>
  messages.reduce(
    (count, message) =>
      count +
      messageParts(message).filter((part) => part.type === 'reasoning' || part.type === 'tool')
        .length,
    0
  )
)

function videoToolState(tool: VideoTool, index: number) {
  if (
    (tool.state === 'pending' || tool.state === 'running') &&
    (status === 'streaming' || status === 'submitted')
  ) {
    return tool.state
  }
  return resolveToolActivityState(tool.state, index, activityCount.value, status)
}

const generations = computed(() => {
  let activityIndex = 0
  const candidates = messages.flatMap((message) =>
    messageParts(message).flatMap((part, partIndex) => {
      if (part.type !== 'reasoning' && part.type !== 'tool') return []
      const index = activityIndex
      activityIndex += 1
      if (part.type !== 'tool' || !isVideoGenerationTool(part.name, part.input)) return []
      const tool: VideoTool = part
      return [
        {
          key: `${message.id}:${String(partIndex)}`,
          part: tool,
          prompt: videoGenerationPrompt(tool.input),
          state: videoToolState(tool, index)
        }
      ]
    })
  )
  return candidates.filter(
    (generation) =>
      generation.part.videos?.length ||
      generation.state === 'pending' ||
      generation.state === 'running' ||
      generation.state === 'error' ||
      generation.state === 'stopped'
  )
})

function openViewer(video: VideoSource): void {
  viewerVideo.value = video
  viewerOpen.value = true
}
</script>

<template>
  <div v-if="generations.length" class="flex flex-col gap-2" data-test-id="ai-video-generations">
    <figure
      v-for="generation in generations"
      :key="generation.key"
      class="relative isolate w-full max-w-[420px] overflow-hidden rounded-[16px] border border-border/80 bg-black shadow-sm"
      data-provider="grok"
      :data-state="generation.state"
      data-test-id="ai-video-generation"
    >
      <div
        v-if="generation.state === 'pending' || generation.state === 'running'"
        aria-live="polite"
        class="relative aspect-video min-h-40 overflow-hidden bg-input"
        role="status"
      >
        <div
          aria-hidden="true"
          class="absolute inset-0 bg-gradient-to-br from-accent/25 via-input to-component/35"
        />
        <div
          aria-hidden="true"
          class="absolute -top-20 -left-12 size-64 animate-pulse rounded-full bg-accent/40 blur-3xl"
        />
        <div
          aria-hidden="true"
          class="absolute -right-20 -bottom-24 size-72 animate-pulse rounded-full bg-component/50 blur-3xl [animation-delay:500ms]"
        />
        <div
          aria-hidden="true"
          class="absolute inset-0 opacity-70 mix-blend-overlay bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.95)_0_0.7px,rgba(0,0,0,0.72)_0.9px,transparent_1.15px)] [background-size:2.4px_2.4px]"
        />
        <div
          aria-hidden="true"
          class="absolute inset-y-0 -left-1/2 w-2/5 bg-gradient-to-r from-transparent via-white/65 to-transparent blur-xl [animation:openpencil-image-shimmer_1.65s_ease-in-out_infinite] motion-reduce:animate-pulse"
        />
        <div
          class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-4 pt-12 pb-3.5 text-white"
        >
          <p class="text-[13px] font-medium">Creating video…</p>
          <p v-if="generation.prompt" class="mt-0.5 truncate text-[11px] text-white/70">
            {{ generation.prompt }}
          </p>
        </div>
      </div>

      <template v-else-if="generation.part.videos?.length">
        <div
          v-for="(video, videoIndex) in generation.part.videos"
          :key="`${generation.key}:video:${String(videoIndex)}`"
          class="group/video relative aspect-video max-h-[320px] w-full overflow-hidden bg-black"
        >
          <AiAgentVideoPlayer :label="video.name || 'Generated video'" :source="video" />
          <button
            type="button"
            :aria-label="`Open generated video ${String(videoIndex + 1)} in viewer`"
            class="absolute top-2.5 right-2.5 z-10 flex size-8 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity hover:bg-black/80 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 group-hover/video:opacity-100 [@media(hover:none)]:opacity-100"
            @click="openViewer(video)"
          >
            <icon-lucide-maximize-2 class="size-3.5" />
          </button>
        </div>
      </template>

      <div v-else class="flex min-h-24 items-center gap-3 bg-input px-4 py-4">
        <span
          aria-hidden="true"
          class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-hover"
          :class="generation.state === 'error' ? 'text-red-400' : 'text-muted'"
        >
          <icon-lucide-triangle-alert v-if="generation.state === 'error'" class="size-4" />
          <icon-lucide-video v-else class="size-4" />
        </span>
        <div class="min-w-0">
          <p class="text-[12px] font-medium text-surface">
            {{
              generation.state === 'error'
                ? 'Video generation failed'
                : generation.state === 'stopped'
                  ? 'Video generation stopped'
                  : 'Video generation completed'
            }}
          </p>
          <p class="mt-0.5 line-clamp-2 text-[11px] text-muted">
            {{ generation.part.error || generation.prompt || 'Grok Imagine' }}
          </p>
        </div>
      </div>
    </figure>
  </div>

  <DialogRoot v-model:open="viewerOpen">
    <DialogPortal>
      <DialogOverlay :class="viewerDialog.overlay" />
      <DialogContent
        v-if="viewerVideo"
        :aria-describedby="undefined"
        :class="viewerDialog.content"
        data-test-id="ai-video-viewer"
      >
        <DialogTitle class="sr-only">Generated video preview</DialogTitle>
        <div class="aspect-video max-h-[88vh] w-full overflow-hidden rounded-lg bg-black">
          <AiAgentVideoPlayer
            :label="viewerVideo.name || 'Generated video'"
            :source="viewerVideo"
          />
        </div>
        <DialogClose
          type="button"
          aria-label="Close video viewer"
          class="absolute top-3 right-3 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/60 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <icon-lucide-x class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
