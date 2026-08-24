<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AiMarkdown from './AiMarkdown.vue'
import type { ConversationNavigationItem } from './conversation-navigation'

const MINIMUM_NAVIGATION_ITEMS = 4
const PREVIEW_DELAY_MS = 150
const MARKER_PROGRESS = [1, 0.7, 0.4, 0.2] as const
const MARKER_BASE_SCALE = 0.2308
const MARKER_PROGRESS_SCALE = 0.7692

const { items, scrollElement } = defineProps<{
  items: ConversationNavigationItem[]
  scrollElement: HTMLElement | null
}>()

const emit = defineEmits<{
  reveal: [item: ConversationNavigationItem]
}>()

type ScrubState = {
  itemId: string
  moved: boolean
  pointerId: number
}

const rail = ref<HTMLElement | null>(null)
const tooltip = ref<HTMLElement | null>(null)
const tooltipAnchor = ref<HTMLElement | null>(null)
const activeItemIds = ref<Set<string>>(new Set())
const previewItemId = ref<string | null>(null)
const hoveredIndex = ref<number | null>(null)
const focusedIndex = ref<number | null>(null)
const previewOpen = ref(false)
const scrubbing = ref<ScrubState | null>(null)
const tooltipPosition = ref({ left: 8, top: 8 })
let openTimer: ReturnType<typeof setTimeout> | undefined
let frame: number | undefined
let observer: ResizeObserver | undefined
let suppressClick = false

const visible = computed(() => items.length >= MINIMUM_NAVIGATION_ITEMS)
const previewItem = computed(
  () => items.find((item) => item.id === previewItemId.value) ?? items[0]
)
const tooltipStyle = computed(() => ({
  left: `${String(tooltipPosition.value.left)}px`,
  top: `${String(tooltipPosition.value.top)}px`
}))
const interactionIndex = computed(() => hoveredIndex.value ?? focusedIndex.value)

function clearOpenTimer() {
  if (openTimer === undefined) return
  clearTimeout(openTimer)
  openTimer = undefined
}

function escapedId(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replaceAll('"', '\\"')
}

function chapterElement(itemId: string): HTMLElement | null {
  return (
    scrollElement?.querySelector<HTMLElement>(
      `[data-conversation-chapter-id="${escapedId(itemId)}"]`
    ) ?? null
  )
}

function markerButton(itemId: string): HTMLElement | null {
  return (
    rail.value?.querySelector<HTMLElement>(
      `[data-conversation-chapter-marker-id="${escapedId(itemId)}"]`
    ) ?? null
  )
}

function keepActiveMarkerVisible() {
  const list = rail.value
  const activeId = items.find((item) => activeItemIds.value.has(item.id))?.id
  const button = activeId ? markerButton(activeId) : null
  if (!list || !button) return
  if (button.offsetTop < list.scrollTop) list.scrollTop = button.offsetTop
  else if (button.offsetTop + button.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = button.offsetTop + button.offsetHeight - list.clientHeight + 1
  }
}

function refreshActiveItems() {
  const viewport = scrollElement
  if (!viewport || !items.length) return
  const bounds = viewport.getBoundingClientRect()
  const visibleTop = bounds.top + 16
  const visibleBottom = bounds.bottom
  const next = new Set<string>()
  let preceding: string | undefined

  for (const item of items) {
    const chapter = chapterElement(item.id)
    if (!chapter) continue
    const chapterBounds = chapter.getBoundingClientRect()
    if (chapterBounds.top <= visibleTop) preceding = item.id
    if (chapterBounds.bottom > visibleTop && chapterBounds.top < visibleBottom) next.add(item.id)
  }

  if (!next.size) next.add(preceding ?? items[0]?.id ?? '')
  next.delete('')
  activeItemIds.value = next
  void nextTick(keepActiveMarkerVisible)
}

function scheduleActiveRefresh() {
  if (frame !== undefined) return
  frame = requestAnimationFrame(() => {
    frame = undefined
    refreshActiveItems()
  })
}

