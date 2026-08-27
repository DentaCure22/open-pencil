<script setup lang="ts">
import { HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from 'reka-ui'
import { computed, ref, watch, type Component } from 'vue'
import IconCode from '~icons/lucide/code-2'
import IconCopyPlus from '~icons/lucide/copy-plus'
import IconLaptop from '~icons/lucide/laptop'
import IconLoaderCircle from '~icons/lucide/loader-circle'
import IconMaximize2 from '~icons/lucide/maximize-2'
import IconMinimize2 from '~icons/lucide/minimize-2'
import IconMonitor from '~icons/lucide/monitor'
import IconPanelRightOpen from '~icons/lucide/panel-right-open'
import IconRefreshCw from '~icons/lucide/refresh-cw'
import IconScanSearch from '~icons/lucide/scan-search'
import IconSmartphone from '~icons/lucide/smartphone'
import IconMoon from '~icons/lucide/moon'
import IconSun from '~icons/lucide/sun'
import IconSunMoon from '~icons/lucide/sun-moon'
import IconTablet from '~icons/lucide/tablet'

import { useSceneComputed } from '@open-pencil/vue'
import type { CodeObjectThemePreference } from '@open-pencil/core/code-object'

import {
  readLocalAppStatus,
  startLocalApp,
  type LocalAppStatus
} from '@/app/code-object/local-app-launcher'
import { fullFrameCodeObjectId, toggleCodeObjectFullFrame } from '@/app/code-object/full-frame'
import { codeObjectDocument, isCodeObjectFrame } from '@/app/code-object/model'
import {
  applyCodeObjectThemePreference,
  applyCodeObjectViewportPreset,
  CODE_OBJECT_VIEWPORT_PRESETS,
  codeObjectThemePreference,
  codeObjectViewportPresetId,
  type CodeObjectViewportPresetId
} from '@/app/code-object/transform'
import { useEditorStore } from '@/app/editor/active-store'
import { openAgentRightPanel } from '@/app/agent-chat/right-panel'
import { IconlyPlay as IconPlay } from '@/components/icons/iconly'
import { appMenuShortcutLabel } from '@/app/shell/menu/shortcut'
import {
  clearLiveInspectorSelection,
  enterLiveInspectorContainerSelection,
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorInteractionMode,
  liveInspectorStatus,
  reloadLiveInspectorFrame,
  selectLiveInspectorNode,
  selectedLiveInspectorNode,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
import { toast } from '@/app/shell/ui'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Tip from '@/components/ui/Tip.vue'
import { menuContent } from '@/components/ui/menu'

const store = useEditorStore()
const toolsOpen = ref(false)
const localAppStatus = ref<LocalAppStatus | null>(null)
let localAppStatusRequest = 0

const selectedObject = useSceneComputed(() => {
  if (store.state.selectedIds.size !== 1) return null
  const [selectedId] = store.state.selectedIds
  return selectedId ? (store.graph.getNode(selectedId) ?? null) : null
})
const selectedCodeObject = computed(() =>
  isCodeObjectFrame(selectedObject.value) ? selectedObject.value : null
)

const activePresetId = computed(() => codeObjectViewportPresetId(selectedCodeObject.value))
const activeThemePreference = computed(() => codeObjectThemePreference(selectedCodeObject.value))

const selectedSmylrProductionFrame = computed(() => {
  const frame = selectedCodeObject.value
  return isSmylrProductionAppCodeObjectFrame(frame) ? frame : null
})

const selectedAppLaunch = computed(() => {
  const document = codeObjectDocument(selectedSmylrProductionFrame.value)
  return document?.component === 'smylr-production-app' ? document.launch : null
})

const startAppPending = computed(() => localAppStatus.value?.state === 'starting')

const appControlLabel = computed(() => {
  const appLabel = localAppStatus.value?.label ?? 'app'
  const script = selectedAppLaunch.value?.startScript
  if (startAppPending.value) return `Starting ${appLabel}`
  if (localAppStatus.value?.state === 'running') return `Refresh ${appLabel}`
  return script ? `Run ${appLabel} · ${script}` : `Run ${appLabel}`
})

const appControlIcon = computed(() =>
  localAppStatus.value?.state === 'running' ? IconRefreshCw : IconPlay
)

const liveContainerModeActive = computed(() => {
  const frame = selectedSmylrProductionFrame.value
  return (
    Boolean(frame) &&
    liveInspectorActiveFrameId.value === frame?.id &&
    liveInspectorInteractionMode.value === 'select'
  )
})
const liveContainerToolLabel = computed(
  () =>
    `${liveContainerModeActive.value ? 'Stop selecting containers' : 'Select containers'} (${appMenuShortcutLabel('copy')})`
)

const selectedAppFullFrame = computed(
  () => fullFrameCodeObjectId.value === selectedSmylrProductionFrame.value?.id
)

const viewportIcons = {
  desktop: IconMonitor,
  laptop: IconLaptop,
  phone: IconSmartphone,
  tablet: IconTablet
} satisfies Record<CodeObjectViewportPresetId, Component>

const appearanceOptions = [
  { icon: IconSunMoon, label: 'Follow system appearance', preference: 'system' },
  { icon: IconSun, label: 'Use light appearance', preference: 'light' },
  { icon: IconMoon, label: 'Use dark appearance', preference: 'dark' }
] as const satisfies ReadonlyArray<{
  icon: Component
  label: string
  preference: CodeObjectThemePreference
}>

function setAppearancePreference(preference: CodeObjectThemePreference) {
  const frame = selectedCodeObject.value
  if (!frame || !applyCodeObjectThemePreference(store, frame.id, preference)) return
  store.select([frame.id])
  toolsOpen.value = false
}

function resizeViewport(presetId: CodeObjectViewportPresetId) {
  const frame = selectedCodeObject.value
  if (!frame || !applyCodeObjectViewportPreset(store, frame.id, presetId)) return
  store.select([frame.id])
  toolsOpen.value = false
}

function duplicateObject() {
  const frame = selectedCodeObject.value
  if (!frame) return
  store.select([frame.id])
  store.duplicateSelected()
  const [duplicateId] = store.state.selectedIds
  const duplicate = duplicateId ? store.graph.getNode(duplicateId) : null
  if (duplicateId && isSmylrProductionAppCodeObjectFrame(duplicate)) {
    setLiveInspectorActiveFrame(duplicateId)
    setLiveInspectorInteractionMode('frame')
  }
  toolsOpen.value = false
  toast.info('Code Object duplicated')
}

function openSelectedObject() {
  const object = selectedObject.value
  if (object) openAgentRightPanel('object', { objectId: object.id })
}

async function refreshLocalAppStatus(launcherId: string) {
  const request = ++localAppStatusRequest
  try {
    const status = await readLocalAppStatus(launcherId)
    if (request !== localAppStatusRequest) return
    localAppStatus.value = status
  } catch {
    if (request !== localAppStatusRequest) return
    localAppStatus.value = null
  }
}

async function startSelectedApp() {
  const launch = selectedAppLaunch.value
  if (!launch || startAppPending.value) return
  localAppStatus.value = {
    appId: launch.launcherId,
    label: 'App',
    startScript: launch.startScript,
    state: 'starting'
  }
  try {
    const receipt = await startLocalApp(launch.launcherId)
    await refreshLocalAppStatus(launch.launcherId)
    if (localAppStatus.value?.state === 'running') {
      reloadLiveInspectorFrame()
      toast.info(`${receipt.label} started`)
      return
    }
    toast.info(`${receipt.label} is starting`)
  } catch (error) {
    await refreshLocalAppStatus(launch.launcherId)
    toast.error(error instanceof Error ? error.message : 'Could not start app')
  }
}

async function runOrRefreshSelectedApp() {
  const frame = selectedSmylrProductionFrame.value
  if (!frame || startAppPending.value) return
  setLiveInspectorActiveFrame(frame.id)
  if (localAppStatus.value?.state === 'running') {
    reloadLiveInspectorFrame()
    toast.info(`${localAppStatus.value.label} refreshed`)
    return
  }
  await startSelectedApp()
}

function toggleLiveContainerMode() {
  const frame = selectedSmylrProductionFrame.value
  if (!frame) return
  if (liveContainerModeActive.value) {
    clearLiveInspectorSelection()
    setLiveInspectorInteractionMode('frame')
    return
  }

  enterLiveInspectorContainerSelection(frame.id)
}

function toggleSelectedAppFullFrame() {
  const frame = selectedSmylrProductionFrame.value
  if (!frame) return
  store.select([frame.id])
  setLiveInspectorActiveFrame(frame.id)
  const opened = toggleCodeObjectFullFrame(frame.id)
  if (opened) setLiveInspectorInteractionMode('interact')
  toolsOpen.value = false
}

watch(
  [selectedAppLaunch, liveInspectorStatus],
  ([launch, inspectorStatus], previous) => {
    if (!launch) {
      localAppStatusRequest += 1
      localAppStatus.value = null
      return
    }
    const previousLaunch = previous?.[0]
    if (previousLaunch?.launcherId === launch.launcherId && inspectorStatus !== 'unavailable') {
      return
    }
    void refreshLocalAppStatus(launch.launcherId)
  },
  { immediate: true }
)

watch(liveInspectorDocument, (document) => {
  if (liveContainerModeActive.value && document?.tree.id && !selectedLiveInspectorNode.value) {
    selectLiveInspectorNode(document.tree.id)
  }
})

watch(selectedSmylrProductionFrame, (frame, previousFrame) => {
  if (
    frame ||
    !previousFrame ||
    liveInspectorActiveFrameId.value !== previousFrame.id ||
    liveInspectorInteractionMode.value !== 'select'
  ) {
    return
  }
  clearLiveInspectorSelection()
  setLiveInspectorInteractionMode('frame')
})
</script>

<template>
  <Tip v-if="selectedObject" label="Open in Object panel" side="right">
    <ToolButton
      :icon="IconPanelRightOpen"
      label="Open in Object panel"
      variant="utility"
      data-test-id="selection-open-object"
      @click="openSelectedObject"
    />
  </Tip>
  <template v-if="selectedCodeObject">
    <span class="my-0.5 h-px w-6 self-center bg-border" aria-hidden="true" />
    <HoverCardRoot
      v-model:open="toolsOpen"
      :open-delay="80"
      :close-delay="160"
      :enable-touch="true"
    >
      <div
        class="flex size-8 items-center justify-center"
        data-selection-context="code-object"
        data-test-id="selection-context-trigger"
      >
        <HoverCardTrigger as-child>
          <ToolButton :icon="IconCode" label="Code Object tools" class="text-component" />
        </HoverCardTrigger>
      </div>

      <HoverCardPortal>
        <HoverCardContent
          side="right"
          :side-offset="8"
          align="center"
          :class="
            menuContent({
              class:
                'flex origin-left items-center gap-0.5 rounded-xl data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-left-1 data-[state=open]:zoom-in-95 motion-reduce:animate-none'
            })
          "
          data-test-id="selection-context-tools"
        >
          <span class="px-1.5 text-[11px] font-medium whitespace-nowrap text-surface">
            Code Object
          </span>
          <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <IconButton
            v-if="selectedSmylrProductionFrame"
            :label="selectedAppFullFrame ? 'Exit Full Frame' : 'Open Full Frame'"
            side="top"
            class="size-8 rounded-lg"
            data-test-id="code-object-full-frame"
            :aria-pressed="selectedAppFullFrame"
            @click="toggleSelectedAppFullFrame"
          >
            <IconMinimize2 v-if="selectedAppFullFrame" class="size-4" />
            <IconMaximize2 v-else class="size-4" />
          </IconButton>

          <span
            v-if="selectedSmylrProductionFrame"
            class="mx-0.5 h-5 w-px bg-border"
            aria-hidden="true"
          />
          <IconButton
            v-for="option in appearanceOptions"
            :key="option.preference"
            :active="activeThemePreference === option.preference"
            :label="option.label"
            side="top"
            class="size-8 rounded-lg aria-pressed:bg-accent aria-pressed:text-white"
            :data-test-id="`code-object-theme-${option.preference}`"
            @click="setAppearancePreference(option.preference)"
          >
            <component :is="option.icon" class="size-4" />
          </IconButton>

          <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <IconButton
            v-for="preset in CODE_OBJECT_VIEWPORT_PRESETS"
            :key="preset.id"
            :active="activePresetId === preset.id"
            :label="`${preset.label} · ${preset.width} × ${preset.height}`"
            side="top"
            class="size-8 rounded-lg aria-pressed:bg-accent aria-pressed:text-white"
            :data-test-id="`code-object-viewport-${preset.id}`"
            @click="resizeViewport(preset.id)"
          >
            <component :is="viewportIcons[preset.id]" class="size-4" />
          </IconButton>

          <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <IconButton
            label="Duplicate Code Object"
            side="top"
            class="size-8 rounded-lg"
            data-test-id="code-object-duplicate"
            @click="duplicateObject"
          >
            <IconCopyPlus class="size-4" />
          </IconButton>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCardRoot>
    <Tip v-if="selectedAppLaunch" :label="appControlLabel" side="right">
      <ToolButton
        :icon="startAppPending ? IconLoaderCircle : appControlIcon"
        :label="appControlLabel"
        variant="utility"
        data-test-id="trusted-web-app-run-refresh"
        @click="runOrRefreshSelectedApp"
      />
    </Tip>
    <Tip v-if="selectedSmylrProductionFrame" :label="liveContainerToolLabel" side="right">
      <ToolButton
        :icon="IconScanSearch"
        :label="liveContainerToolLabel"
        variant="utility"
        :active="liveContainerModeActive"
        data-test-id="smylr-containers-tool"
        :aria-pressed="liveContainerModeActive"
        @click="toggleLiveContainerMode"
      />
    </Tip>
  </template>
</template>
