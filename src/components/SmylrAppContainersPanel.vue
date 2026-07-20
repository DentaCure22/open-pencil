<script setup lang="ts">
import { computed } from 'vue'

import {
  liveInspectorAuthStatus,
  liveInspectorFlatNodes,
  liveInspectorFrameSrc,
  liveInspectorHoveredId,
  liveInspectorInteractionMode,
  liveInspectorPendingSelectedId,
  liveInspectorRoute,
  liveInspectorSelectedId,
  liveInspectorStatus,
  reloadLiveInspectorFrame,
  setLiveInspectorInteractionMode,
  selectLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import Tip from './ui/Tip.vue'

const hasContainers = computed(() => liveInspectorFlatNodes.value.length > 0)
const statusLabel = computed(() => {
  if (liveInspectorStatus.value === 'connected') return 'Live'
  if (liveInspectorStatus.value === 'loading') return 'Loading'
  if (liveInspectorStatus.value === 'unavailable') return 'Reconnect'
  return 'Idle'
})
const statusClass = computed(() => {
  if (liveInspectorStatus.value === 'connected') return 'bg-green-500'
  if (liveInspectorStatus.value === 'loading') return 'bg-blue-400'
  if (liveInspectorStatus.value === 'unavailable') return 'bg-amber-400'
  return 'bg-muted'
})
const emptyText = computed(() => {
  if (liveInspectorStatus.value === 'unavailable')
    return 'Live layers disconnected. Reload to reconnect.'
  if (liveInspectorStatus.value === 'loading') return 'Connecting to live layers…'
  return 'Waiting for the live Smylr layer tree.'
})

function sourceLabel(filePath: string | undefined) {
  if (!filePath) return ''
  return filePath.split('/').slice(-2).join('/')
}

function selectContainer(id: string) {
  if (liveInspectorInteractionMode.value !== 'select') {
    setLiveInspectorInteractionMode('select')
  }
  selectLiveInspectorNode(id)
}

function useLiveApp() {
  setLiveInspectorInteractionMode('interact')
}

function openLiveApp() {
  if (!liveInspectorFrameSrc.value) return
  window.open(liveInspectorFrameSrc.value, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <section data-test-id="smylr-app-containers-panel" class="flex min-h-0 flex-1 flex-col">
    <header class="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
      <span class="size-1.5 shrink-0 rounded-full" :class="statusClass" />
      <span class="min-w-0 flex-1 truncate text-[10px] text-muted">
        {{ liveInspectorRoute || statusLabel }}
      </span>
      <Tip label="Use the live app">
        <button
          type="button"
          data-test-id="smylr-live-interact"
          class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
          :class="liveInspectorInteractionMode === 'interact' ? 'bg-hover text-surface' : ''"
          @click="useLiveApp"
        >
          <icon-lucide-mouse-pointer-click class="size-3.5" />
        </button>
      </Tip>
      <Tip label="Open Smylr">
        <button
          type="button"
          data-test-id="smylr-open-live-app"
          class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-hover hover:text-surface disabled:cursor-default disabled:opacity-40"
          :disabled="!liveInspectorFrameSrc"
          @click="openLiveApp"
        >
          <icon-lucide-external-link class="size-3" />
        </button>
      </Tip>
    </header>

    <div
      v-if="!hasContainers"
      data-test-id="smylr-app-containers-empty"
      class="px-3 py-3 text-[11px] leading-4 text-muted"
    >
      {{ emptyText }}
      <div v-if="liveInspectorStatus === 'unavailable'" class="mt-2 flex gap-1.5">
        <button
          type="button"
          data-test-id="smylr-auth-open-live-app"
          class="flex min-h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded bg-input px-2 text-[10px] text-surface hover:bg-hover"
          @click="openLiveApp"
        >
          Open Smylr
        </button>
        <button
          type="button"
          data-test-id="smylr-auth-reload-frame"
          class="flex min-h-6 flex-1 cursor-pointer items-center justify-center gap-1 rounded bg-input px-2 text-[10px] text-surface hover:bg-hover"
          @click="reloadLiveInspectorFrame"
        >
          Reload
        </button>
      </div>
      <span v-if="liveInspectorAuthStatus === 'authenticated'" class="sr-only">
        Authenticated bridge
      </span>
    </div>

    <div v-else class="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-1 py-1">
      <button
        v-for="item in liveInspectorFlatNodes"
        :key="item.node.id"
        type="button"
        data-test-id="smylr-app-container-row"
        :data-smylr-live-node-id="item.node.id"
        class="group/row flex w-full cursor-pointer items-center gap-1 rounded py-1 pr-1 text-left text-xs"
        :class="[
          liveInspectorSelectedId === item.node.id
            ? 'bg-accent text-white'
            : liveInspectorPendingSelectedId === item.node.id
              ? 'bg-accent/15 text-surface ring-1 ring-accent/50'
              : liveInspectorHoveredId === item.node.id
                ? 'bg-accent/10 text-surface'
                : 'bg-transparent text-surface hover:bg-hover'
        ]"
        :style="{ paddingLeft: `${8 + item.depth * 12}px` }"
        @click="selectContainer(item.node.id)"
      >
        <icon-lucide-box class="size-3 shrink-0 opacity-70" />
        <span class="min-w-0 flex-1 truncate">{{ item.node.label }}</span>
        <span
          v-if="item.childCount > 0"
          class="rounded bg-black/10 px-1 text-[9px] text-current opacity-60"
        >
          {{ item.childCount }}
        </span>
        <span
          v-else-if="sourceLabel(item.node.source?.filePath)"
          class="hidden max-w-24 truncate text-[9px] opacity-50 group-hover/row:block"
        >
          {{ sourceLabel(item.node.source?.filePath) }}
        </span>
      </button>
    </div>
  </section>
</template>