function refreshTooltipPosition() {
  if (!previewOpen.value) return
  const anchor = tooltipAnchor.value
  const card = tooltip.value
  if (!anchor || !card) return
  const anchorBounds = anchor.getBoundingClientRect()
  const cardBounds = card.getBoundingClientRect()
  tooltipPosition.value = {
    left: Math.min(
      Math.max(8, anchorBounds.right + 18),
      Math.max(8, window.innerWidth - cardBounds.width - 8)
    ),
    top: Math.min(
      Math.max(8, anchorBounds.top + anchorBounds.height / 2 - cardBounds.height / 2),
      Math.max(8, window.innerHeight - cardBounds.height - 8)
    )
  }
}

async function openPreview(item: ConversationNavigationItem, button: HTMLElement) {
  clearOpenTimer()
  previewItemId.value = item.id
  tooltipAnchor.value = button
  previewOpen.value = true
  await nextTick()
  refreshTooltipPosition()
}

function queuePreview(item: ConversationNavigationItem, button: HTMLElement) {
  tooltipAnchor.value = button
  if (previewOpen.value) {
    void openPreview(item, button)
    return
  }
  clearOpenTimer()
  openTimer = setTimeout(() => {
    openTimer = undefined
    void openPreview(item, button)
  }, PREVIEW_DELAY_MS)
}

function closePreview() {
  clearOpenTimer()
  previewOpen.value = false
  previewItemId.value = null
  tooltipAnchor.value = null
}

function resetNavigationInteraction() {
  const state = scrubbing.value
  if (state) rail.value?.releasePointerCapture?.(state.pointerId)
  activeItemIds.value = new Set()
  focusedIndex.value = null
  hoveredIndex.value = null
  scrubbing.value = null
  suppressClick = false
  closePreview()
}

function markerProgress(index: number): number {
  const activeIndex = interactionIndex.value
  if (activeIndex === null) return 0
  return MARKER_PROGRESS[Math.abs(index - activeIndex)] ?? 0
}

function markerLineStyle(index: number) {
  const progress = markerProgress(index)
  const scale = MARKER_BASE_SCALE + MARKER_PROGRESS_SCALE * progress
  return {
    width: `${String(26 * scale)}px`,
    transitionDuration: scrubbing.value ? '0ms' : '160ms',
    transitionTimingFunction:
      'linear(0, 0.398 10%, 0.682 20%, 0.843 30%, 0.925 40%, 0.972 50%, 1.004 60%, 1.008 70%, 1.003 80%, 1)'
  }
}

function markerTone(item: ConversationNavigationItem, index: number): string {
  const interacting = interactionIndex.value !== null
  if (interactionIndex.value === index) return 'text-surface opacity-100'
  if (!interacting && activeItemIds.value.has(item.id)) return 'text-surface opacity-60'
  return 'text-muted opacity-40'
}

function flashChapter(chapter: HTMLElement) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const bubble = chapter.querySelector<HTMLElement>(
    '[data-role="user"] [data-test-id="ai-message-content"]'
  )
  bubble?.animate(
    [
      { backgroundColor: 'color-mix(in srgb, var(--color-surface) 14%, transparent)' },
      {
        backgroundColor: 'color-mix(in srgb, var(--color-surface) 14%, transparent)',
        offset: 0.35
      },
      { backgroundColor: 'color-mix(in srgb, var(--color-surface) 5%, transparent)' }
    ],
    { duration: 1_400, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
  )
}

function revealItem(item: ConversationNavigationItem, behavior: ScrollBehavior) {
  const chapter = chapterElement(item.id)
  if (!chapter) {
    emit('reveal', item)
    return
  }
  chapter.scrollIntoView({ behavior, block: 'start' })
  flashChapter(chapter)
}

function hoverMarker(item: ConversationNavigationItem, index: number, event: PointerEvent) {
  if (scrubbing.value) return
  hoveredIndex.value = index
  queuePreview(item, event.currentTarget as HTMLElement)
}

