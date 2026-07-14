<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useDebounceFn, useEventListener, useUrlSearchParams } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useViewportKind, formatShortcut, useI18n } from '@open-pencil/vue'

import { useCollab, COLLAB_KEY } from '@/app/collab/use'
import { useEditorStore } from '@/app/editor/active-store'
import { useKeyboard } from '@/app/shell/keyboard/use'
import { loadEditorLayout, saveEditorLayout } from '@/app/shell/layout-storage'
import { appMenuShortcut } from '@/app/shell/menu/shortcut'
import { openFileFromPath, useMenu } from '@/app/shell/menu/use'
import {
  removeDesignedComponentPlaceholders,
  removeStaleComputedComponentPages
} from '@/app/smylr-component-library/computed-catalog'
import {
  exitLiveInspectorPreviewMode,
  liveInspectorPreviewMode
} from '@/app/smylr-live-inspector/session'
import { liveWorkspaceItems, restoreLiveWorkspace } from '@/app/smylr-live-inspector/workspace'
import {
  restoreSmylrProductionDocument,
  saveSmylrProductionDocument
} from '@/app/smylr-production/document-state'
import {
  bindLiveFrameDeletionSync,
  clearLiveFrameTombstones,
  loadLiveFrameTombstones
} from '@/app/smylr-production/live-frame-deletion'
import {
  isApplyingSharedSmylrProductionDocument,
  refreshSharedSmylrProductionWorkspace,
  restoreSharedSmylrProductionWorkspace,
  saveSharedSmylrProductionWorkspace
} from '@/app/smylr-production/shared-document-state'
import {
  isBrowserPageReload,
  restoreSmylrProductionView,
  saveSmylrProductionView
} from '@/app/smylr-production/view-state'
import {
  hasSmylrProductionWorkspace,
  isSmylrFoundationsStale,
  openSmylrProductionWorkspace,
  refreshSmylrFoundationsBoardsInPlace,
  stampSmylrFoundationsRevision,
  switchSmylrProductionPage
} from '@/app/smylr-production/workspace'
import { createTab, activeTab, getActiveStore, tabCount } from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'
import CollabPanel from '@/components/CollabPanel/CollabPanel.vue'
import EditorCanvas from '@/components/EditorCanvas.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import MobileDrawer from '@/components/MobileDrawer.vue'
import { provideMobileHud } from '@/components/MobileHud/context'
import MobileHud from '@/components/MobileHud/MobileHud.vue'
import PropertiesPanel from '@/components/PropertiesPanel.vue'
import SafariBanner from '@/components/SafariBanner.vue'
import TabBar from '@/components/TabBar.vue'
import Toolbar from '@/components/Toolbar/Toolbar.vue'
import Tip from '@/components/ui/Tip.vue'

const route = useRoute()
const params = useUrlSearchParams('history')
const showChrome = !('no-chrome' in params)
const isSmylrProductionWorkspace = 'smylr-app' in params || 'smylr-production' in params
const requestedSmylrPageId =
  typeof params['smylr-page'] === 'string' ? params['smylr-page'] : undefined

const createdInitialTab = tabCount() === 0
const firstTab = createdInitialTab ? createTab() : (activeTab.value ?? createTab())
const store = useEditorStore()

// Start every Smylr production canvas in its primary editing mode. Browser-local
// editor state can otherwise leave one browser in Frame mode while another is
// already in Container mode, making the same board appear non-selectable.
if (isSmylrProductionWorkspace && store.state.activeTool !== 'SMYLR_CONTAINER') {
  store.setTool('SMYLR_CONTAINER')
}

const { dialogs } = useI18n()
const { isMobile } = useViewportKind()
const collab = useCollab(getActiveStore)
provide(COLLAB_KEY, collab)
provideMobileHud(collab)

