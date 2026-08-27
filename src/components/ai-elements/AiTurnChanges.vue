<script setup lang="ts">
import { onClickOutside } from '@vueuse/core'
import { computed, ref, useId } from 'vue'

import type { AiTurnChanges } from '@/app/agent-chat/types'

const { changes } = defineProps<{ changes: AiTurnChanges }>()
const emit = defineEmits<{ 'open-file': [path: string] }>()
const expanded = ref(false)
const root = ref<HTMLElement | null>(null)
const fileListId = `turn-changed-files-${useId()}`

const fileCountLabel = computed(
  () => `${String(changes.files.length)} ${changes.files.length === 1 ? 'file' : 'files'}`
)

onClickOutside(root, () => {
  expanded.value = false
})

function openFile(path: string) {
  expanded.value = false
  emit('open-file', path)
}
</script>

<template>
  <section
    ref="root"
    class="relative flex w-full justify-center"
    data-test-id="ai-turn-changes"
    @keydown.escape.stop="expanded = false"
  >
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="translate-y-1 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="translate-y-1 opacity-0"
    >
      <div
        v-if="expanded"
        :id="fileListId"
        role="menu"
        data-test-id="turn-changed-files"
        class="border-chrome-border bg-sidebar shadow-chrome-menu absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-[min(calc(100%-1rem),28rem)] -translate-x-1/2 overflow-hidden rounded-[12px] border py-1"
      >
        <div class="border-chrome-border/70 flex h-9 items-center gap-2 border-b px-3">
          <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-surface">
            {{ fileCountLabel }} changed
          </span>
          <span class="text-success text-[10px] tabular-nums">+{{ changes.additions }}</span>
          <span class="text-red-400 text-[10px] tabular-nums">−{{ changes.deletions }}</span>
        </div>
        <button
          v-for="file in changes.files"
          :key="file.path"
          type="button"
          role="menuitem"
          :aria-label="file.path"
          :data-changed-file="file.path"
          class="flex min-h-9 w-full min-w-0 items-center gap-2 px-3 text-left text-[11px] text-muted transition-colors hover:bg-hover hover:text-surface focus-visible:bg-hover focus-visible:text-surface focus-visible:outline-none"
          @click="openFile(file.path)"
        >
          <span class="min-w-0 flex-1 truncate font-mono text-surface/90">{{ file.path }}</span>
          <span class="shrink-0 capitalize text-muted/70">{{ file.status }}</span>
          <span class="flex shrink-0 items-center gap-1.5 font-mono text-[10px] tabular-nums">
            <span v-if="file.additions" class="text-success">+{{ file.additions }}</span>
            <span v-if="file.deletions" class="text-red-400">−{{ file.deletions }}</span>
          </span>
        </button>
      </div>
    </Transition>
    <button
      type="button"
      class="inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-[10px] border border-border/70 bg-agent-surface px-3.5 text-[14px] font-normal tracking-[-0.01em] text-muted shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-[background-color,border-color,transform] hover:border-border hover:bg-hover/35 active:scale-[0.985]"
      data-test-id="ai-turn-changes-toggle"
      aria-haspopup="menu"
      :aria-controls="expanded ? fileListId : undefined"
      :aria-expanded="expanded"
      :aria-label="
        expanded ? 'Hide files changed in latest turn' : 'Show files changed in latest turn'
      "
      @click="expanded = !expanded"
    >
      <span>{{ fileCountLabel }} changed</span>
      <span class="text-success tabular-nums">+{{ changes.additions }}</span>
      <span class="text-red-500 tabular-nums">−{{ changes.deletions }}</span>
    </button>
  </section>
</template>
