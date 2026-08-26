<script setup lang="ts">
import { computed } from 'vue'

import AiStreamingTextNode from './AiStreamingTextNode.vue'
import { useStreamedText } from './streamed-text'
import type { AiToolKind } from './model'

const {
  expanded = false,
  failed = false,
  interactive = false,
  kind,
  text,
  toolKind = 'tool'
} = defineProps<{
  expanded?: boolean
  failed?: boolean
  interactive?: boolean
  kind: 'commentary' | 'reasoning' | 'status' | 'tool'
  text: string
  toolKind?: AiToolKind
}>()

const emit = defineEmits<{
  toggle: []
}>()

function toggle() {
  if (interactive) emit('toggle')
}

const sourceLabel = computed(() =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
)
const label = useStreamedText(
  () => sourceLabel.value,
  () => kind !== 'tool',
  { animateRewrites: true }
)
</script>

<template>
  <div
    :aria-expanded="interactive ? expanded : undefined"
    :aria-label="interactive ? `${label}, ${expanded ? 'hide' : 'show'} tool calls` : undefined"
    :data-test-id="interactive ? 'ai-tool-group-toggle' : undefined"
    data-state="streaming"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? 0 : undefined"
    class="group/live-work flex min-h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md font-sans text-[13px] leading-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
    :class="interactive ? 'w-full cursor-pointer' : 'w-fit'"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <span
      v-if="kind === 'tool'"
      class="flex size-4 shrink-0 items-center justify-center"
      :class="failed ? 'text-red-400' : 'text-muted/85'"
      aria-hidden="true"
    >
      <IconlyIcon name="search" v-if="toolKind === 'search'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-mail v-else-if="toolKind === 'mail'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-terminal v-else-if="toolKind === 'command'" class="size-3.5 stroke-[1.6]" />
      <IconlyIcon name="document" v-else-if="toolKind === 'read'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-pencil-line v-else-if="toolKind === 'edit'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-list-tree v-else-if="toolKind === 'list'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-plug-zap
        v-else-if="toolKind === 'connected-app'"
        class="size-3.5 stroke-[1.6]"
      />
      <IconlyIcon name="chat" v-else-if="toolKind === 'message'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-git-fork v-else-if="toolKind === 'handoff'" class="size-3.5 stroke-[1.6]" />
      <IconlyIcon
        name="image"
        v-else-if="toolKind === 'image' || toolKind === 'video'"
        class="size-3.5 stroke-[1.6]"
      />
      <icon-lucide-globe-2 v-else-if="toolKind === 'web'" class="size-3.5 stroke-[1.6]" />
      <icon-lucide-wrench v-else class="size-3.5 stroke-[1.6]" />
    </span>
    <span v-if="failed" class="sr-only">Tool call failed: </span>
    <div class="relative min-h-6 min-w-0 flex-1 overflow-hidden">
      <div class="flex min-h-6 min-w-0 items-center px-1 py-0.5 text-muted">
        <span class="min-w-0 flex-1 truncate" data-test-id="ai-live-activity-label">
          <AiStreamingTextNode :active="kind !== 'tool'" :text="label" />
        </span>
      </div>
      <div
        aria-hidden="true"
        class="live-activity-focus pointer-events-none absolute inset-y-0 select-none"
      >
        <div class="live-activity-focus-counter">
          <div class="live-activity-focus-aligned">
            <div class="flex min-h-6 min-w-0 items-center px-1 py-0.5 text-surface">
              <span class="min-w-0 flex-1 truncate">
                <AiStreamingTextNode :active="kind !== 'tool'" :text="label" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <span
      v-if="interactive"
      class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity duration-150 group-hover/live-work:opacity-100 group-focus-within/live-work:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
      aria-hidden="true"
    >
      <IconlyIcon
        name="arrow-down"
        v-if="expanded"
        class="size-3.5"
        data-direction="down"
        data-test-id="ai-disclosure-chevron"
      />
      <IconlyIcon
        name="arrow-right"
        v-else
        class="size-3.5"
        data-direction="right"
        data-test-id="ai-disclosure-chevron"
      />
    </span>
  </div>
</template>

<style scoped>
@keyframes live-activity-focus {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(100%);
  }
}

@keyframes live-activity-focus-counter {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-100%);
  }
}

.live-activity-focus {
  --live-activity-focus-width: 4.5rem;

  right: auto;
  left: calc(-1 * var(--live-activity-focus-width));
  width: calc(100% + var(--live-activity-focus-width) + var(--live-activity-focus-width));
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    rgb(0 0 0 / 12%) 0.675rem,
    rgb(0 0 0 / 55%) 1.575rem,
    black 2.25rem,
    rgb(0 0 0 / 55%) 2.925rem,
    rgb(0 0 0 / 12%) 3.825rem,
    transparent var(--live-activity-focus-width),
    transparent 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-image: linear-gradient(
    to right,
    transparent 0,
    rgb(0 0 0 / 12%) 0.675rem,
    rgb(0 0 0 / 55%) 1.575rem,
    black 2.25rem,
    rgb(0 0 0 / 55%) 2.925rem,
    rgb(0 0 0 / 12%) 3.825rem,
    transparent var(--live-activity-focus-width),
    transparent 100%
  );
  mask-repeat: no-repeat;
  animation: live-activity-focus 2.2s linear infinite;
  will-change: transform;
}

.live-activity-focus-counter {
  width: 100%;
  animation: live-activity-focus-counter 2.2s linear infinite;
  will-change: transform;
}

.live-activity-focus-aligned {
  width: calc(100% - var(--live-activity-focus-width) - var(--live-activity-focus-width));
  margin-left: var(--live-activity-focus-width);
}

@media (prefers-reduced-motion: reduce) {
  .live-activity-focus {
    animation: none;
    opacity: 0;
    will-change: auto;
  }

  .live-activity-focus-counter {
    animation: none;
    will-change: auto;
  }
}
</style>
