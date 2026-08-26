<script setup lang="ts">
import type { AiMessagePart } from './types'

const { sources } = defineProps<{ sources: Extract<AiMessagePart, { type: 'source' }>[] }>()
</script>

<template>
  <details
    data-test-id="ai-sources"
    class="my-1 rounded-[6px] border border-border/70 bg-input/35 text-[9px]"
  >
    <summary class="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-muted">
      <icon-lucide-book-open class="size-3" />
      <span>{{ sources.length }} {{ sources.length === 1 ? 'source' : 'sources' }}</span>
      <IconlyIcon name="arrow-down" class="ml-auto size-3 [[open]>&]:rotate-180" />
    </summary>
    <div class="grid gap-1 border-t border-border/60 p-1.5">
      <a
        v-for="source in sources"
        :key="source.url"
        :href="source.url"
        target="_blank"
        rel="noreferrer"
        class="flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-surface hover:bg-hover"
      >
        <span class="min-w-0 flex-1 truncate">{{ source.label ?? source.title }}</span>
        <icon-lucide-external-link class="size-3 shrink-0 text-muted" />
      </a>
    </div>
  </details>
</template>