function focusMarker(item: ConversationNavigationItem, index: number, event: FocusEvent) {
  focusedIndex.value = index
  void openPreview(item, event.currentTarget as HTMLElement)
}

function blurMarker(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && rail.value?.contains(next)) return
  focusedIndex.value = null
  if (hoveredIndex.value === null) closePreview()
}

function leaveRail() {
  hoveredIndex.value = null
  if (!scrubbing.value && focusedIndex.value === null) closePreview()
}

function itemFromPointer(event: PointerEvent): {
  button: HTMLElement
  index: number
  item: ConversationNavigationItem
} | null {
  const buttons = [
    ...(rail.value?.querySelectorAll<HTMLElement>('[data-conversation-chapter-marker-id]') ?? [])
  ]
  if (!buttons.length) return null
  const button = buttons.reduce((nearest, candidate) => {
    const candidateBounds = candidate.getBoundingClientRect()
    const nearestBounds = nearest.getBoundingClientRect()
    const candidateDistance = Math.abs(
      event.clientY - (candidateBounds.top + candidateBounds.height / 2)
    )
    const nearestDistance = Math.abs(event.clientY - (nearestBounds.top + nearestBounds.height / 2))
    return candidateDistance < nearestDistance ? candidate : nearest
  })
  const id = button.dataset.conversationChapterMarkerId
  const index = items.findIndex((item) => item.id === id)
  const item = items[index]
  return item && index !== -1 ? { button, index, item } : null
}

function startScrub(event: PointerEvent) {
  if (event.button !== 0) return
  const target = itemFromPointer(event)
  if (!target || !rail.value) return
  scrubbing.value = { itemId: target.item.id, moved: false, pointerId: event.pointerId }
  hoveredIndex.value = target.index
  rail.value.setPointerCapture?.(event.pointerId)
  void openPreview(target.item, target.button)
}

function moveScrub(event: PointerEvent) {
  const state = scrubbing.value
  if (!state || state.pointerId !== event.pointerId) return
  if (event.buttons % 2 === 0) {
    endScrub(event)
    return
  }
  const target = itemFromPointer(event)
  if (!target || target.item.id === state.itemId) return
  scrubbing.value = { ...state, itemId: target.item.id, moved: true }
  hoveredIndex.value = target.index
  void openPreview(target.item, target.button)
  revealItem(target.item, 'auto')
}

function endScrub(event: PointerEvent) {
  const state = scrubbing.value
  if (!state || state.pointerId !== event.pointerId) return
  suppressClick = state.moved
  scrubbing.value = null
  rail.value?.releasePointerCapture?.(event.pointerId)
  setTimeout(() => {
    suppressClick = false
  }, 0)
}

function clickMarker(item: ConversationNavigationItem, index: number, event: MouseEvent) {
  if (suppressClick) return
  hoveredIndex.value = index
  void openPreview(item, event.currentTarget as HTMLElement)
  revealItem(
    item,
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  )
}

function setupViewport() {
  observer?.disconnect()
  observer = undefined
  const viewport = scrollElement
  if (!viewport || !visible.value) return
  viewport.addEventListener('scroll', scheduleActiveRefresh, { passive: true })
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(scheduleActiveRefresh)
    observer.observe(viewport)
    const content = viewport.firstElementChild
    if (content instanceof HTMLElement) observer.observe(content)
  }
  scheduleActiveRefresh()
}

function teardownViewport(viewport: HTMLElement | null) {
  viewport?.removeEventListener('scroll', scheduleActiveRefresh)
  observer?.disconnect()
  observer = undefined
}

watch(
  [() => scrollElement, () => items.map((item) => item.id).join('\0')],
  async ([viewport, itemKey], [previousViewport, previousItemKey]) => {
    teardownViewport(previousViewport instanceof HTMLElement ? previousViewport : null)
    if (itemKey !== previousItemKey) resetNavigationInteraction()
    await nextTick()
    if (viewport !== scrollElement) return
    setupViewport()
  },
  { immediate: true }
)

