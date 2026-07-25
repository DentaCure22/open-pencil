<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { templateRef, unrefElement, useTimeoutFn } from '@vueuse/core'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'

import { writeAssetVariantDrag } from '@/app/editor/assets/drag'
import { useEditorStore } from '@/app/editor/active-store'
import { smylrLiveComponentRoute } from '@/app/smylr-component-library/live-component-canvas'
import { smylrFrameBaseUrlFor } from '@/app/smylr-live-inspector/frame-origin'

import type { AssetVariant, InteractiveAsset } from './types'

const { asset } = defineProps<{ asset: InteractiveAsset }>()
const emit = defineEmits<{ openVariant: [variant: AssetVariant] }>()
const editor = useEditorStore()
const open = defineModel<boolean>('open', { default: false })
const previewUrls = ref<Record<string, string>>({})
const loadingPreviews = ref(false)
const rootRef = templateRef('rootRef')
const variantsListRef = templateRef('variantsListRef')
const activePreviewIndex = ref<number | null>(null)
const openingScrollLock = ref(false)
let previewRequestId = 0
const { start: startScrollUnlock, stop: stopScrollUnlock } = useTimeoutFn(
  () => {
    openingScrollLock.value = false
  },
  800,
  { immediate: false }
)

function resetVariantScroll() {
  const list = unrefElement(variantsListRef.value)
  if (list instanceof HTMLElement) list.scrollTop = 0
}

function revealOpenAsset() {
  const root = unrefElement(rootRef.value)
  if (!(root instanceof HTMLElement)) return

  let ancestor = root.parentElement
  while (ancestor) {
    ancestor.scrollLeft = 0
    ancestor = ancestor.parentElement
  }

  let scrollParent = root.parentElement
  while (scrollParent) {
    const overflowY = window.getComputedStyle(scrollParent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') break
    scrollParent = scrollParent.parentElement
  }
  if (!scrollParent) return

  const rootBounds = root.getBoundingClientRect()
  const parentBounds = scrollParent.getBoundingClientRect()
  scrollParent.scrollTop += rootBounds.top - parentBounds.top
}

function stabilizeOpenAsset() {
  resetVariantScroll()
  revealOpenAsset()
  requestAnimationFrame(resetVariantScroll)
}

function shouldRenderComputedPreview(variantIndex: number) {
  return variantIndex < 6 || activePreviewIndex.value === variantIndex
}

function handleComputedPreviewLoad() {
  if (openingScrollLock.value) stabilizeOpenAsset()
}

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
  if (isOpen) {
    activePreviewIndex.value = null
    openingScrollLock.value = true
    stopScrollUnlock()
    startScrollUnlock()
    void loadScenePreviews()
    void nextTick(() => {
      stabilizeOpenAsset()
    })
  } else {
    stopScrollUnlock()
    openingScrollLock.value = false
    activePreviewIndex.value = null
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
  stopScrollUnlock()
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
    variantId: variant.variantId,
    label: variant.label
  })
}

function endDrag() {
  open.value = false
}

function openVariant(variant: AssetVariant) {
  open.value = false
  emit('openVariant', variant)
}

function computedPreviewSrc(asset: InteractiveAsset, variantId: string | null) {
  if (asset.kind !== 'computed') return ''
  return `${smylrFrameBaseUrlFor(window.location.href)}${smylrLiveComponentRoute(
    asset,
    variantId ?? undefined,
    {
      embed: true,
      preview: true
    }
  )}`
}

function usesTallComputedPreview() {
  return asset.kind === 'computed' && asset.overlayWidth >= 480 && asset.overlayHeight >= 240
}
</script>

<template>
  <div ref="rootRef" class="min-w-0 flex-1">
    <CollapsibleRoot v-model:open="open">
      <CollapsibleTrigger as-child>
        <slot :open="open" />
      </CollapsibleTrigger>
      <CollapsibleContent data-test-id="asset-variants-dropdown" class="overflow-hidden">
        <div class="ml-5 pb-1.5">
          <div
            ref="variantsListRef"
            data-test-id="asset-variant-scroll"
            class="scrollbar-thin grid max-h-80 gap-1 overflow-x-hidden overflow-y-auto pt-1 [overflow-anchor:none]"
          >
            <button
              v-for="(variant, variantIndex) in asset.variantItems"
              :key="variant.id"
              type="button"
              draggable="true"
              data-test-id="asset-variant-item"
              :data-variant-id="variant.id"
              :aria-label="`Open ${asset.name} ${variant.label}; drag to add it to this board`"
              class="hover:bg-hover focus-visible:bg-hover group/variant flex min-w-0 cursor-grab flex-col items-stretch gap-1 rounded-[5px] px-1 py-1.5 text-left transition-colors active:cursor-grabbing"
              @dragstart="beginDrag($event, variant)"
              @dragend="endDrag"
              @focus="activePreviewIndex = variantIndex"
              @blur="activePreviewIndex = null"
              @mouseenter="activePreviewIndex = variantIndex"
              @mouseleave="activePreviewIndex = null"
              @click="openVariant(variant)"
            >
              <span
                data-test-id="asset-variant-preview"
                class="relative flex w-full items-center justify-center overflow-hidden rounded-[4px]"
                :class="usesTallComputedPreview() ? 'h-28' : 'h-16'"
              >
                <img
                  v-if="variant.kind === 'scene' && previewUrls[variant.id]"
                  :src="previewUrls[variant.id]"
                  :alt="`${variant.label} preview`"
                  class="max-h-14 max-w-[5.5rem] object-contain"
                />
                <iframe
                  v-else-if="
                    variant.kind === 'computed' &&
                    asset.kind === 'computed' &&
                    variant.variantId !== null &&
                    shouldRenderComputedPreview(variantIndex)
                  "
                  :src="computedPreviewSrc(asset, variant.variantId)"
                  :title="`${asset.name} ${variant.label} preview`"
                  allowtransparency="true"
                  tabindex="-1"
                  loading="eager"
                  class="pointer-events-none size-full border-0 bg-transparent [color-scheme:normal]"
                  @load="handleComputedPreviewLoad"
                />
                <icon-lucide-loader-2
                  v-else-if="loadingPreviews"
                  class="text-muted size-4 animate-spin"
                />
                <span v-else class="flex flex-col items-center gap-1 text-component/80">
                  <icon-lucide-box class="size-6" />
                  <span class="text-[8px] leading-none font-semibold tracking-wide uppercase">
                    Component
                  </span>
                </span>
              </span>
              <span class="flex min-w-0 items-center justify-between gap-2 px-0.5">
                <span class="text-surface min-w-0 truncate text-[10.5px] font-medium">
                  {{ variant.label }}
                </span>
                <span class="text-muted/75 shrink-0 text-[9px]">Drag</span>
              </span>
            </button>
          </div>
          <div
            data-test-id="asset-actions"
            class="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-[9.5px] font-medium"
          >
            <slot name="actions" />
          </div>
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
  </div>
</template>
