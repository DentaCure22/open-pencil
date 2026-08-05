<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import type { ContainerNavigationState } from '@/app/editor/container-navigation'

const store = useEditorStore()
const state = ref<ContainerNavigationState | null>(store.containerNavigation.getState())

const unsubscribe = store.containerNavigation.subscribe(() => {
  state.value = store.containerNavigation.getState()
})

onUnmounted(unsubscribe)
</script>

<template>
  <Transition
    enter-active-class="transition duration-150"
    enter-from-class="-translate-y-1 opacity-0"
    leave-active-class="transition duration-100"
    leave-to-class="-translate-y-1 opacity-0"
  >
    <div
      v-if="state"
      aria-live="polite"
      class="pointer-events-none absolute top-16 left-1/2 z-40 flex max-w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full border border-white/12 bg-[#121419]/95 px-3 py-1.5 text-[10px] text-slate-300 shadow-xl backdrop-blur-xl"
      data-test-id="container-navigation-status"
      role="status"
    >
      <span class="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
      <span class="truncate">
        Inside <strong class="font-semibold text-white">{{ state.activeContainerName }}</strong>
      </span>
      <span class="hidden text-slate-500 sm:inline">Arrows move · Enter deeper · Esc back</span>
    </div>
  </Transition>
</template>