useEventListener(window, 'resize', () => {
  scheduleActiveRefresh()
  refreshTooltipPosition()
})

onBeforeUnmount(() => {
  teardownViewport(scrollElement)
  resetNavigationInteraction()
  if (frame !== undefined) cancelAnimationFrame(frame)
})
</script>

<template>
  <nav
    v-if="visible"
    aria-label="User messages"
    class="absolute top-[calc(50%+2rem)] left-1 z-20 -translate-y-1/2 animate-in fade-in duration-150 motion-reduce:animate-none"
    data-test-id="ai-conversation-chapter-rail"
  >
    <div
      ref="rail"
      class="scrollbar-none flex max-h-[min(70vh,40rem)] flex-col overflow-y-auto overscroll-contain"
      :data-scrubbing="scrubbing ? 'true' : undefined"
      @lostpointercapture="endScrub"
      @pointercancel="endScrub"
      @pointerdown="startScrub"
      @pointerleave="leaveRail"
      @pointermove="moveScrub"
      @pointerup="endScrub"
    >
      <button
        v-for="(item, index) in items"
        :key="item.id"
        type="button"
        :aria-current="activeItemIds.has(item.id) ? 'true' : undefined"
        :aria-describedby="
          previewOpen && previewItem?.id === item.id ? `${item.id}-preview` : undefined
        "
        :aria-label="`Jump to user message ${String(index + 1)}`"
        :data-conversation-chapter-marker-id="item.id"
        class="flex h-2.5 w-9 shrink-0 cursor-pointer items-center outline-none focus-visible:ring-2 focus-visible:ring-component/35"
        data-test-id="ai-conversation-chapter-marker"
        @blur="blurMarker"
        @click="clickMarker(item, index, $event)"
        @focus="focusMarker(item, index, $event)"
        @pointerenter="hoverMarker(item, index, $event)"
      >
        <span
          aria-hidden="true"
          class="flex h-1 w-[30px] items-center transition-[color,opacity] duration-150 motion-reduce:transition-none"
          :class="markerTone(item, index)"
        >
          <span
            class="h-full w-[26px] rounded-[1.5px] bg-current transition-[width] motion-reduce:transition-none"
            :style="markerLineStyle(index)"
          />
        </span>
      </button>
    </div>
  </nav>

  <Teleport to="body">
    <div
      v-if="previewOpen && previewItem"
      :id="`${previewItem.id}-preview`"
      ref="tooltip"
      role="tooltip"
      class="pointer-events-none fixed z-[170] w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[14px] border border-chrome-border bg-chrome-raised/98 px-4 py-3.5 text-[14px] leading-[1.55] text-surface shadow-[0_16px_42px_rgb(0_0_0/0.16),0_3px_10px_rgb(0_0_0/0.07),inset_0_1px_0_rgb(255_255_255/0.7)] ring-1 ring-black/5 backdrop-blur-xl animate-in fade-in slide-in-from-left-1 zoom-in-95 duration-150 motion-reduce:animate-none"
      :style="tooltipStyle"
      data-test-id="ai-conversation-chapter-tooltip"
    >
      <div class="truncate text-[15px] leading-5 font-semibold tracking-[-0.01em]">
        {{ previewItem.prompt }}
      </div>
      <div
        v-if="previewItem.response"
        class="chapter-preview-markdown mt-2.5 text-muted/90"
        data-test-id="ai-conversation-chapter-response"
      >
        <AiMarkdown :content="previewItem.response" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
:deep(.chapter-preview-markdown) {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

:deep(.chapter-preview-markdown > *) {
  display: inline;
  margin: 0 !important;
  font: inherit !important;
}

:deep(.chapter-preview-markdown > * + *)::before {
  content: '\A\A';
  white-space: pre;
}

:deep(.chapter-preview-markdown code) {
  font: inherit;
}
</style>
