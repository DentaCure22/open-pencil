<script setup lang="ts">
import { ref } from 'vue'

import { openAgentImageAnnotation, readImagePreviewSize } from '@/app/context-comment'
import { toast } from '@/app/shell/ui'

import { formatAttachmentSize } from './model'
import type { AiMessagePart } from './types'

const {
  conversationThreadId,
  modelScope,
  parts,
  steer = false
} = defineProps<{
  conversationThreadId?: string
  modelScope?: string
  parts: Extract<AiMessagePart, { type: 'attachment' | 'image' }>[]
  steer?: boolean
}>()

const annotatingImageUrl = ref<string | null>(null)

async function annotateImage(
  part: Extract<AiMessagePart, { type: 'image' }>,
  event: MouseEvent
): Promise<void> {
  const renderedImage = (event.currentTarget as HTMLElement).querySelector('img')
  if (annotatingImageUrl.value) return
  annotatingImageUrl.value = part.url
  try {
    const size = await readImagePreviewSize(renderedImage)
    await openAgentImageAnnotation({
      action: steer ? 'steer' : 'follow-up',
      height: size.height,
      imageUrl: part.url,
      modelScope,
      threadId: conversationThreadId,
      width: size.width
    })
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : 'The image annotation editor is unavailable.'
    )
  } finally {
    annotatingImageUrl.value = null
  }
}
</script>

<template>
  <div data-test-id="ai-attachments" class="my-1 flex flex-wrap gap-1.5">
    <template v-for="(part, index) in parts" :key="`${part.type}-${String(index)}`">
      <a
        v-if="part.type === 'attachment'"
        :href="part.url"
        :aria-disabled="!part.url"
        class="flex max-w-full items-center gap-1.5 rounded-[6px] border border-border bg-input px-2 py-1.5 text-[9px] text-surface"
        :class="!part.url ? 'pointer-events-none' : 'hover:bg-hover'"
        target="_blank"
        rel="noreferrer"
      >
        <icon-lucide-paperclip class="size-3 shrink-0 text-muted" />
        <span class="min-w-0 truncate">{{ part.name }}</span>
        <span v-if="part.size" class="shrink-0 text-muted">{{
          formatAttachmentSize(part.size)
        }}</span>
      </a>
      <button
        v-else
        type="button"
        data-test-id="ai-chat-image"
        :aria-label="`Annotate ${part.alt ?? 'image'}`"
        class="group/image relative block max-w-full cursor-crosshair overflow-hidden rounded-[6px] border border-border bg-input text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        @click="annotateImage(part, $event)"
      >
        <img :src="part.url" :alt="part.alt ?? 'Image attachment'" class="max-h-48 max-w-full" />
        <span
          class="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100"
        >
          <icon-lucide-loader-circle
            v-if="annotatingImageUrl === part.url"
            class="size-3 animate-spin"
          />
          <icon-lucide-message-circle-plus v-else class="size-3" />
          Annotate
        </span>
      </button>
    </template>
  </div>
</template>