const shouldRestoreSmylrView = createdInitialTab && isBrowserPageReload()
// Always restore the last local production canvas when opening ?smylr-app —
// not only on the first tab of a cold boot (HMR / remount was skipping restore).
const shouldRestoreSmylrDocument = isSmylrProductionWorkspace
let didAttemptSmylrViewRestore = false
let didAttemptSmylrDocumentRestore = false
let stopSmylrPagePersistence: (() => void) | null = null
let stopSmylrViewportPersistence: (() => void) | null = null
let stopSmylrDocumentPersistence: (() => void) | null = null
let stopSmylrDeletePersistence: (() => void) | null = null
let stopLiveFrameDeletionSync: (() => void) | null = null
let smylrDeletePersistenceQueued = false

async function restoreSmylrViewAfterRefresh(active: ReturnType<typeof getActiveStore>) {
  if (!shouldRestoreSmylrView || didAttemptSmylrViewRestore) return false
  didAttemptSmylrViewRestore = true
  return restoreSmylrProductionView(active, {
    expectedPageId: active.state.currentPageId
  })
}

async function restoreSmylrDocument(active: ReturnType<typeof getActiveStore>) {
  if (!shouldRestoreSmylrDocument || didAttemptSmylrDocumentRestore) return false
  didAttemptSmylrDocumentRestore = true
  await restoreLiveWorkspace()
  const localRestore = await restoreSmylrProductionDocument(active)
  const sharedRestore = await restoreSharedSmylrProductionWorkspace(active)
  if (sharedRestore === 'restored') return true
  return localRestore
}

async function persistSmylrDocumentNow(active: ReturnType<typeof getActiveStore>) {
  const localSaved = await saveSmylrProductionDocument(active)
  if (!isApplyingSharedSmylrProductionDocument()) {
    await saveSharedSmylrProductionWorkspace(active)
  }
  return localSaved
}

const persistSmylrView = useDebounceFn(
  () => {
    if (isSmylrProductionWorkspace) void saveSmylrProductionView(getActiveStore())
  },
  120,
  { maxWait: 1000 }
)

const persistSmylrDocument = useDebounceFn(
  () => {
    if (isSmylrProductionWorkspace) void persistSmylrDocumentNow(getActiveStore())
  },
  300,
  { maxWait: 1000 }
)

function scheduleSmylrDocumentPersistence() {
  if (isApplyingSharedSmylrProductionDocument()) return
  persistSmylrDocument()
}

function persistSmylrDocumentAfterDelete() {
  if (smylrDeletePersistenceQueued || isApplyingSharedSmylrProductionDocument()) return
  smylrDeletePersistenceQueued = true
  queueMicrotask(() => {
    smylrDeletePersistenceQueued = false
    if (isSmylrProductionWorkspace) void persistSmylrDocumentNow(getActiveStore())
  })
}

function startSmylrViewPersistence() {
  if (!isSmylrProductionWorkspace || stopSmylrPagePersistence) return
  const active = getActiveStore()
  if (!stopLiveFrameDeletionSync) {
    stopLiveFrameDeletionSync = bindLiveFrameDeletionSync(active)
  }
  stopSmylrPagePersistence = active.onEditorEvent('page:changed', persistSmylrView)
  stopSmylrViewportPersistence = active.onEditorEvent('viewport:changed', persistSmylrView)
  stopSmylrDocumentPersistence = active.onEditorEvent(
    'render:requested',
    scheduleSmylrDocumentPersistence
  )
  // Deletion must reach local + shared storage before a quick reload can restore
  // the previous graph. Coalesce child deletions into one same-turn save instead
  // of waiting for the normal 300 ms document debounce.
  stopSmylrDeletePersistence = active.onEditorEvent('node:deleted', persistSmylrDocumentAfterDelete)
  void saveSmylrProductionView(active)
  void persistSmylrDocumentNow(active)
}

useEventListener(window, 'pagehide', () => {
  if (!isSmylrProductionWorkspace) return
  const active = getActiveStore()
  void saveSmylrProductionView(active)
  void persistSmylrDocumentNow(active)
})

useEventListener(window, 'focus', () => {
  if (!isSmylrProductionWorkspace) return
  void refreshSharedSmylrProductionWorkspace(getActiveStore())
})

watch(liveWorkspaceItems, () => {
  if (!isSmylrProductionWorkspace) return
  scheduleSmylrDocumentPersistence()
})

