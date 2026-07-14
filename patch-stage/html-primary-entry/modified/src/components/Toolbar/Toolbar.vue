<script setup lang="ts">
import { computed, watch } from 'vue'

import DesktopToolbar from '@/components/Toolbar/DesktopToolbar.vue'
import MobileToolbar from '@/components/Toolbar/MobileToolbar.vue'
import { useToolbarActions } from '@/components/Toolbar/actions'
import { useAIChat } from '@/app/ai/chat/use'
import { useActionToast } from '@/app/shell/toast/action'
import { useEditorStore } from '@/app/editor/active-store'
import { createStarterHtmlBoard } from '@/app/html-board/starter'
import { htmlBoardViewportInsets } from '@/app/html-board/workspace'
import { useKnowledgeWorkspaceUi } from '@/app/workspace-ui/use'
import { toolIcons } from '@/app/editor/icons'
import {
  findCurrentSmylrLiveAppFrame,
  findSmylrLiveAppFrames,
  isSmylrLiveAppFrameNode
} from '@/app/smylr-production/workspace'
import {
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { useMenuUI } from '@/components/ui/menu'
import {
  ToolbarRoot,
  useEditorCommands,
  useI18n,
  useToolbarState,
  useViewportKind
} from '@open-pencil/vue'
import WorkspaceInsertMenu, {
  type WorkspaceInsertMenuKind
} from '@/components/workspace/WorkspaceInsertMenu.vue'

import type { Tool } from '@open-pencil/vue'
import type { ToolbarActionItem } from '@/components/Toolbar/types'

const store = useEditorStore()
const workspaceUi = useKnowledgeWorkspaceUi(store)
const { isMobile } = useViewportKind()
const { getCommand } = useEditorCommands()
const { showActionToast } = useActionToast()
const { menu, tools: toolTexts } = useI18n()
const { activeTab } = useAIChat()

const toolLabels = computed<Record<Tool, string>>(() => ({
  SELECT: toolTexts.value.move,
  SMYLR_CONTAINER: 'Container',
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
  SMYLR_CONTAINER: 'C · ⌘C copy',
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

const targetLiveFrame = computed(() => {
  const frames = findSmylrLiveAppFrames(store)
  return (
    frames.find((frame) => store.state.selectedIds.has(frame.id)) ??
    frames.find((frame) => frame.id === liveInspectorActiveFrameId.value) ??
    findCurrentSmylrLiveAppFrame(store)
  )
})

const canInsertDesignArtifact = computed(() =>
  [...store.state.selectedIds].some((id) => {
    const node = store.graph.getNode(id)
    return Boolean(node && !isSmylrLiveAppFrameNode(node))
  })
)

function insertWorkspaceObject(kind: WorkspaceInsertMenuKind) {
  if (kind === 'html-board') {
    createStarterHtmlBoard(store)
    activeTab.value = 'code'
    requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
    return
  }
  void workspaceUi.insert(kind, { liveFrame: targetLiveFrame.value })
}

let syncingToolFromLiveMode = false

watch(
  () =>
    [
      store.state.activeTool,
      targetLiveFrame.value?.id ?? null,
      liveInspectorInteractionMode.value
    ] as const,
  ([tool], previous) => {
    if (syncingToolFromLiveMode) return
    const toolChanged = !previous || previous[0] !== tool
    // Mode-only changes come from frame headers, iframe shortcuts, or live
    // selection. They are authoritative and the mode->tool watcher below
    // mirrors them. Only an explicit toolbar tool change may drive mode here;
    // otherwise SELECT races a header Container click back to Interact.
    if (!toolChanged) return
    if (tool === 'SMYLR_CONTAINER') {
      const liveFrame = targetLiveFrame.value
      if (liveFrame) {
        store.select([liveFrame.id])
        setLiveInspectorActiveFrame(liveFrame.id)
      }
      if (liveInspectorInteractionMode.value !== 'select') {
        setLiveInspectorInteractionMode('select')
      }
    } else if (tool === 'SELECT' && targetLiveFrame.value) {
      const liveFrame = targetLiveFrame.value
      if (liveFrame) {
        store.select([liveFrame.id])
        setLiveInspectorActiveFrame(liveFrame.id)
      }
      if (liveInspectorInteractionMode.value !== 'interact') {
        setLiveInspectorInteractionMode('interact')
      }
    } else if (liveInspectorInteractionMode.value !== 'frame') {
      setLiveInspectorInteractionMode('frame')
    }
  },
  { immediate: true }
)

watch(
  liveInspectorInteractionMode,
  (mode) => {
    const tool = mode === 'select' ? 'SMYLR_CONTAINER' : 'SELECT'
    if (store.state.activeTool === tool) return
    syncingToolFromLiveMode = true
    store.setTool(tool)
    queueMicrotask(() => {
      syncingToolFromLiveMode = false
    })
  },
  { immediate: true }
)

function onActionTap(item: ToolbarActionItem) {
  item.action()
  showActionToast(item.label)
}
</script>

<template>
  <ToolbarRoot v-slot="{ tools, activeTool, actions }">
    <DesktopToolbar
      v-if="!isMobile"
      :tools="tools"
      :active-tool="activeTool"
      :tool-icons="toolIcons"
      :tool-labels="toolLabels"
      :tool-shortcuts="toolShortcuts"
      :ui="toolbarUi"
      @set-tool="actions.setTool"
    >
      <template #workspace>
        <WorkspaceInsertMenu
          :can-insert-design-artifact="canInsertDesignArtifact"
          :can-insert-live-app="Boolean(targetLiveFrame)"
          @insert="insertWorkspaceObject"
        />
      </template>
    </DesktopToolbar>

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
