<script setup lang="ts">
import { formatAttachmentSize } from './model'
import type { AiMessagePart } from './types'

const { parts } = defineProps<{
  parts: Extract<AiMessagePart, { type: 'attachment' | 'image' }>[]
}>()
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
      <a
        v-else
        :href="part.url"
        target="_blank"
        rel="noreferrer"
        class="block overflow-hidden rounded-[6px] border border-border bg-input"
      >
        <img :src="part.url" :alt="part.alt ?? 'Generated image'" class="max-h-48 max-w-full" />
      </a>
    </template>
  </div>
</template>