/**
 * Seed / re-seed Smylr production canvas.
 * Re-opens when foundations builders are newer than the graph in memory
 * (after a vite rebuild + soft reload) so you don't need Cmd+Shift+R forever.
 */
async function refreshFoundationsIfStale(active: ReturnType<typeof getActiveStore>) {
  if (!isSmylrFoundationsStale(active)) return
  // Never replaceGraph the whole production canvas for a builder bump —
  // that re-seeds every live iframe and wipes deleted frames / design edits.
  const refreshed = await refreshSmylrFoundationsBoardsInPlace(active, {
    selectedPageId: requestedSmylrPageId,
    preserveViewport: true
  })
  if (!refreshed) stampSmylrFoundationsRevision(active)
  void persistSmylrDocumentNow(active)
}

async function ensureSmylrProductionWorkspace(force = false) {
  if (!isSmylrProductionWorkspace) return
  const active = getActiveStore()

  // Prefer restoring the user's last scene graph (deletes included).
  if (!force && (await restoreSmylrDocument(active))) {
    await refreshFoundationsIfStale(active)
    if (requestedSmylrPageId) await switchSmylrProductionPage(active, requestedSmylrPageId)
    await restoreSmylrViewAfterRefresh(active)
    // Re-persist post-tombstone graph so the next boot matches what the user sees.
    void persistSmylrDocumentNow(active)
    return
  }

  const initialPageId = active.state.currentPageId
  const removedDerivedPages =
    removeDesignedComponentPlaceholders(active.graph) +
    removeStaleComputedComponentPages(active.graph)
  if (removedDerivedPages > 0) active.requestRender()

  // Existing workspace in memory: keep user structure; only refresh foundations.
  if (!force && hasSmylrProductionWorkspace(active)) {
    await refreshFoundationsIfStale(active)
    if (await restoreSmylrViewAfterRefresh(active)) return
    // An explicit page/asset click during boot always wins over the URL's
    // delayed initial-page reconciliation.
    if (active.state.currentPageId !== initialPageId) return
    if (requestedSmylrPageId) {
      const switched = await switchSmylrProductionPage(active, requestedSmylrPageId)
      if (!switched) {
        // Page missing from this graph — open only that seed path as last resort.
        await openSmylrProductionWorkspace(active, {
          selectedPageId: requestedSmylrPageId
        })
      }
    }
    return
  }

  // No workspace yet, or explicit ?smylr-rebuild= force seed.
  if (active.state.currentPageId !== initialPageId && !force) return
  if (force) {
    // Explicit rebuild is the only path that clears user delete tombstones.
    clearLiveFrameTombstones()
  }
  await loadLiveFrameTombstones()
  await openSmylrProductionWorkspace(active, {
    selectedPageId: requestedSmylrPageId
  })
  await restoreSmylrViewAfterRefresh(active)
  void persistSmylrDocumentNow(active)
}

// Defer workspace open until after first paint so the canvas can init and
// dismiss the splash — never block boot on foundations graph build.
if (isSmylrProductionWorkspace) {
  onMounted(() => {
    // Bind delete hooks immediately so early deletes (before seed finishes) stick.
    const active = getActiveStore()
    if (!stopLiveFrameDeletionSync) {
      stopLiveFrameDeletionSync = bindLiveFrameDeletionSync(active)
    }
    void loadLiveFrameTombstones()
    // Double-rAF: let EditorCanvas mount + start CanvasKit before heavy graph work.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void ensureSmylrProductionWorkspace()
          .then(startSmylrViewPersistence)
          .catch((e) => console.error('[Smylr Production Workspace]', e))
      })
    })
  })
} else if (createdInitialTab && route.meta.demo && !('test' in params)) {
  onMounted(async () => {
    const { createDemoShapes } = await import('@/app/demo/document')
    createDemoShapes(firstTab.store)
  })
}

// URL page changes (and ?smylr-rebuild=1) re-seed without a hard refresh dance.
watch(
  () => [params['smylr-page'], params['smylr-rebuild']] as const,
  () => {
    if (!isSmylrProductionWorkspace) return
    const force = 'smylr-rebuild' in params
    void ensureSmylrProductionWorkspace(force).catch((e) =>
      console.error('[Smylr Production Workspace]', e)
    )
  }
)

