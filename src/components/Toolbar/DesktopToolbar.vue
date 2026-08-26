<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { AnimatePresence, motion } from 'motion-v'
import { ToolbarRoot as RekaToolbarRoot } from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'

import Tip from '@/components/ui/Tip.vue'
import CollabPanel from '@/components/CollabPanel/CollabPanel.vue'
import AppMenu from '@/components/Shell/AppMenu.vue'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import ToolFlyout from '@/components/Toolbar/ToolFlyout.vue'
import SelectionToolControls from '@/components/Toolbar/SelectionToolControls.vue'
import WorkspaceButton from '@/components/Toolbar/WorkspaceButton.vue'
import BrowserInspectorToolbarControl from '@/components/browser-inspector/BrowserInspectorToolbarControl.vue'
import ContextCommentToolbarControl from '@/components/context-comment/ContextCommentToolbarControl.vue'
import { IconlyChat } from '@/components/icons/iconly'
import TraceAnnotationControls from '@/components/narrated-trace/TraceAnnotationControls.vue'
import { narratedTraceAnnotationTool, setNarratedTraceAnnotationTool } from '@/app/narrated-trace'
import { useBottomToolbarBounds } from '@/app/shell/bottom-toolbar-bounds'
import { toolbarToolTestId, ToolbarItem } from '@open-pencil/vue'

import type { Tool } from '@open-pencil/vue'
import type { EditorToolDef } from '@open-pencil/core/editor'
import type { ToolbarUi, ToolIconMap, ToolLabels } from '@/components/Toolbar/types'

const {
  tools,
  activeTool,
  toolIcons,
  toolLabels,
  toolShortcuts,
  ui,
  embedded = false,
  sidebarOpen = true,
  sidebarTabOnly = false
} = defineProps<{
  tools: EditorToolDef[]
  activeTool: Tool
  toolIcons: ToolIconMap
  toolLabels: ToolLabels
  toolShortcuts: Record<Tool, string>
  ui?: ToolbarUi
  embedded?: boolean
  sidebarOpen?: boolean
  sidebarTabOnly?: boolean
}>()

const emit = defineEmits<{
  closeSidebar: []
  openChats: []
  openSidebar: []
  setTool: [tool: Tool]
}>()

const reducedMotion = usePreferredReducedMotion()
const toolbarScrollViewportRef = ref<HTMLElement | null>(null)
const {
  horizontalInsets: toolbarHorizontalInsets,
  horizontalStyle: toolbarHorizontalStyle,
  queueRefresh: queueToolbarBoundsRefresh
} = useBottomToolbarBounds(() => embedded)

function scrollToolbarTools(event: WheelEvent) {
  const viewport = event.currentTarget
  if (!(viewport instanceof HTMLElement) || viewport.scrollWidth <= viewport.clientWidth) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return
  viewport.scrollLeft += delta
  event.preventDefault()
}

watch(
  () => sidebarOpen,
  () => void nextTick(queueToolbarBoundsRefresh),
  { flush: 'post' }
)

