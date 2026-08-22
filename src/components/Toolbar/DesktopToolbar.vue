<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { AnimatePresence, motion } from 'motion-v'
import { ToolbarRoot as RekaToolbarRoot } from 'reka-ui'
import { computed } from 'vue'

import Tip from '@/components/ui/Tip.vue'
import CollabPanel from '@/components/CollabPanel/CollabPanel.vue'
import AppMenu from '@/components/Shell/AppMenu.vue'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import ToolFlyout from '@/components/Toolbar/ToolFlyout.vue'
import SelectionToolControls from '@/components/Toolbar/SelectionToolControls.vue'
import WorkspaceButton from '@/components/Toolbar/WorkspaceButton.vue'
import ContextCommentToolbarControl from '@/components/context-comment/ContextCommentToolbarControl.vue'
import TraceAnnotationControls from '@/components/narrated-trace/TraceAnnotationControls.vue'
import { narratedTraceAnnotationTool, setNarratedTraceAnnotationTool } from '@/app/narrated-trace'
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
  openSidebar: []
  setTool: [tool: Tool]
}>()

const reducedMotion = usePreferredReducedMotion()

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
  y: Math.max(activeToolSlot.value, 0) * 34
}))

const activeIndicatorTransition = computed(() =>
  reducedMotion.value === 'reduce'
    ? { duration: 0 }
    : {
        opacity: { duration: 0.12 },
        y: { damping: 34, mass: 0.62, stiffness: 560, type: 'spring' }
      }
)

const activeIndicatorStretch = computed(() =>
  reducedMotion.value === 'reduce' ? { scaleY: 1 } : { scaleY: [1, 1.42, 1] }
)

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
    data-test-id="toolbar-motion"
    :data-sidebar-open="sidebarOpen"
    :data-sidebar-integrated="embedded ? 'true' : 'false'"
    :data-sidebar-tab-only="sidebarTabOnly ? 'true' : 'false'"
    data-toolbar-orientation="vertical"
    class="pointer-events-auto z-30 flex shrink-0 items-center justify-center"
    :class="
      embedded
        ? [sidebarOpen ? 'self-stretch bg-chrome' : sidebarTabOnly ? 'h-11' : 'h-auto', 'w-11']
        : 'absolute top-1/2 left-3 -translate-y-1/2'
    "
  >
    <RekaToolbarRoot as-child orientation="vertical" loop>
      <div
        data-test-id="toolbar"
        aria-label="Editor tools"
        class="relative flex flex-col items-center gap-0.5"
        :class="
          embedded
            ? [
                sidebarOpen ? 'h-full justify-center' : sidebarTabOnly ? 'h-11' : 'h-auto',
                sidebarTabOnly ? 'w-full p-0' : 'w-full px-1 py-2'
              ]
            : 'border-chrome-border bg-chrome shadow-chrome rounded-[14px] border p-1 backdrop-blur-2xl'
        "
      >
        <Tip
          v-if="embedded"
          :label="
            sidebarOpen
              ? 'Close sidebar'
              : sidebarTabOnly
                ? 'Open sidebar · drag the grip to move'
                : 'Open sidebar'
          "
          side="right"
        >
          <button
            type="button"
            :data-test-id="sidebarOpen ? 'close-layers-panel' : 'open-layers-panel'"
            :aria-label="sidebarOpen ? 'Close sidebar' : 'Open sidebar'"
            class="text-muted hover:bg-hover hover:text-surface absolute z-20 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
            :class="sidebarTabOnly ? 'top-1.5 left-2.5' : 'top-2 left-1.5'"
            @click="toggleSidebar"
          >
            <icon-lucide-panel-left-close v-if="sidebarOpen" class="size-4" />
            <icon-lucide-chevron-right v-else-if="sidebarTabOnly" class="size-4" />
            <icon-lucide-panel-left-open v-else class="size-4" />
          </button>
        </Tip>
        <span
          v-if="embedded && !sidebarTabOnly"
          class="mb-0.5 size-8 shrink-0"
          aria-hidden="true"
        />
        <div
          v-if="!sidebarTabOnly"
          class="relative flex flex-col items-center gap-0.5"
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
                class="absolute inset-0 origin-center rounded-full bg-surface shadow-sm ring-1 ring-border/60"
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
              @select="selectEditorTool"
            />

            <ToolbarItem v-else :tool="tool.key">
              <Tip :label="`${toolLabels[tool.key]} (${tool.shortcut})`" side="right">
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
          <TraceAnnotationControls />
          <ContextCommentToolbarControl />
        </div>
        <SelectionToolControls v-if="!sidebarTabOnly" />
        <span
          v-if="!sidebarTabOnly"
          class="my-0.5 h-px w-6 self-center bg-border"
          aria-hidden="true"
        />
        <WorkspaceButton v-if="!sidebarTabOnly" />
        <span
          v-if="!sidebarTabOnly"
          class="my-0.5 h-px w-6 self-center bg-border"
          aria-hidden="true"
        />
        <CollabPanel v-if="!sidebarTabOnly" />
        <span
          v-if="embedded && !sidebarTabOnly"
          class="mt-0.5 size-8 shrink-0"
          aria-hidden="true"
        />
        <div v-if="embedded && !sidebarTabOnly" class="absolute bottom-2 left-1.5 z-20">
          <AppMenu />
        </div>
      </div>
    </RekaToolbarRoot>
  </div>
</template>
