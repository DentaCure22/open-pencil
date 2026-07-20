<script setup lang="ts">
import Tip from '@/components/ui/Tip.vue'
import CollabPanel from '@/components/CollabPanel/CollabPanel.vue'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import ToolFlyout from '@/components/Toolbar/ToolFlyout.vue'
import TraceControls from '@/components/narrated-trace/TraceControls.vue'
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
  sidebarOpen = true
} = defineProps<{
  tools: EditorToolDef[]
  activeTool: Tool
  toolIcons: ToolIconMap
  toolLabels: ToolLabels
  toolShortcuts: Record<Tool, string>
  ui?: ToolbarUi
  sidebarOpen?: boolean
}>()

const emit = defineEmits<{
  setTool: [tool: Tool]
}>()

function isActive(tool: EditorToolDef) {
  if (narratedTraceAnnotationTool.value !== 'none') return false
  return tool.key === activeTool || (tool.flyout?.includes(activeTool) ?? false)
}

function activeKeyForTool(tool: EditorToolDef) {
  return tool.flyout?.includes(activeTool) ? activeTool : tool.key
}

function selectEditorTool(tool: Tool) {
  setNarratedTraceAnnotationTool('none')
  emit('setTool', tool)
}
</script>

<template>
  <div
    data-test-id="toolbar-motion"
    :data-sidebar-open="sidebarOpen"
    class="pointer-events-auto absolute top-3 left-1/2 z-30 flex -translate-x-1/2 transform-gpu items-center transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
  >
    <div
      data-test-id="toolbar"
      class="border-chrome-border bg-chrome shadow-chrome flex gap-0.5 rounded-[14px] border p-1 backdrop-blur-2xl"
    >
      <template v-for="tool in tools" :key="tool.key">
        <Tip
          v-if="tool.flyout && tool.flyout.length > 1"
          :label="`${toolLabels[activeKeyForTool(tool)]} (${tool.shortcut})`"
        >
          <ToolFlyout
            :tool="tool"
            :active-tool="activeTool"
            :tool-icons="toolIcons"
            :tool-labels="toolLabels"
            :tool-shortcuts="toolShortcuts"
            :ui="ui"
            :suppress-active="narratedTraceAnnotationTool !== 'none'"
            @select="selectEditorTool"
          />
        </Tip>

        <ToolbarItem v-else :tool="tool.key">
          <Tip :label="`${toolLabels[tool.key]} (${tool.shortcut})`">
            <ToolButton
              :data-test-id="toolbarToolTestId(tool.key)"
              :icon="toolIcons[tool.key]"
              :label="toolLabels[tool.key]"
              :active="isActive(tool)"
              @click="selectEditorTool(tool.key)"
            />
          </Tip>
        </ToolbarItem>
      </template>
      <slot name="workspace" />
      <TraceAnnotationControls />
      <TraceControls />
      <span class="mx-0.5 h-6 w-px self-center bg-border" aria-hidden="true" />
      <CollabPanel />
    </div>
  </div>
</template>