watch(
  () => activeTool,
  () => {
    if (embedded) return
    void nextTick(() => {
      toolbarScrollViewportRef.value
        ?.querySelector<HTMLElement>('[aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  },
  { flush: 'post' }
)

function isActive(tool: EditorToolDef) {
  if (narratedTraceAnnotationTool.value !== 'none') return false
  return tool.key === activeTool || (tool.flyout?.includes(activeTool) ?? false)
}

const activeToolSlot = computed(() => {
  if (narratedTraceAnnotationTool.value === 'ink') return tools.length
  if (narratedTraceAnnotationTool.value === 'focus') return tools.length + 1
  return tools.findIndex(isActive)
})

const activeIndicatorTool = computed(() => {
  if (narratedTraceAnnotationTool.value === 'ink') return 'TRACE_INK'
  if (narratedTraceAnnotationTool.value === 'focus') return 'TRACE_FOCUS'
  return activeTool
})

const activeIndicatorAnimation = computed(() => ({
  opacity: activeToolSlot.value >= 0 ? 1 : 0,
  ...(embedded
    ? { y: Math.max(activeToolSlot.value, 0) * 34 }
    : { x: Math.max(activeToolSlot.value, 0) * 34 })
}))

const activeIndicatorTransition = computed(() =>
  reducedMotion.value === 'reduce'
    ? { duration: 0 }
    : {
        opacity: { duration: 0.12 },
        x: { damping: 34, mass: 0.62, stiffness: 560, type: 'spring' },
        y: { damping: 34, mass: 0.62, stiffness: 560, type: 'spring' }
      }
)

const activeIndicatorStretch = computed(() => {
  if (reducedMotion.value === 'reduce') {
    return embedded ? { scaleY: 1 } : { scaleX: 1 }
  }
  return embedded ? { scaleY: [1, 1.42, 1] } : { scaleX: [1, 1.42, 1] }
})

function selectEditorTool(tool: Tool) {
  setNarratedTraceAnnotationTool('none')
  emit('setTool', tool)
}

function toggleSidebar() {
  if (sidebarOpen) emit('closeSidebar')
  else emit('openSidebar')
}
</script>

<template>
  <div
    :data-test-id="sidebarTabOnly ? 'sidebar-toggle-motion' : 'toolbar-motion'"
    :data-sidebar-open="sidebarOpen"
    :data-sidebar-integrated="embedded ? 'true' : 'false'"
    :data-sidebar-tab-only="sidebarTabOnly ? 'true' : 'false'"
    :data-toolbar-orientation="embedded ? 'vertical' : 'horizontal'"
    :data-toolbar-left-inset="embedded ? undefined : toolbarHorizontalInsets.left"
    :data-toolbar-right-inset="embedded ? undefined : toolbarHorizontalInsets.right"
    :style="toolbarHorizontalStyle"
    class="z-30 flex shrink-0 items-center justify-center"
    :class="[
      sidebarTabOnly && sidebarOpen ? 'pointer-events-none' : 'pointer-events-auto',
      embedded
        ? sidebarTabOnly
          ? 'absolute top-1/2 left-0 h-11 w-7 -translate-y-1/2'
          : [sidebarOpen ? 'self-stretch bg-chrome' : 'h-auto', 'w-11']
        : 'absolute bottom-3 min-w-0'
    ]"
  >
    <RekaToolbarRoot as-child :orientation="embedded ? 'vertical' : 'horizontal'" loop>
      <div
        :data-test-id="sidebarTabOnly ? 'sidebar-toggle-toolbar' : 'toolbar'"
        :aria-label="sidebarTabOnly ? 'Sidebar' : 'Editor tools'"
        class="relative flex items-center gap-0.5"
        :class="
          embedded
            ? [
                sidebarTabOnly ? 'h-11' : sidebarOpen ? 'h-full justify-center' : 'h-auto',
                sidebarTabOnly ? 'w-full p-0' : 'w-full flex-col px-1 py-2'
              ]
            : 'border-chrome-border bg-chrome shadow-chrome w-fit max-w-full min-w-0 flex-row overflow-hidden rounded-[14px] border p-1 backdrop-blur-2xl'
        "
      >
        <Tip
          v-if="embedded && (!sidebarTabOnly || !sidebarOpen)"
          :label="sidebarOpen ? 'Close sidebar' : 'Open sidebar'"
          side="right"
        >
          <button
            type="button"
            :data-test-id="sidebarOpen ? 'close-layers-panel' : 'open-layers-panel'"
            :aria-label="sidebarOpen ? 'Close sidebar' : 'Open sidebar'"
            class="pointer-events-auto absolute z-20 flex shrink-0 cursor-pointer items-center justify-center text-muted transition-colors hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/35"
            :class="
              sidebarTabOnly
                ? 'inset-0 h-11 w-7 rounded-r-[10px] border-y border-r border-chrome-border hover:bg-hover/70 focus-visible:ring-inset'
                : 'top-2 left-1.5 size-8 rounded-full hover:bg-hover'
            "
            @click="toggleSidebar"
          >
            <icon-lucide-panel-left-close v-if="sidebarOpen" class="size-4" />
            <icon-lucide-panel-left-open v-else class="size-4 stroke-[1.7]" />
          </button>
        </Tip>
        <span
          v-if="embedded && !sidebarTabOnly"
          class="mb-0.5 size-8 shrink-0"
          aria-hidden="true"
        />
        <div
          v-if="!sidebarTabOnly"
          ref="toolbarScrollViewportRef"
          data-test-id="toolbar-scroll-viewport"
          class="scrollbar-none min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x"
          :class="embedded ? 'overflow-visible' : ''"
          @wheel.stop="scrollToolbarTools"
        >
          <div
            data-test-id="toolbar-scroll-track"
            class="flex w-max items-center gap-0.5"
            :class="embedded ? 'flex-col' : 'flex-row'"
          >
            <div
              class="relative flex items-center gap-0.5"
              :class="embedded ? 'flex-col' : 'flex-row'"
              data-test-id="toolbar-tool-stack"
            >
              <AnimatePresence :initial="false">
                <motion.span
                  v-if="activeToolSlot >= 0"
                  key="active-tool-indicator"
                  aria-hidden="true"
                  class="pointer-events-none absolute top-0 left-0 size-8"
                  data-test-id="toolbar-active-indicator"
                  :data-active-slot="activeToolSlot"
                  :data-active-tool="activeIndicatorTool"
                  :initial="false"
                  :animate="activeIndicatorAnimation"
                  :exit="{ opacity: 0, scale: 0.82 }"
                  :transition="activeIndicatorTransition"
                >
                  <motion.span
                    :key="activeIndicatorTool"
                    class="absolute inset-0 origin-center rounded-full bg-accent shadow-sm ring-1 ring-accent/40"
                    data-test-id="toolbar-active-indicator-bubble"
                    :initial="false"
                    :animate="activeIndicatorStretch"
                    :transition="{
                      duration: reducedMotion === 'reduce' ? 0 : 0.28,
                      times: [0, 0.46, 1]
                    }"
                  />
                </motion.span>
              </AnimatePresence>

              <template v-for="tool in tools" :key="tool.key">
                <ToolFlyout
                  v-if="tool.flyout && tool.flyout.length > 1"
                  :tool="tool"
                  :active-tool="activeTool"
                  :tool-icons="toolIcons"
                  :tool-labels="toolLabels"
                  :tool-shortcuts="toolShortcuts"
                  :ui="ui"
                  :suppress-active="narratedTraceAnnotationTool !== 'none'"
                  :side="embedded ? 'right' : 'top'"
                  @select="selectEditorTool"
                />

                <ToolbarItem v-else :tool="tool.key">
                  <Tip
                    :label="`${toolLabels[tool.key]} (${tool.shortcut})`"
                    :side="embedded ? 'right' : 'top'"
                  >
                    <ToolButton
                      :data-test-id="toolbarToolTestId(tool.key)"
                      :icon="toolIcons[tool.key]"
                      :label="toolLabels[tool.key]"
                      :active="isActive(tool)"
                      :pressed="isActive(tool)"
                      @click="selectEditorTool(tool.key)"
                    />
                  </Tip>
                </ToolbarItem>
              </template>
              <TraceAnnotationControls :orientation="embedded ? 'vertical' : 'horizontal'" />
              <ContextCommentToolbarControl :side="embedded ? 'right' : 'top'" />
              <BrowserInspectorToolbarControl :side="embedded ? 'right' : 'top'" />
              <Tip label="Chats" :side="embedded ? 'right' : 'top'">
                <ToolButton
                  :icon="IconlyChat"
                  label="Chats"
                  variant="utility"
                  data-test-id="toolbar-chats"
                  @click="emit('openChats')"
                />
              </Tip>
            </div>
            <SelectionToolControls />
            <span
              :class="embedded ? 'my-0.5 h-px w-6' : 'mx-0.5 h-6 w-px'"
              class="shrink-0 self-center bg-border"
              aria-hidden="true"
            />
            <WorkspaceButton />
            <span
              :class="embedded ? 'my-0.5 h-px w-6' : 'mx-0.5 h-6 w-px'"
              class="shrink-0 self-center bg-border"
              aria-hidden="true"
            />
            <CollabPanel />
            <span v-if="embedded" class="mt-0.5 size-8 shrink-0" aria-hidden="true" />
            <div :class="embedded ? 'absolute bottom-2 left-1.5' : 'relative'" class="z-20">
              <AppMenu :side="embedded ? 'right' : 'top'" />
            </div>
          </div>
        </div>
      </div>
    </RekaToolbarRoot>
  </div>
</template>