/** In-place board update (HMR event from board files + accept deps). */
function bumpBoards(reason: string) {
  if (!isSmylrProductionWorkspace) return
  void import('@/app/smylr-production/live-reseed').then(({ scheduleSmylrLiveReseed }) => {
    return scheduleSmylrLiveReseed(getActiveStore, {
      selectedPageId: typeof params['smylr-page'] === 'string' ? params['smylr-page'] : undefined,
      reason
    })
  })
}

// Board modules fire this after self-accept so we always get the new builder.
useEventListener(window, 'smylr-foundations-hmr', () => bumpBoards('hmr-event'))

if (import.meta.hot) {
  import.meta.hot.accept(
    [
      '../app/smylr-production/create-tokens-page.ts',
      '../app/smylr-production/create-brand-page.ts',
      '../app/smylr-production/smylr-token-catalog.ts',
      '../app/smylr-production/smylr-tokens.reference.json'
    ],
    () => bumpBoards('hmr-accept')
  )
}

useHead({ title: route.meta.demo ? 'Demo' : undefined })
useKeyboard()
useMenu()

function isEditorCanvasWheelTarget(event: WheelEvent) {
  const target = event.target
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      '[data-test-id="editor-root"] canvas, [data-test-id="smylr-live-app-embed"], [data-test-id="smylr-live-frame-selection"]'
    )
  )
}

useEventListener(
  document,
  'wheel',
  (e: WheelEvent) => {
    const isHorizontalCanvasGesture =
      isEditorCanvasWheelTarget(e) && Math.abs(e.deltaX) > Math.abs(e.deltaY)
    if (e.ctrlKey || e.metaKey || isHorizontalCanvasGesture) e.preventDefault()
  },
  { passive: false }
)

function showEditorUI() {
  store.state.showUI = true
  exitLiveInspectorPreviewMode()
}

function handleEditorLayout(layout: number[]) {
  if (
    !liveInspectorPreviewMode.value &&
    showLayersPanel.value &&
    showPropertiesPanel.value &&
    layout.length === 3
  ) {
    saveEditorLayout(layout)
  }
}

watch(
  () => store.state.showUI,
  (showUI) => {
    if (!showUI || !liveInspectorPreviewMode.value) return
    showEditorUI()
  }
)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.code !== 'Escape' || !liveInspectorPreviewMode.value) return
  event.preventDefault()
  showEditorUI()
})

const automationCleanup = ref<(() => void) | null>(null)
const mcpCleanup = ref<(() => void) | null>(null)
const fileAssociationCleanup = ref<(() => void) | null>(null)
const initialEditorLayout = loadEditorLayout()
const showLayersPanel = ref(true)
const showPropertiesPanel = ref(true)

type PendingOpenFile = {
  path: string
}

async function openPendingAssociatedFiles() {
  const { invoke } = await import('@tauri-apps/api/core')
  const files = await invoke<PendingOpenFile[]>('take_pending_open')
  for (const file of files) {
    await openFileFromPath(file.path)
  }
}

async function bindAssociatedFileOpen() {
  if (!isTauri()) return
  const { listen } = await import('@tauri-apps/api/event')
  fileAssociationCleanup.value = await listen('open-associated-files', () => {
    void openPendingAssociatedFiles().catch((e) => console.error('[Open With]', e))
  })
  await openPendingAssociatedFiles()
}

async function openSmylrContainerIfRequested() {
  if ('smylr-live-clipboard' in params || 'smylr-live' in params) {
    await store.openSmylrLiveContainerClipboardDocument()
    return
  }

  if (!('smylr-sample' in params)) return
  await store.openSampleSmylrLiveContainerDocument()
}

