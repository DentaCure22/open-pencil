<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, ref } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  applyLiveFrameViewportPreset,
  LIVE_FRAME_VIEWPORT_PRESETS,
  liveFrameViewportPresetId,
  resetLiveFrameTransform,
  type LiveFrameViewportPresetId
} from '@/app/smylr-production/frame-transform'
import { menuItem, useMenuUI } from '@/components/ui/menu'

import Tip from '../ui/Tip.vue'

const { frameId, frameLabel = 'frame' } = defineProps<{ frameId: string; frameLabel?: string }>()
const emit = defineEmits<{ change: [] }>()
const store = useEditorStore()
const rootRef = ref<HTMLElement>()
const open = ref(false)
const menuCls = useMenuUI({ content: 'min-w-44' })
const itemCls = menuItem({ justify: 'start', class: 'relative w-full' })

const activePresetId = computed(() => {
  void store.state.sceneVersion
  return liveFrameViewportPresetId(store.graph.getNode(frameId))
})

function applyPreset(presetId: LiveFrameViewportPresetId) {
  if (applyLiveFrameViewportPreset(store, frameId, presetId)) emit('change')
  open.value = false
}

function resetTransform() {
  if (resetLiveFrameTransform(store, frameId)) emit('change')
  open.value = false
}

useEventListener(
  document,
  'pointerdown',
  (event) => {
    if (event.target instanceof Node && !rootRef.value?.contains(event.target)) open.value = false
  },
  { capture: true }
)
</script>

<template>
  <span
    ref="rootRef"
    class="relative flex"
    @click.stop
    @keydown.escape.stop="open = false"
    @pointerdown.stop
  >
    <Tip :label="`Viewport · ${activePresetId ?? 'Custom'}`">
      <button
        :aria-expanded="open"
        aria-haspopup="menu"
        :aria-label="`Choose viewport for ${frameLabel}`"
        class="flex h-7 items-center gap-0.5 rounded px-1.5 text-muted hover:bg-hover hover:text-surface data-[state=open]:bg-hover data-[state=open]:text-surface"
        :data-state="open ? 'open' : 'closed'"
        data-test-id="smylr-live-frame-viewport-controls"
        type="button"
        @click.stop.prevent="open = true"
        @pointerdown.stop.prevent="open = true"
      >
        <icon-lucide-monitor v-if="activePresetId === 'desktop'" class="size-4" />
        <icon-lucide-laptop v-else-if="activePresetId === 'laptop'" class="size-4" />
        <icon-lucide-tablet v-else-if="activePresetId === 'tablet'" class="size-4" />
        <icon-lucide-smartphone v-else-if="activePresetId === 'phone'" class="size-4" />
        <icon-lucide-panels-top-left v-else class="size-4" />
        <icon-lucide-chevron-down class="size-3" />
      </button>
    </Tip>

    <div
      v-if="open"
      :aria-label="`Viewport options for ${frameLabel}`"
      :class="menuCls.content"
      class="absolute top-full left-1/2 mt-1.5 -translate-x-1/2"
      role="menu"
    >
      <button
        :class="itemCls"
        data-test-id="smylr-live-frame-reset-transform"
        role="menuitem"
        type="button"
        @click="resetTransform"
      >
        <icon-lucide-scan class="size-3.5 text-muted" />
        <span class="flex-1 text-left">Reset to base</span>
        <span class="text-[10px] text-muted">1280 × 900</span>
      </button>

      <div :class="menuCls.separator" role="separator" />

      <button
        v-for="preset in LIVE_FRAME_VIEWPORT_PRESETS"
        :key="preset.id"
        :class="[itemCls, activePresetId === preset.id ? 'bg-hover text-surface' : '']"
        :data-test-id="`smylr-live-frame-viewport-${preset.id}`"
        role="menuitem"
        type="button"
        @click="applyPreset(preset.id)"
      >
        <icon-lucide-monitor v-if="preset.id === 'desktop'" class="size-3.5 text-muted" />
        <icon-lucide-laptop v-else-if="preset.id === 'laptop'" class="size-3.5 text-muted" />
        <icon-lucide-tablet v-else-if="preset.id === 'tablet'" class="size-3.5 text-muted" />
        <icon-lucide-smartphone v-else class="size-3.5 text-muted" />
        <span class="flex-1 text-left">{{ preset.label }}</span>
        <span class="text-[10px] text-muted">{{ preset.width }} × {{ preset.height }}</span>
      </button>
    </div>
  </span>
</template>
