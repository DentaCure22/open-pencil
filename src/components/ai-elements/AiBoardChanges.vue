<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'

import type { AiBoardObjectChange } from '@/app/agent-chat/types'

const {
  changes,
  destinationLabel = 'on Board',
  direct = false,
  directLabel = 'Linked result',
  noun = 'Board change'
} = defineProps<{
  changes: AiBoardObjectChange[]
  destinationLabel?: string
  direct?: boolean
  directLabel?: string
  noun?: string
}>()
const emit = defineEmits<{
  'hover-object': [id: string | null, pageId?: string]
  'open-object': [id: string, pageId?: string]
}>()

const expanded = ref(false)
const toggle = ref<HTMLButtonElement | null>(null)
const objectListId = `board-changes-${useId()}`
const countLabel = computed(
  () => `${String(changes.length)} ${noun}${changes.length === 1 ? '' : 's'}`
)
const directChange = computed(() => (direct && changes.length === 1 ? changes[0] : null))

function close() {
  if (!expanded.value) return
  expanded.value = false
  void nextTick(() => toggle.value?.focus())
}
</script>

<template>
  <section
    data-test-id="ai-board-changes"
    class="w-full text-[12px] text-muted"
    @keydown.escape.stop="close"
  >
    <button
      v-if="directChange"
      type="button"
      data-test-id="ai-linked-result"
      :aria-label="`Open ${directLabel}: ${directChange.name}${destinationLabel ? ` ${destinationLabel}` : ''}`"
      :data-board-object-id="directChange.id"
      class="group flex min-h-10 w-full items-center gap-2.5 rounded-[9px] border border-border/65 bg-agent-surface/45 px-2.5 text-left transition-[background-color,border-color] hover:border-border hover:bg-hover/55 focus-visible:border-border focus-visible:bg-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/25"
      @click="emit('open-object', directChange.id, directChange.pageId)"
      @focus="emit('hover-object', directChange.id, directChange.pageId)"
      @blur="emit('hover-object', null, directChange.pageId)"
      @mouseenter="emit('hover-object', directChange.id, directChange.pageId)"
      @mouseleave="emit('hover-object', null, directChange.pageId)"
    >
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-hover/80 text-muted"
        aria-hidden="true"
      >
        <icon-lucide-file-text class="size-3.5 stroke-[1.7]" />
      </span>
      <span class="min-w-0 flex-1">
        <span
          class="block text-[9px] font-medium leading-3 tracking-[0.08em] text-muted/75 uppercase"
        >
          {{ directLabel }}
        </span>
        <span class="mt-px block truncate text-[11.5px] leading-4 text-surface/90">
          {{ directChange.name }}
        </span>
      </span>
      <icon-lucide-chevron-right class="size-3.5 shrink-0 stroke-[1.6] text-muted/70" />
    </button>
    <button
      v-else
      ref="toggle"
      type="button"
      data-test-id="ai-board-changes-toggle"
      :aria-controls="objectListId"
      :aria-expanded="expanded"
      class="group flex h-8 w-full items-center gap-2 rounded-[7px] px-1.5 text-left transition-colors hover:bg-hover/55 focus-visible:bg-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/25"
      @click="expanded = !expanded"
    >
      <icon-lucide-layers-2 class="size-3.5 shrink-0 stroke-[1.6] text-muted/80" />
      <span class="min-w-0 flex-1 truncate font-medium text-surface/90">{{ countLabel }}</span>
      <span class="text-[11px] text-muted/70">{{ expanded ? 'Hide' : 'Show' }}</span>
      <icon-lucide-chevron-down
        class="size-3.5 shrink-0 stroke-[1.6] transition-transform duration-150 motion-reduce:transition-none"
        :class="expanded ? 'rotate-180' : ''"
      />
    </button>

    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-1 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-1 opacity-0"
    >
      <div
        v-if="expanded && !directChange"
        :id="objectListId"
        data-test-id="ai-board-changes-list"
        class="mt-0.5 flex flex-col pl-1.5"
      >
        <button
          v-for="change in changes"
          :key="change.id"
          type="button"
          :aria-label="`Show ${change.name}${destinationLabel ? ` ${destinationLabel}` : ''}`"
          :data-board-object-id="change.id"
          class="group/object flex h-8 w-full min-w-0 items-center gap-2 rounded-[7px] px-1.5 text-left transition-colors hover:bg-hover/55 focus-visible:bg-hover/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/25"
          @click="emit('open-object', change.id, change.pageId)"
          @focus="emit('hover-object', change.id, change.pageId)"
          @blur="emit('hover-object', null, change.pageId)"
          @mouseenter="emit('hover-object', change.id, change.pageId)"
          @mouseleave="emit('hover-object', null, change.pageId)"
        >
          <icon-lucide-type
            v-if="change.type === 'TEXT'"
            class="size-3.5 shrink-0 stroke-[1.6] text-muted/75"
          />
          <icon-lucide-image
            v-else-if="change.type === 'IMAGE'"
            class="size-3.5 shrink-0 stroke-[1.6] text-muted/75"
          />
          <icon-lucide-square
            v-else-if="change.type === 'FRAME' || change.type === 'SECTION'"
            class="size-3.5 shrink-0 stroke-[1.6] text-muted/75"
          />
          <icon-lucide-box v-else class="size-3.5 shrink-0 stroke-[1.6] text-muted/75" />
          <span class="min-w-0 flex-1 truncate text-surface/90">{{ change.name }}</span>
          <span class="shrink-0 text-[11px] capitalize text-muted/65">{{ change.verb }}</span>
        </button>
      </div>
    </Transition>
  </section>
</template>
