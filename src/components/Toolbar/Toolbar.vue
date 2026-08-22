<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from 'vue'

import DesktopToolbar from '@/components/Toolbar/DesktopToolbar.vue'
import { useToolbarActions } from '@/components/Toolbar/actions'
import { useActionToast } from '@/app/shell/toast/action'
import { showAgentChatsPanel } from '@/app/agent-chat/panel'
import { useEditorStore } from '@/app/editor/active-store'
import { toolIcons } from '@/app/editor/icons'
import { narratedTraceAnnotationTool, setNarratedTraceAnnotationTool } from '@/app/narrated-trace'
import { useMenuUI } from '@/components/ui/menu'
import {
  ToolbarRoot,
  useEditorCommands,
  useI18n,
  useToolbarState,
  useViewportKind
} from '@open-pencil/vue'

import type { Tool } from '@open-pencil/vue'
import type { ToolbarActionItem } from '@/components/Toolbar/types'

const MobileToolbar = defineAsyncComponent(() => import('@/components/Toolbar/MobileToolbar.vue'))

const {
  embedded = false,
  sidebarOpen = true,
  sidebarTabOnly = false
} = defineProps<{
  embedded?: boolean
  sidebarOpen?: boolean
  sidebarTabOnly?: boolean
}>()
const emit = defineEmits<{ closeSidebar: []; openSidebar: [] }>()

const store = useEditorStore()
const { isMobile } = useViewportKind()
const { getCommand } = useEditorCommands()
const { showActionToast } = useActionToast()
const { menu, tools: toolTexts } = useI18n()

const toolLabels = computed<Record<Tool, string>>(() => ({
  SELECT: toolTexts.value.move,
  FRAME: toolTexts.value.frame,
  SECTION: toolTexts.value.section,
  RECTANGLE: toolTexts.value.rectangle,
  ELLIPSE: toolTexts.value.ellipse,
  LINE: toolTexts.value.line,
  POLYGON: toolTexts.value.polygon,
  STAR: toolTexts.value.star,
  PEN: toolTexts.value.pen,
  TEXT: toolTexts.value.text,
  HAND: toolTexts.value.hand
}))

const toolShortcuts: Record<Tool, string> = {
  SELECT: 'V',
  FRAME: 'F',
  SECTION: 'S',
  RECTANGLE: 'R',
  ELLIPSE: 'O',
  LINE: 'L',
  POLYGON: '',
  STAR: '',
  PEN: 'P',
  TEXT: 'T',
  HAND: 'H'
}

const flyoutMenuCls = useMenuUI({ content: 'min-w-32' })
const toolbarUi = { flyoutContent: flyoutMenuCls.content }
const { editActions, arrangeActions } = useToolbarActions({ store, getCommand, menu })

const { mobileCategory, slideDirection, hasPrev, hasNext, goPrev, goNext } = useToolbarState()

watch(
  () => store.state.activeTool,
  () => {
    if (narratedTraceAnnotationTool.value !== 'none') setNarratedTraceAnnotationTool('none')
  },
  { flush: 'sync' }
)

function onActionTap(item: ToolbarActionItem) {
  item.action()
  showActionToast(item.label)
}

function openChats() {
  showAgentChatsPanel()
  emit('openSidebar')
}
</script>

<template>
  <ToolbarRoot v-slot="{ tools, activeTool, actions }">
    <DesktopToolbar
      v-if="!isMobile"
      :sidebar-open="sidebarOpen"
      :embedded="embedded"
      :tools="tools"
      :sidebar-tab-only="sidebarTabOnly"
      :active-tool="activeTool"
      :tool-icons="toolIcons"
      :tool-labels="toolLabels"
      :tool-shortcuts="toolShortcuts"
      :ui="toolbarUi"
      @set-tool="actions.setTool"
      @close-sidebar="emit('closeSidebar')"
      @open-sidebar="emit('openSidebar')"
      @open-chats="openChats"
    />

    <MobileToolbar
      v-else
      :tools="tools"
      :active-tool="activeTool"
      :tool-icons="toolIcons"
      :tool-labels="toolLabels"
      :tool-shortcuts="toolShortcuts"
      :ui="toolbarUi"
      :mobile-category="mobileCategory"
      :slide-direction="slideDirection"
      :has-prev="hasPrev"
      :has-next="hasNext"
      :edit-actions="editActions"
      :arrange-actions="arrangeActions"
      @set-tool="actions.setTool"
      @prev="goPrev"
      @next="goNext"
      @action="onActionTap"
    />
  </ToolbarRoot>
</template>
