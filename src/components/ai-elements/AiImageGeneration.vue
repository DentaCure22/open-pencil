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

import { openAgentImageAnnotation } from '@/app/context-comment'
import { toast } from '@/app/shell/ui'
import { useDialogUI } from '@/components/ui/dialog'
import { transparencyCheckerboardClass } from '@/components/ui/transparency'

import {
  imageGenerationPrompt,
  imageGenerationProvider,
  isImageGenerationTool,
  messageParts,
  resolveToolActivityState
} from './model'
import type { AiConversationStatus, AiMessage, AiMessagePart } from './types'

const {
  conversationThreadId,
  messages,
  modelScope,
  steer = false,
  status
} = defineProps<{
  conversationThreadId?: string
  messages: AiMessage[]
  modelScope?: string
  steer?: boolean
  status: AiConversationStatus
}>()

const annotatingImageUrl = ref<string | null>(null)
const viewerOpen = ref(false)
const viewerImage = ref<{ alt?: string; url: string } | null>(null)
const viewerDialog = useDialogUI({
  content: `flex h-fit max-h-[92vh] w-fit max-w-[92vw] items-center justify-center overflow-hidden border-white/10 p-2 ${transparencyCheckerboardClass}`,
  overlay: 'bg-black/75 backdrop-blur-sm'
})

type ImageTool = Extract<AiMessagePart, { type: 'tool' }>

function imageToolState(tool: ImageTool, index: number) {
  if (
    (tool.state === 'pending' || tool.state === 'running') &&
    (status === 'streaming' || status === 'submitted')
  ) {
    return tool.state
  }
  return resolveToolActivityState(tool.state, index, activityCount.value, status)
}

const activityCount = computed(() =>
  messages.reduce(
    (count, message) =>
      count +
      messageParts(message).filter(
        (part) => part.type === 'commentary' || part.type === 'reasoning' || part.type === 'tool'
      ).length,
    0
  )
)

const generations = computed(() => {
  let activityIndex = 0
  const candidates = messages.flatMap((message) =>
    messageParts(message).flatMap((part, partIndex) => {
      if (part.type !== 'commentary' && part.type !== 'reasoning' && part.type !== 'tool') return []
      const index = activityIndex
      activityIndex += 1
      if (part.type !== 'tool' || !isImageGenerationTool(part.name, part.input)) return []
      const tool: ImageTool = part
      return [
        {
          key: `${message.id}:${String(partIndex)}`,
          part: tool,
          prompt: imageGenerationPrompt(tool.input),
          provider: imageGenerationProvider(tool.name, tool.input),
          state: imageToolState(tool, index)
        }
      ]
    })
  )
  return candidates.filter(
    (generation) =>
      generation.part.images?.length ||
      generation.state === 'pending' ||
      generation.state === 'running' ||
      generation.state === 'error' ||
      generation.state === 'stopped'
  )
})

function providerLabel(provider: 'codex' | 'grok'): string {
  return provider === 'grok' ? 'Grok Imagine' : 'Codex Image'
}

function openViewer(image: { alt?: string; url: string }): void {
  viewerImage.value = image
  viewerOpen.value = true
}

async function annotateImage(
  image: { alt?: string; url: string },
  event: MouseEvent
): Promise<void> {
  if (!conversationThreadId) {
    openViewer(image)
    return
  }
  const renderedImage = (event.currentTarget as HTMLElement).querySelector('img')
  const width = renderedImage?.naturalWidth ?? 0
  const height = renderedImage?.naturalHeight ?? 0
  if (!width || !height || annotatingImageUrl.value) return
  annotatingImageUrl.value = image.url
  try {
    await openAgentImageAnnotation({
      action: steer ? 'steer' : 'follow-up',
      height,
      imageUrl: image.url,
      modelScope: modelScope || `task:${conversationThreadId}`,
      threadId: conversationThreadId,
      width
    })
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : 'The image annotation editor is unavailable.'
    )
    openViewer(image)
  } finally {
    annotatingImageUrl.value = null
  }
}
</script>