onMounted(async () => {
  try {
    const { spawnMCPIfNeeded } = await import('@/app/automation/mcp/spawn')
    const mcp = await spawnMCPIfNeeded()
    mcpCleanup.value = mcp?.disconnect ?? null
    const tauri = isTauri()
    if (import.meta.env.DEV || tauri) {
      const { connectAutomation } = await import('@/app/automation/bridge/server')
      automationCleanup.value = connectAutomation(getActiveStore, mcp?.authToken ?? null).disconnect
    }
  } catch (e) {
    console.warn('[MCP]', e)
  }

  try {
    await bindAssociatedFileOpen()
  } catch (e) {
    console.error('[Open With]', e)
  }

  try {
    await openSmylrContainerIfRequested()
  } catch (e) {
    console.error('[Smylr Container]', e)
  }
})

onUnmounted(() => {
  stopSmylrPagePersistence?.()
  stopSmylrViewportPersistence?.()
  stopSmylrDocumentPersistence?.()
  stopSmylrDeletePersistence?.()
  stopLiveFrameDeletionSync?.()
  stopLiveFrameDeletionSync = null
  mcpCleanup.value?.()
  automationCleanup.value?.()
  fileAssociationCleanup.value?.()
})
</script>

<template>
  <div
    data-test-id="editor-root"
    class="flex h-screen w-screen flex-col"
    style="overscroll-behavior: none"
  >
    <SafariBanner />
    <TabBar />

    <!-- Desktop: full-bleed canvas under floating left/right sidebars -->
    <div
      v-if="!isMobile && showChrome && store.state.showUI"
      :key="activeTab?.id"
      class="bg-canvas relative min-h-0 flex-1 overflow-hidden"
    >
      <!--
        Canvas must fill this box (absolute + flex). flex-1 alone does nothing
        without a flex parent — that collapsed the canvas to 0 height.
      -->
      <div class="absolute inset-0 isolate z-0 flex min-h-0 min-w-0">
        <EditorCanvas />
        <Toolbar v-if="!liveInspectorPreviewMode" />
      </div>

      <!-- Floating chrome over canvas; middle is transparent + click-through -->
      <SplitterGroup
        direction="horizontal"
        class="pointer-events-none absolute inset-0 z-20 bg-transparent"
        @layout="handleEditorLayout"
      >
        <SplitterPanel
          v-if="showLayersPanel"
          id="layers"
          :default-size="initialEditorLayout[0]"
          :min-size="14"
          :max-size="34"
          class="pointer-events-auto relative flex min-h-0 flex-col bg-transparent py-3 pr-1.5 pl-3"
        >
          <div
            data-test-id="layers-shell"
            class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-white/[0.085] bg-[#15161a]/96 shadow-[0_18px_55px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-2xl [--color-accent:#9b82f3] [--color-border:#ffffff14] [--color-canvas:#15161a] [--color-component:#c7a9ff] [--color-hover:#ffffff0f] [--color-input:#0d0e11cc] [--color-muted:#999ca6] [--color-panel:#202126] [--color-surface:#f1f1f3]"
          >
            <LayersPanel @close="showLayersPanel = false" />
          </div>
        </SplitterPanel>
        <SplitterResizeHandle
          v-if="showLayersPanel"
          data-test-id="left-splitter-handle"
          class="pointer-events-auto relative z-30 w-3 cursor-col-resize bg-transparent"
        />
        <SplitterPanel
          id="canvas"
          :default-size="initialEditorLayout[1]"
          :min-size="32"
          class="pointer-events-none relative min-w-0 bg-transparent"
        />
        <SplitterResizeHandle
          v-if="showPropertiesPanel"
          data-test-id="right-splitter-handle"
          class="pointer-events-auto relative z-30 w-3 cursor-col-resize bg-transparent"
        />
        <SplitterPanel
          v-if="showPropertiesPanel"
          id="properties"
          :default-size="initialEditorLayout[2]"
          :min-size="14"
          :max-size="34"
          class="pointer-events-auto relative flex min-h-0 flex-col bg-transparent py-3 pr-3 pl-1.5"
        >
          <div
            class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-white/[0.085] bg-[#15161a]/96 shadow-[0_18px_55px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-2xl [--color-accent:#9b82f3] [--color-border:#ffffff14] [--color-component:#c7a9ff] [--color-hover:#ffffff0f] [--color-input:#0d0e11cc] [--color-muted:#999ca6] [--color-panel:#202126] [--color-surface:#f1f1f3]"
          >
            <div
              data-test-id="properties-shell-header"
              class="flex min-h-12 shrink-0 items-center gap-2 border-b border-white/[0.055] px-3 py-2"
            >
              <Tip label="Close inspector">
                <button
                  type="button"
                  data-test-id="close-properties-panel"
                  aria-label="Close inspector"
                  class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted/80 transition-all hover:bg-hover hover:text-surface"
                  @click="showPropertiesPanel = false"
                >
                  <icon-lucide-panel-right-close class="size-3.5" />
                </button>
              </Tip>
              <CollabPanel />
            </div>
            <PropertiesPanel />
          </div>
        </SplitterPanel>
      </SplitterGroup>

      <Tip v-if="!showLayersPanel" label="Open layers panel">
        <button
          type="button"
          data-test-id="open-layers-panel"
          aria-label="Open layers panel"
          class="border-border bg-panel text-muted hover:bg-hover hover:text-surface absolute top-3 left-3 z-30 flex size-8 cursor-pointer items-center justify-center rounded-lg border shadow-sm transition-colors"
          @click="showLayersPanel = true"
        >
          <icon-lucide-panel-left-open class="size-4" />
        </button>
      </Tip>
      <Tip v-if="!showPropertiesPanel" label="Open inspector">
        <button
          type="button"
          data-test-id="open-properties-panel"
          aria-label="Open inspector"
          class="border-border bg-panel text-muted hover:bg-hover hover:text-surface absolute top-3 right-3 z-30 flex size-8 cursor-pointer items-center justify-center rounded-lg border shadow-sm transition-colors"
          @click="showPropertiesPanel = true"
        >
          <icon-lucide-panel-right-open class="size-4" />
        </button>
      </Tip>
    </div>

    <!-- Mobile layout -->
    <div
      v-else-if="isMobile && showChrome && store.state.showUI"
      :key="'mobile-' + activeTab?.id"
      class="flex flex-1 overflow-hidden"
    >
      <div class="relative isolate flex min-w-0 flex-1 overflow-hidden">
        <EditorCanvas />
        <MobileHud v-if="!liveInspectorPreviewMode" />
        <Toolbar v-if="!liveInspectorPreviewMode" />
      </div>
      <MobileDrawer />
    </div>

    <!-- Collapsed UI (showUI=false) -->
    <div
      v-else-if="showChrome"
      :key="'collapsed-' + activeTab?.id"
      class="flex flex-1 overflow-hidden"
    >
      <div class="relative isolate flex min-w-0 flex-1 overflow-hidden">
        <EditorCanvas />
        <div
          v-if="!isMobile"
          class="border-border bg-panel absolute top-7 left-7 z-10 flex items-center gap-2 rounded-lg border px-2 py-1 shadow-sm"
        >
          <img src="/favicon-32.png" class="size-4" alt="OpenPencil" />
          <span data-test-id="editor-document-name" class="text-surface text-xs">{{
            liveInspectorPreviewMode ? 'Preview' : store.state.documentName
          }}</span>
          <Tip
            :label="
              liveInspectorPreviewMode
                ? 'Exit preview (Esc)'
                : dialogs.showUI({
                    shortcut: formatShortcut(appMenuShortcut('toggle-ui')) ?? ''
                  })
            "
          >
            <button
              data-test-id="editor-show-ui"
              class="text-muted hover:bg-hover hover:text-surface ml-1 flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
              @click="showEditorUI"
            >
              <icon-lucide-x v-if="liveInspectorPreviewMode" class="size-3.5" />
              <icon-lucide-sidebar v-else class="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>
    </div>

    <!-- Bare canvas (no chrome, e.g. ?no-chrome) -->
    <div v-else :key="'bare-' + activeTab?.id" class="flex flex-1 overflow-hidden">
      <div class="relative isolate flex min-w-0 flex-1 overflow-hidden">
        <EditorCanvas />
      </div>
    </div>
  </div>
</template>
