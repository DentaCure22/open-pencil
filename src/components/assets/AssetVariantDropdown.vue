<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

import { writeAssetVariantDrag } from '@/app/editor/assets/drag'
import { useEditorStore } from '@/app/editor/active-store'
import { smylrLiveComponentRoute } from '@/app/smylr-component-library/live-component-canvas'
import { smylrFrameBaseUrlFor } from '@/app/smylr-live-inspector/frame-origin'
import Tip from '@/components/ui/Tip.vue'
import { useButtonUI } from '@/components/ui/button'

import type { AssetVariant, LocalAsset } from './types'

const { asset } = defineProps<{ asset: LocalAsset }>()
const emit = defineEmits<{ openVariant: [variant: AssetVariant] }>()
const editor = useEditorStore()
const open = ref(false)
const previewUrls = ref<Record<string, string>>({})
const loadingPreviews = ref(false)
const triggerButton = useButtonUI({ tone: 'ghost', size: 'iconSm' })
let previewRequestId = 0

function revokePreviews() {
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
  previewUrls.value = {}
}

function pageIdForNode(nodeId: string) {
  const pageIds = new Set(editor.graph.getPages().map((page) => page.id))
  let node = editor.graph.getNode(nodeId)
  while (node) {
    if (pageIds.has(node.id)) return node.id
    node = node.parentId ? editor.graph.getNode(node.parentId) : undefined
  }
  return editor.state.currentPageId
}

async function loadScenePreviews() {
  const requestId = ++previewRequestId
  if (!open.value || asset.kind !== 'scene') return
  loadingPreviews.value = true
  const next: Record<string, string> = {}
  try {
    for (const variant of asset.variantItems) {
      const node = editor.graph.getNode(variant.componentId)
      if (!node) continue
      const scale = Math.min(128 / Math.max(node.width, node.height, 1), 2)
      const data = await editor.renderExportImage([node.id], scale, 'PNG', pageIdForNode(node.id))
      if (requestId !== previewRequestId || !open.value) return
      if (data) {
        next[variant.id] = URL.createObjectURL(new Blob([data], { type: 'image/png' }))
      }
    }
    revokePreviews()
    previewUrls.value = next
  } finally {
    if (requestId === previewRequestId) loadingPreviews.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) void loadScenePreviews()
  else {
    previewRequestId += 1
    revokePreviews()
  }
})
watch(
  () => editor.state.sceneVersion,
  () => {
    if (open.value && asset.kind === 'scene') void loadScenePreviews()
  }
)
onUnmounted(() => {
  previewRequestId += 1
  revokePreviews()
})

function beginDrag(event: DragEvent, variant: AssetVariant) {
  if (variant.kind === 'scene') {
    writeAssetVariantDrag(event, {
      kind: 'scene',
      componentId: variant.componentId,
      label: variant.label
    })
    return
  }
  writeAssetVariantDrag(event, {
    kind: 'computed',
    fixtureId: variant.fixtureId,
    variantId: variant.id,
    label: variant.label
  })
}

function openVariant(variant: AssetVariant) {
  open.value = false
  emit('openVariant', variant)
}

function computedPreviewSrc(asset: LocalAsset, variantId: string) {
  if (asset.kind !== 'computed') return ''
  return `${smylrFrameBaseUrlFor(window.location.href)}${smylrLiveComponentRoute(asset, variantId, {
    embed: true,
    preview: true
  })}`
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <Tip :label="`Show ${asset.name} variants`">
      <PopoverTrigger as-child>
        <button
          type="button"
          data-test-id="asset-variants-trigger"
          :aria-label="`Show ${asset.name} variants`"
          :class="triggerButton.base"
          class="text-component"
          @click.stop
        >
          <icon-lucide-layout-grid class="size-3" />
        </button>
      </PopoverTrigger>
    </Tip>
    <PopoverPortal>
      <PopoverContent
        data-test-id="asset-variants-dropdown"
        side="right"
        align="start"
        :side-offset="8"
        :collision-padding="12"
        class="border-border bg-panel z-70 w-[316px] overflow-hidden rounded-lg border p-2 shadow-xl"
        @click.stop
      >
        <div class="flex items-center justify-between px-1 pb-2">
          <div class="min-w-0">
            <p class="text-surface truncate text-xs font-semibold">{{ asset.name }} variants</p>
            <p class="text-muted mt-0.5 text-[10px]">Click to open · drag onto this board</p>
          </div>
          <span class="text-muted text-[10px] tabular-nums">{{ asset.variantCount }}</span>
        </div>
        <div class="scrollbar-thin grid max-h-[420px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
          <button
            v-for="variant in asset.variantItems"
            :key="variant.id"
            type="button"
            draggable="true"
            data-test-id="asset-variant-item"
            :data-variant-id="variant.id"
            :aria-label="`Open ${asset.name} ${variant.label} variant`"
            class="border-border bg-input/30 hover:border-component/50 hover:bg-component/8 focus-visible:border-component group/variant min-w-0 cursor-grab overflow-hidden rounded-md border text-left transition-colors active:cursor-grabbing"
            @dragstart="beginDrag($event, variant)"
            @click="openVariant(variant)"
          >
            <span
              class="border-border/70 bg-canvas/70 relative flex h-[72px] items-center justify-center overflow-hidden border-b"
            >
              <img
                v-if="variant.kind === 'scene' && previewUrls[variant.id]"
                :src="previewUrls[variant.id]"
                :alt="`${variant.label} preview`"
                class="max-h-[58px] max-w-[128px] object-contain"
              />
              <iframe
                v-else-if="variant.kind === 'computed' && asset.kind === 'computed'"
                :src="computedPreviewSrc(asset, variant.id)"
                :title="`${asset.name} ${variant.label} preview`"
                tabindex="-1"
                class="pointer-events-none size-full border-0 bg-white"
              />
              <icon-lucide-loader-2
                v-else-if="loadingPreviews"
                class="text-muted size-4 animate-spin"
              />
              <icon-lucide-box v-else class="text-component/70 size-5" />
              <span
                class="bg-component absolute right-1 bottom-1 flex size-4 items-center justify-center rounded text-white opacity-0 shadow-sm transition-opacity group-hover/variant:opacity-100 group-focus-visible/variant:opacity-100"
              >
                <icon-lucide-arrow-up-right class="size-2.5" />
              </span>
            </span>
            <span class="text-surface block truncate px-2 py-1.5 text-[10.5px] font-medium">
              {{ variant.label }}
            </span>
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