<template>
  <div v-if="generations.length" class="flex flex-col gap-2" data-test-id="ai-image-generations">
    <figure
      v-for="generation in generations"
      :key="generation.key"
      data-test-id="ai-image-generation"
      :data-provider="generation.provider"
      :data-state="generation.state"
      class="relative isolate overflow-hidden rounded-[16px] border border-border/80 bg-input shadow-sm"
      :class="
        generation.part.images?.length === 1 &&
        generation.state !== 'pending' &&
        generation.state !== 'running'
          ? 'w-fit max-w-full'
          : 'w-full max-w-[420px]'
      "
    >
      <div
        v-if="generation.state === 'pending' || generation.state === 'running'"
        class="relative aspect-[4/3] min-h-40 overflow-hidden bg-input"
        role="status"
        aria-live="polite"
      >
        <div
          aria-hidden="true"
          class="absolute inset-0 bg-gradient-to-br from-accent/20 via-input to-component/30"
        />
        <div
          aria-hidden="true"
          class="absolute -top-16 -left-12 size-64 animate-pulse rounded-full bg-accent/35 blur-3xl"
        />
        <div
          aria-hidden="true"
          class="absolute -right-16 -bottom-20 size-72 animate-pulse rounded-full bg-component/45 blur-3xl [animation-delay:500ms]"
        />
        <div
          aria-hidden="true"
          class="absolute inset-0 opacity-55 mix-blend-overlay bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.9)_0_0.6px,rgba(0,0,0,0.65)_0.8px,transparent_1px)] [background-size:2.5px_2.5px]"
        />
        <div
          aria-hidden="true"
          class="absolute inset-y-0 -left-1/2 w-2/5 bg-gradient-to-r from-transparent via-white/55 to-transparent blur-xl [animation:openpencil-image-shimmer_1.65s_ease-in-out_infinite] motion-reduce:animate-pulse"
        />
        <div
          class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent px-4 pt-12 pb-3.5 text-white"
        >
          <div class="min-w-0">
            <p class="text-[13px] font-medium">Creating image…</p>
            <p v-if="generation.prompt" class="mt-0.5 truncate text-[11px] text-white/70">
              {{ generation.prompt }}
            </p>
          </div>
        </div>
      </div>

      <template v-else-if="generation.part.images?.length">
        <div
          class="grid max-w-full overflow-hidden bg-black/5"
          :class="generation.part.images.length > 1 ? 'grid-cols-2' : 'w-fit grid-cols-1'"
        >
          <button
            v-for="(image, imageIndex) in generation.part.images"
            :key="`${generation.key}:image:${String(imageIndex)}`"
            type="button"
            :aria-label="
              generation.part.images.length > 1
                ? `Annotate generated image ${String(imageIndex + 1)}`
                : 'Annotate generated image'
            "
            class="group/image relative block cursor-crosshair overflow-hidden border-0 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            :class="[
              transparencyCheckerboardClass,
              generation.part.images.length > 1 ? 'min-h-32 w-full' : 'w-fit max-w-full'
            ]"
            @click="annotateImage(image, $event)"
          >
            <img
              :src="image.url"
              :alt="image.alt ?? 'Generated image'"
              class="transition-transform duration-200 group-hover/image:scale-[1.01] motion-reduce:transition-none"
              :class="
                generation.part.images.length > 1
                  ? 'h-full max-h-[240px] w-full object-contain'
                  : 'block h-auto max-h-[340px] w-auto max-w-full object-contain'
              "
            />
            <span
              class="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100"
            >
              <icon-lucide-loader-circle
                v-if="annotatingImageUrl === image.url"
                class="size-3.5 animate-spin"
              />
              <icon-lucide-message-circle-plus v-else class="size-3.5" />
              Annotate
            </span>
          </button>
        </div>
      </template>

      <div v-else class="flex min-h-28 items-center gap-3 px-4 py-4">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-hover"
          :class="generation.state === 'error' ? 'text-red-400' : 'text-muted'"
          aria-hidden="true"
        >
          <icon-lucide-triangle-alert v-if="generation.state === 'error'" class="size-4" />
          <icon-lucide-image v-else class="size-4" />
        </span>
        <div class="min-w-0">
          <p class="text-[12px] font-medium text-surface">
            {{
              generation.state === 'error'
                ? 'Image generation failed'
                : generation.state === 'stopped'
                  ? 'Image generation stopped'
                  : 'Image generation completed'
            }}
          </p>
          <p class="mt-0.5 line-clamp-2 text-[11px] text-muted">
            {{ generation.part.error || generation.prompt || providerLabel(generation.provider) }}
          </p>
        </div>
      </div>
    </figure>
  </div>

  <DialogRoot v-model:open="viewerOpen">
    <DialogPortal>
      <DialogOverlay :class="viewerDialog.overlay" />
      <DialogContent
        v-if="viewerImage"
        :aria-describedby="undefined"
        :class="viewerDialog.content"
        data-test-id="ai-image-viewer"
      >
        <DialogTitle class="sr-only">Generated image preview</DialogTitle>
        <img
          :src="viewerImage.url"
          :alt="viewerImage.alt ?? 'Generated image preview'"
          class="block max-h-[88vh] max-w-[88vw] object-contain"
        />
        <DialogClose
          type="button"
          aria-label="Close image viewer"
          class="absolute top-3 right-3 flex size-8 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/60 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <icon-lucide-x class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
