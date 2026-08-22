<script setup lang="ts">
import { useHead } from '@unhead/vue'
import {
  useDebounceFn,
  useDraggable,
  useEventListener,
  useIntervalFn,
  useLocalStorage,
  useUrlSearchParams
} from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
  type CSSProperties
} from 'vue'
import { useRoute } from 'vue-router'

import { useViewportKind, formatShortcut, useI18n } from '@open-pencil/vue'

import {
  bindAutomationPersistence,
  type AutomationPersistenceTransaction
} from '@/app/automation/bridge/persistence'
import { initializeOpenPencilCloud, openPencilCloud } from '@/app/cloud/workspace'
import { useCollab, COLLAB_KEY } from '@/app/collab/use'
import {
  captureReloadState,
  loadReloadState,
  saveReloadState,
  type ReloadStateSnapshot
} from '@/app/document/io/reload-state'
import { setActiveEditorStore, useEditorStore } from '@/app/editor/active-store'
import { fullFrameCodeObjectId } from '@/app/code-object/full-frame'
import {
  type EditorViewport,
  useViewportAnimation,
  viewportMatches,
  viewportSnapshot
} from '@/app/editor/viewport-animation'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { useKeyboard } from '@/app/shell/keyboard/use'
import { loadEditorLayout, saveEditorLayout } from '@/app/shell/layout-storage'
import { appMenuShortcut } from '@/app/shell/menu/shortcut'
import { openFileFromPath, useMenu } from '@/app/shell/menu/use'
import {
  hasMoreOrganizedSidebarHierarchy,
  resolveSidebarWorkspace,
  sidebarWorkspacePluginData,
  type SidebarWorkspace
} from '@/app/sidebar-workspace/tree'
import { setAppTheme } from '@/app/shell/theme'
import { switchSidebarWorkspaceBoard } from '@/app/sidebar-workspace/navigation'
import {
  bindSmylrProductionDocumentPersistence,
  bindSmylrProductionDocumentWriteGuard,
  restoreSmylrProductionDocument
} from '@/app/smylr-production/document-state'
import {
  connectLocalWorkspaceAuthority,
  type LocalWorkspaceAuthority,
  type LocalWorkspaceAuthorityRole
} from '@/app/smylr-production/document-persistence/local-authority'
import {
  isBrowserPageReload,
  restoreSmylrProductionView,
  saveSmylrProductionView
} from '@/app/smylr-production/view-state'
import {
  hasSmylrProductionWorkspace,
  isSmylrFoundationsStale,
  openSmylrProductionWorkspace,
  repairSmylrProductionWorkspaceStructure,
  refreshSmylrFoundationsBoardsInPlace,
  stampSmylrFoundationsRevision,
  switchSmylrProductionPage
} from '@/app/smylr-production/workspace'
import {
  createTab,
  activeTab,
  getActiveStore,
  getWorkspaceTab,
  switchTab,
  tabCount
} from '@/app/tabs'
import { isTauri } from '@/app/tauri/env'
import {
  loadOpenPencilWorkspaceIdentity,
  openPencilWorkspaceIdentityPluginData,
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  readOpenPencilWorkspaceIdentity
} from '@/app/workspace-document/identity'
import {
  consumeLocalWorkspaceNavigationIntent,
  consumeLocalWorkspaceThemeIntent,
  currentLocalWorkspaceAuthorityStatus,
  publishLocalWorkspacePresence,
  readLocalWorkspaceNavigationIntent,
  readLocalWorkspaceThemeIntent,
  refreshLocalWorkspaceAuthorityStatus,
  revertLocalWorkspaceBoardTransaction,
  subscribeLocalWorkspaceAuthorityChanges
} from '@/app/workspace-document/local-authority/client'
import { createLocalWorkspaceAuthorityHistoryBridge } from '@/app/workspace-document/local-authority/history'
import { shouldAllowConcurrentLocalWorkspaceWriters } from '@/app/workspace-document/local-authority/mode'
import { createLocalWorkspaceNavigationConsumer } from '@/app/workspace-document/local-authority/navigation'
import { revealLocalWorkspaceNavigationTargets } from '@/app/workspace-document/local-authority/reveal'
import { createLocalWorkspaceThemeConsumer } from '@/app/workspace-document/local-authority/theme'
import { createLocalWorkspaceDocumentAuthority } from '@/app/workspace-document/local-authority/session'
import { createLocalWorkspaceAuthorityHeadSynchronizer } from '@/app/workspace-document/local-authority/synchronizer'
import EmptyBoardStart from '@/components/EmptyBoardStart.vue'
import EditorCanvas from '@/components/EditorCanvas.vue'
import MermaidImportDialog from '@/components/diagram/MermaidImportDialog.vue'
import LayersPanel from '@/components/LayersPanel.vue'
import { provideMobileHud } from '@/components/MobileHud/context'
import SafariBanner from '@/components/SafariBanner.vue'
import TabBar from '@/components/TabBar.vue'
import Toolbar from '@/components/Toolbar/Toolbar.vue'
import Tip from '@/components/ui/Tip.vue'
import CloudWorkspaceGate from '@/components/cloud/CloudWorkspaceGate.vue'

const MobileDrawer = defineAsyncComponent(() => import('@/components/MobileDrawer.vue'))
const MobileHud = defineAsyncComponent(() => import('@/components/MobileHud/MobileHud.vue'))

const route = useRoute()
const params = useUrlSearchParams('history')
const showChrome = !('no-chrome' in params)
const showCodeTools = 'html-source' in params || !('test' in params)
const isExplicitSmylrWorkspace = 'smylr-app' in params || 'smylr-production' in params
const isUnifiedHomeWorkspace = route.path === '/' && !('test' in params) && !('blank' in params)
const isSmylrProductionWorkspace = isExplicitSmylrWorkspace || isUnifiedHomeWorkspace
const workspaceIdentityPromise = isSmylrProductionWorkspace
  ? loadOpenPencilWorkspaceIdentity()
  : null
const requestedSmylrPageId =
  typeof params['smylr-page'] === 'string' ? params['smylr-page'] : undefined

const createdInitialTab = tabCount() === 0
const firstTab = createdInitialTab ? createTab() : (activeTab.value ?? createTab())
// A Vite module reload can recreate the active-store ref while preserving the
// existing tab collection. Rebind before any setup composable reads the proxy.
setActiveEditorStore(firstTab.store)
const workspaceStore = isSmylrProductionWorkspace
  ? (getWorkspaceTab()?.store ?? firstTab.store)
  : firstTab.store
if (isSmylrProductionWorkspace) workspaceStore.state.loading = true
const store = useEditorStore()
const isCurrentSmylrBoard = computed(() => {
  void store.state.sceneVersion
  const page = store.graph.getNode(store.state.currentPageId)
  return Boolean(
    page?.pluginData.some((entry) => entry.pluginId === 'smylr-production' && entry.key === 'kind')
  )
})
const isCurrentPageEmpty = computed(() => {
  void store.state.sceneVersion
  return store.graph.getChildren(store.state.currentPageId).length === 0
})
const nativeStartedPageIds = ref<ReadonlySet<string>>(new Set())
const showEmptyBoardStart = computed(
  () =>
    !isSmylrProductionWorkspace &&
    showCodeTools &&
    !store.state.loading &&
    !isCurrentSmylrBoard.value &&
    isCurrentPageEmpty.value &&
    !nativeStartedPageIds.value.has(store.state.currentPageId)
)

function startNativeBoard() {
  nativeStartedPageIds.value = new Set([...nativeStartedPageIds.value, store.state.currentPageId])
}

const { dialogs } = useI18n()
const { isMobile } = useViewportKind()
const collab = useCollab(() => (isSmylrProductionWorkspace ? workspaceStore : getActiveStore()))
provide(COLLAB_KEY, collab)
provideMobileHud(collab)
if (isSmylrProductionWorkspace) void initializeOpenPencilCloud()

const shouldRestoreSmylrView = createdInitialTab && isBrowserPageReload()
// Always restore the last local production canvas when opening ?smylr-app —
// not only on the first tab of a cold boot (HMR / remount was skipping restore).
const shouldRestoreSmylrDocument = isSmylrProductionWorkspace
let didAttemptSmylrViewRestore = false
let didAttemptSmylrDocumentRestore = false
let didRestoreTabReloadState = false
let stopSmylrPagePersistence: (() => void) | null = null
let stopSmylrSelectionPersistence: (() => void) | null = null
let stopSmylrViewportPersistence: (() => void) | null = null
let stopSmylrToolPersistence: (() => void) | null = null
let stopSmylrDocumentPersistence: (() => void) | null = null
let stopSmylrDeletePersistence: (() => void) | null = null
let stopSmylrDocumentTracking: (() => void) | null = null
let releaseAutomationPersistence: (() => void) | null = null
let smylrDeletePersistenceQueued = false
let productionWorkspaceReady = false
let connectedWorkspaceRoomId: string | null = null
let localWorkspaceReloadStateId: string | null = null
let localWorkspaceAuthority: LocalWorkspaceAuthority | null = null
let stopLocalWorkspaceAuthorityHeadSubscription: (() => void) | null = null
const localWorkspaceRole = ref<LocalWorkspaceAuthorityRole | 'cloud' | 'pending'>(
  isSmylrProductionWorkspace ? 'pending' : 'writer'
)
const localWorkspaceHasNewerHead = ref(false)
const canWriteLocalWorkspaceDocument = () =>
  Boolean(
    !openPencilCloud.state.value.workspace &&
    localWorkspaceRole.value === 'writer' &&
    localWorkspaceAuthority?.canWrite()
  )
const releaseSmylrProductionDocumentWriteGuard = isSmylrProductionWorkspace
  ? bindSmylrProductionDocumentWriteGuard(workspaceStore, canWriteLocalWorkspaceDocument)
  : null

async function repairHydratedWorkspace(
  active: ReturnType<typeof getActiveStore>,
  localSidebarWorkspace: SidebarWorkspace
) {
  const cloudSidebarWorkspace = resolveSidebarWorkspace(active.graph).workspace
  const localHierarchyIsBetter = hasMoreOrganizedSidebarHierarchy(
    localSidebarWorkspace,
    cloudSidebarWorkspace
  )
  const root = active.graph.getNode(active.graph.rootId)
  const identity = await workspaceIdentityPromise
  const identityChanged = Boolean(
    root &&
    identity &&
    readOpenPencilWorkspaceIdentity(active.graph)?.workspaceId !== identity.workspaceId
  )
  if (localHierarchyIsBetter && root) {
    active.updateNode(root.id, {
      pluginData: sidebarWorkspacePluginData(root, localSidebarWorkspace)
    })
  }
  const currentRoot = active.graph.getNode(active.graph.rootId)
  if (identityChanged && identity && currentRoot) {
    active.updateNode(currentRoot.id, {
      pluginData: openPencilWorkspaceIdentityPluginData(currentRoot, identity)
    })
    active.state.documentName = OPENPENCIL_WORKSPACE_DOCUMENT_NAME
  }
  const structureChanged = repairSmylrProductionWorkspaceStructure(active)
  const structureTouched = localHierarchyIsBetter || identityChanged || structureChanged
  if (structureTouched) active.requestRender()
  if (requestedSmylrPageId) {
    await switchSmylrProductionPage(active, requestedSmylrPageId)
  }
  if (structureTouched) await persistSmylrDocumentNow(active)
}

async function connectOpenPencilWorkspace() {
  const workspace = openPencilCloud.state.value.workspace
  const identity = await workspaceIdentityPromise
  if (!isSmylrProductionWorkspace || !productionWorkspaceReady || !identity) return
  const roomId = workspace?.roomId ?? identity.roomId
  if (connectedWorkspaceRoomId === roomId && (!workspace || collab.state.value.connected)) return
  connectedWorkspaceRoomId = roomId
  const localSidebarWorkspace = resolveSidebarWorkspace(workspaceStore.graph).workspace
  if (!workspace) {
    if (localWorkspaceRole.value === 'writer') {
      await repairHydratedWorkspace(workspaceStore, localSidebarWorkspace)
    }
    return
  }
  collab.connectSharedWorkspace(workspace.roomId, workspace.durableStore, () =>
    repairHydratedWorkspace(workspaceStore, localSidebarWorkspace)
  )
}

watch(
  () => openPencilCloud.state.value.workspace,
  () => {
    if (!productionWorkspaceReady) return
    connectedWorkspaceRoomId = null
    void ensureWorkspaceAuthorityMode()
      .then(() => connectOpenPencilWorkspace())
      .catch((error) => console.error('[OpenPencil Workspace] authority switch failed', error))
  }
)

async function ensureWorkspaceAuthorityMode() {
  if (!isSmylrProductionWorkspace) return
  const cloudWorkspace = openPencilCloud.state.value.workspace
  if (cloudWorkspace) {
    stopSmylrDocumentPersistenceTracking()
    stopLocalWorkspaceAuthorityHeadSubscription?.()
    stopLocalWorkspaceAuthorityHeadSubscription = null
    localWorkspaceAuthority?.close()
    localWorkspaceAuthority = null
    localWorkspaceRole.value = 'cloud'
    localWorkspaceHasNewerHead.value = false
    return
  }
  if (localWorkspaceAuthority) return

  const identity = await workspaceIdentityPromise
  if (!identity) return
  localWorkspaceReloadStateId = identity.workspaceId
  localWorkspaceRole.value = 'pending'
  localWorkspaceHasNewerHead.value = false
  const authorityStatus =
    currentLocalWorkspaceAuthorityStatus() ?? (await refreshLocalWorkspaceAuthorityStatus())
  const authority = await connectLocalWorkspaceAuthority({
    allowConcurrentWriters: shouldAllowConcurrentLocalWorkspaceWriters(authorityStatus),
    documentId: identity.documentId,
    onHeadCommitted: requestLocalWorkspaceAuthorityHeadSynchronization,
    onWriterLost: () => {
      localWorkspaceRole.value = 'viewer'
      stopSmylrDocumentPersistenceTracking()
    }
  })
  localWorkspaceAuthority = authority
  stopLocalWorkspaceAuthorityHeadSubscription?.()
  stopLocalWorkspaceAuthorityHeadSubscription = subscribeLocalWorkspaceAuthorityChanges({
    onHeadCommitted: requestLocalWorkspaceAuthorityHeadSynchronization,
    onNavigationQueued: () => void consumePendingLocalNavigation(),
    onThemeQueued: () => void applyPendingLocalTheme()
  })
  localWorkspaceRole.value = authority.role
  if (authority.role === 'writer') localWorkspaceHasNewerHead.value = false
  if (productionWorkspaceReady && authority.role === 'writer') {
    startSmylrDocumentPersistenceTracking()
  }
  requestLocalWorkspaceAuthorityHeadSynchronization()
}

async function restoreSmylrViewAfterRefresh(active: ReturnType<typeof getActiveStore>) {
  if (!shouldRestoreSmylrView || didAttemptSmylrViewRestore || didRestoreTabReloadState) {
    return false
  }
  didAttemptSmylrViewRestore = true
  return restoreSmylrProductionView(active, {
    expectedPageId: active.state.currentPageId
  })
}

async function restoreSmylrDocument(active: ReturnType<typeof getActiveStore>) {
  if (!shouldRestoreSmylrDocument || didAttemptSmylrDocumentRestore) return false
  didAttemptSmylrDocumentRestore = true
  const identity = await workspaceIdentityPromise
  let reloadState: ReloadStateSnapshot | null = captureReloadState(active.state)
  if (createdInitialTab) reloadState = identity ? loadReloadState(identity.workspaceId) : null
  const restored = await localDocumentAuthority.restore(
    active,
    () => restoreSmylrProductionDocument(active),
    reloadState
  )
  if (restored) localAuthorityHeadSynchronizer.acknowledge(active.state.sceneVersion)
  didRestoreTabReloadState = restored && reloadState !== null
  return restored
}

async function persistSmylrDocumentNow(
  active: ReturnType<typeof getActiveStore>,
  transaction?: AutomationPersistenceTransaction
) {
  const sceneVersion = active.state.sceneVersion
  if (!transaction && localAuthorityHeadSynchronizer.isAcknowledged(sceneVersion)) return true
  const persisted = await localDocumentAuthority.persist(active, transaction)
  if (persisted && active.state.sceneVersion === sceneVersion) {
    localAuthorityHeadSynchronizer.acknowledge(sceneVersion)
  }
  return persisted
}

const persistSmylrView = useDebounceFn(
  () => {
    if (isSmylrProductionWorkspace) void saveSmylrProductionView(workspaceStore)
  },
  120,
  { maxWait: 1000 }
)

const persistSmylrDocument = useDebounceFn(
  () => {
    if (isSmylrProductionWorkspace) void persistSmylrDocumentNow(workspaceStore)
  },
  300,
  { maxWait: 1000 }
)

const localAuthorityHistory = createLocalWorkspaceAuthorityHistoryBridge({
  onError: (error) => {
    console.warn('[Local workspace authority] Durable history action failed:', error)
  },
  revertTransaction: revertLocalWorkspaceBoardTransaction,
  store: workspaceStore,
  synchronize: () => synchronizeLocalWorkspaceAuthorityHead(true)
})

const localDocumentAuthority = createLocalWorkspaceDocumentAuthority({
  canWrite: canWriteLocalWorkspaceDocument,
  isCloudActive: () => Boolean(openPencilCloud.state.value.workspace),
  onBlocked: ({ newerHead }) => {
    localWorkspaceRole.value = 'viewer'
    if (newerHead) localWorkspaceHasNewerHead.value = true
    stopSmylrDocumentPersistenceTracking()
    if (newerHead) void synchronizeLocalWorkspaceAuthorityHead(true)
  },
  onHeadApplied: (head) => {
    localAuthorityHistory.applyHead(head)
    collab.publishGraphReplacement()
  },
  onLocalHeadCommitted: () => localWorkspaceAuthority?.notifyHeadCommitted()
})

const localAuthorityNavigation = createLocalWorkspaceNavigationConsumer({
  consumeIntent: consumeLocalWorkspaceNavigationIntent,
  currentAuthority: currentLocalWorkspaceAuthorityStatus,
  currentPageId: () => workspaceStore.state.currentPageId,
  currentRuntimeInstanceId: () => null,
  openPage: async (pageId) => {
    const page = workspaceStore.graph.getNode(pageId)
    if (page?.type !== 'CANVAS') return false
    const authority = currentLocalWorkspaceAuthorityStatus()
    const workspaceTab = getWorkspaceTab(authority?.identity.workspaceId)
    if (!workspaceTab || workspaceTab.store !== workspaceStore) return false
    switchTab(workspaceTab.id)
    await switchSidebarWorkspaceBoard(workspaceStore, pageId)
    return activeTab.value?.id === workspaceTab.id && workspaceStore.state.currentPageId === pageId
  },
  readIntent: readLocalWorkspaceNavigationIntent,
  revealTargets: (intent) => revealLocalWorkspaceNavigationTargets(workspaceStore, intent)
})

function consumePendingLocalNavigation() {
  return localAuthorityNavigation.consumePending().catch((error) => {
    console.warn('[Local workspace authority] Board navigation failed:', error)
    return false
  })
}

const localAuthorityTheme = createLocalWorkspaceThemeConsumer({
  applyTheme: setAppTheme,
  consumeIntent: consumeLocalWorkspaceThemeIntent,
  readIntent: readLocalWorkspaceThemeIntent
})

function applyPendingLocalTheme() {
  return localAuthorityTheme.applyPending().catch((error) => {
    console.warn('[Local workspace authority] Theme change failed:', error)
    return false
  })
}

// Presence heartbeat: debounced "which Board is on screen" beacon for agents.
let presenceHeartbeat: ReturnType<typeof setTimeout> | null = null
function schedulePresenceHeartbeat() {
  if (presenceHeartbeat) return
  presenceHeartbeat = setTimeout(() => {
    presenceHeartbeat = null
    const authority = currentLocalWorkspaceAuthorityStatus()
    if (authority?.state !== 'ready') return
    const workspaceTab = getWorkspaceTab(authority.identity.workspaceId)
    if (!workspaceTab || workspaceTab.store !== workspaceStore) return
    const pageId = workspaceStore.state.currentPageId
    const pageName = workspaceStore.graph.getNode(pageId)?.name
    if (!pageName) return
    void publishLocalWorkspacePresence({
      contentDocumentId: authority.identity.documentId,
      pageId,
      pageName,
      selectedIds: [...workspaceStore.state.selectedIds],
      viewport: {
        panX: workspaceStore.state.panX,
        panY: workspaceStore.state.panY,
        zoom: workspaceStore.state.zoom
      },
      workspaceId: authority.identity.workspaceId
    }).catch(() => undefined)
  }, 1500)
}
watch(
  () => [
    workspaceStore.state.currentPageId,
    workspaceStore.state.panX,
    workspaceStore.state.panY,
    workspaceStore.state.zoom,
    [...workspaceStore.state.selectedIds].join('\u0000')
  ],
  schedulePresenceHeartbeat,
  { immediate: true }
)
onUnmounted(() => {
  if (presenceHeartbeat) clearTimeout(presenceHeartbeat)
})

const localAuthorityHeadSynchronizer = createLocalWorkspaceAuthorityHeadSynchronizer({
  canResumeWriting: () =>
    Boolean(localWorkspaceAuthority?.role === 'writer' && localWorkspaceAuthority.canWrite()),
  canSynchronize: () =>
    Boolean(
      isSmylrProductionWorkspace &&
      productionWorkspaceReady &&
      !openPencilCloud.state.value.workspace
    ),
  canWrite: canWriteLocalWorkspaceDocument,
  currentSceneVersion: () => workspaceStore.state.sceneVersion,
  persist: () => persistSmylrDocumentNow(workspaceStore),
  restore: () =>
    localDocumentAuthority.restore(
      workspaceStore,
      async () => false,
      captureReloadState(workspaceStore.state)
    ),
  setWritable: (writable) => {
    localWorkspaceRole.value = writable ? 'writer' : 'viewer'
    if (writable) localWorkspaceHasNewerHead.value = false
  },
  startTracking: startSmylrDocumentPersistenceTracking,
  stopTracking: stopSmylrDocumentPersistenceTracking
})

function synchronizeLocalWorkspaceAuthorityHead(localChangesAlreadyPreserved = false) {
  return localAuthorityHeadSynchronizer.synchronize(localChangesAlreadyPreserved)
}

async function synchronizeLocalWorkspaceAuthorityHeadIfChanged(): Promise<boolean> {
  if (
    !isSmylrProductionWorkspace ||
    !productionWorkspaceReady ||
    openPencilCloud.state.value.workspace
  ) {
    return false
  }
  if (!(await localDocumentAuthority.hasNewerHead())) return false
  localWorkspaceHasNewerHead.value = true
  return synchronizeLocalWorkspaceAuthorityHead()
}

function requestLocalWorkspaceAuthorityHeadSynchronization(): void {
  void synchronizeLocalWorkspaceAuthorityHeadIfChanged().catch((error) => {
    console.warn('[Local workspace authority] Head synchronization failed:', error)
  })
}

if (isSmylrProductionWorkspace) {
  releaseAutomationPersistence = bindAutomationPersistence(
    workspaceStore,
    async (requestedSceneRevision, transaction) => {
      if (workspaceStore.state.sceneVersion !== requestedSceneRevision) {
        return { reason: 'concurrent_scene_change', status: 'unknown' }
      }
      const saved = await persistSmylrDocumentNow(workspaceStore, transaction)
      if (!saved) return { reason: 'save_not_acknowledged', status: 'unknown' }
      if (workspaceStore.state.sceneVersion !== requestedSceneRevision) {
        return { reason: 'concurrent_scene_change', status: 'unknown' }
      }
      const authority = currentLocalWorkspaceAuthorityStatus()
      return authority?.state === 'ready'
        ? {
            authority_id: authority.authorityId,
            authority_revision: authority.revision,
            content_hash: authority.contentHash ?? undefined,
            status: 'durable',
            target: 'local_workspace_authority'
          }
        : { status: 'durable', target: 'browser_local' }
    }
  )
}

function scheduleSmylrDocumentPersistence() {
  persistSmylrDocument()
}

function persistSmylrDocumentAfterDelete() {
  if (smylrDeletePersistenceQueued) return
  smylrDeletePersistenceQueued = true
  queueMicrotask(() => {
    smylrDeletePersistenceQueued = false
    if (isSmylrProductionWorkspace) void persistSmylrDocumentNow(workspaceStore)
  })
}

function stopSmylrDocumentPersistenceTracking() {
  stopSmylrDocumentPersistence?.()
  stopSmylrDeletePersistence?.()
  stopSmylrDocumentTracking?.()
  stopSmylrDocumentPersistence = null
  stopSmylrDeletePersistence = null
  stopSmylrDocumentTracking = null
}

function startSmylrDocumentPersistenceTracking() {
  if (
    !isSmylrProductionWorkspace ||
    !canWriteLocalWorkspaceDocument() ||
    stopSmylrDocumentTracking
  ) {
    return
  }
  const active = workspaceStore
  stopSmylrDocumentTracking = bindSmylrProductionDocumentPersistence(active)
  stopSmylrDocumentPersistence = active.onEditorEvent(
    'render:requested',
    scheduleSmylrDocumentPersistence
  )
  // Deletion must reach local storage before a quick reload can restore the
  // previous graph. Coalesce child deletions into one same-turn save instead
  // of waiting for the normal 300 ms document debounce.
  stopSmylrDeletePersistence = active.onEditorEvent('node:deleted', persistSmylrDocumentAfterDelete)
  void persistSmylrDocumentNow(active)
}

function startSmylrViewPersistence() {
  if (!isSmylrProductionWorkspace || stopSmylrPagePersistence) return
  const active = workspaceStore
  const saveReloadStateNow = () => {
    if (localWorkspaceReloadStateId) {
      saveReloadState(localWorkspaceReloadStateId, active.state)
    }
  }
  stopSmylrPagePersistence = active.onEditorEvent('page:changed', () => {
    saveReloadStateNow()
    persistSmylrView()
  })
  stopSmylrSelectionPersistence = active.onEditorEvent('selection:changed', persistSmylrView)
  stopSmylrViewportPersistence = active.onEditorEvent('viewport:changed', persistSmylrView)
  stopSmylrToolPersistence = active.onEditorEvent('tool:changed', persistSmylrView)
  saveReloadStateNow()
  void saveSmylrProductionView(active)
  startSmylrDocumentPersistenceTracking()
}

useEventListener(window, 'pagehide', () => {
  if (!isSmylrProductionWorkspace) return
  const active = workspaceStore
  if (localWorkspaceReloadStateId) {
    saveReloadState(localWorkspaceReloadStateId, active.state)
  }
  void saveSmylrProductionView(active)
  void persistSmylrDocumentNow(active)
})

useEventListener(document, 'visibilitychange', () => {
  if (!isSmylrProductionWorkspace || document.visibilityState !== 'hidden') return
  void persistSmylrDocumentNow(workspaceStore)
})

useIntervalFn(() => {
  if (
    !canWriteLocalWorkspaceDocument() ||
    localAuthorityHeadSynchronizer.isAcknowledged(workspaceStore.state.sceneVersion)
  ) {
    return
  }
  void persistSmylrDocumentNow(workspaceStore)
}, 2000)

/**
 * Seed / re-seed Smylr production canvas.
 * Re-opens when foundations builders are newer than the graph in memory
 * (after a vite rebuild + soft reload) so you don't need Cmd+Shift+R forever.
 */
async function refreshFoundationsIfStale(active: ReturnType<typeof getActiveStore>) {
  if (repairSmylrProductionWorkspaceStructure(active)) {
    active.requestRender()
    void persistSmylrDocumentNow(active)
  }
  if (!isSmylrFoundationsStale(active)) return
  // Never replaceGraph the whole production canvas for a builder bump.
  const refreshed = await refreshSmylrFoundationsBoardsInPlace(active, {
    selectedPageId: requestedSmylrPageId,
    preserveViewport: true
  })
  if (!refreshed) stampSmylrFoundationsRevision(active)
  void persistSmylrDocumentNow(active)
}

async function ensureSmylrProductionWorkspace(force = false) {
  if (!isSmylrProductionWorkspace) return
  const active = workspaceStore

  // Prefer restoring the user's last scene graph (deletes included).
  if (!force && (await restoreSmylrDocument(active))) {
    await refreshFoundationsIfStale(active)
    if (requestedSmylrPageId) await switchSmylrProductionPage(active, requestedSmylrPageId)
    await restoreSmylrViewAfterRefresh(active)
    void persistSmylrDocumentNow(active)
    return
  }

  const initialPageId = active.state.currentPageId
  const { removeDesignedComponentPlaceholders, removeStaleComputedComponentPages } =
    await import('@/app/smylr-component-library/computed-catalog')
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
  await openSmylrProductionWorkspace(active, {
    selectedPageId: requestedSmylrPageId
  })
  await restoreSmylrViewAfterRefresh(active)
  void persistSmylrDocumentNow(active)
}

// Defer workspace open until after first paint so the canvas can init and
// dismiss the splash — never block boot on foundations graph build.
const WORKSPACE_LOADING_LIMIT_MS = 4_000
let workspaceLoadingLimit = 0

function clearWorkspaceLoading() {
  window.clearTimeout(workspaceLoadingLimit)
  workspaceStore.state.loading = false
  store.state.loading = false
}

if (isSmylrProductionWorkspace) {
  onMounted(() => {
    // Double-rAF: let EditorCanvas mount + start CanvasKit before heavy graph work.
    workspaceLoadingLimit = window.setTimeout(clearWorkspaceLoading, WORKSPACE_LOADING_LIMIT_MS)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void ensureSmylrProductionWorkspace()
          .then(() => {
            productionWorkspaceReady = true
            startSmylrViewPersistence()
            void consumePendingLocalNavigation()
            void applyPendingLocalTheme()
            clearWorkspaceLoading()
            return ensureWorkspaceAuthorityMode()
          })
          .then(() => {
            requestLocalWorkspaceAuthorityHeadSynchronization()
            return connectOpenPencilWorkspace()
          })
          .catch((e) => console.error('[Smylr Production Workspace]', e))
          .finally(() => {
            clearWorkspaceLoading()
          })
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

/** In-place Board update after foundation source changes. */
function bumpBoards() {
  if (!isSmylrProductionWorkspace) return
  void refreshSmylrFoundationsBoardsInPlace(workspaceStore, {
    selectedPageId: requestedSmylrPageId,
    preserveViewport: true
  }).then(() => persistSmylrDocumentNow(workspaceStore))
}

// Board modules fire this after self-accept so we always get the new builder.
useEventListener(window, 'smylr-foundations-hmr', bumpBoards)

if (import.meta.hot) {
  import.meta.hot.accept(
    [
      '../app/smylr-production/create-tokens-page.ts',
      '../app/smylr-production/create-brand-page.ts',
      '../app/smylr-production/smylr-token-catalog.ts',
      '../app/smylr-production/smylr-tokens.reference.json'
    ],
    bumpBoards
  )
}

useHead({ title: route.meta.demo ? 'Demo' : undefined })
useKeyboard()
useMenu()

function isEditorCanvasWheelTarget(event: WheelEvent) {
  const target = event.target
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('[data-test-id="editor-root"] canvas'))
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
}

function handleEditorLayout(layout: number[]) {
  if (showLayersPanel.value && layout.length === 2) {
    saveEditorLayout(layout)
  }
}

const fileAssociationCleanup = ref<(() => void) | null>(null)
const initialEditorLayout = loadEditorLayout()

const showLayersPanel = ref(true)
const desktopWorkspaceRef = ref<HTMLElement | null>(null)
const layersSplitterPanelRef = ref<{ collapse: () => void; expand: () => void } | null>(null)
const layersShellMotionRef = ref<HTMLElement | null>(null)
const compactSidebarTabDragHandleRef = ref<HTMLElement | null>(null)
const storedCompactSidebarTabY = useLocalStorage<number | null>(
  'openpencil-sidebar-full-frame-tab-y-v1',
  null
)
const compactSidebarTabActive = computed(
  () => Boolean(fullFrameCodeObjectId.value) && !showLayersPanel.value
)
const compactSidebarTabY = ref(0)
const closingSidebarWidth = ref<number | null>(null)
let sidebarTransitionEpoch = 0
let compactSidebarTabPointerOffsetY = 0
const { isDragging: compactSidebarTabDragging } = useDraggable(layersShellMotionRef, {
  axis: 'y',
  disabled: computed(() => !compactSidebarTabActive.value),
  handle: compactSidebarTabDragHandleRef,
  initialValue: { x: 12, y: 0 },
  preventDefault: true,
  onStart: (_position, event) => {
    const handle = event.currentTarget
    const tab = layersShellMotionRef.value?.getBoundingClientRect()
    compactSidebarTabPointerOffsetY = tab ? event.clientY - tab.top : 0
    if (handle instanceof HTMLElement) handle.setPointerCapture(event.pointerId)
  },
  onMove: (_position, event) => {
    const bounds = desktopWorkspaceBounds()
    if (!bounds) return
    compactSidebarTabY.value = clampCompactSidebarTabY(
      event.clientY - bounds.top - compactSidebarTabPointerOffsetY
    )
  },
  onEnd: (_position, event) => {
    const handle = event.currentTarget
    if (handle instanceof HTMLElement && handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId)
    }
    storedCompactSidebarTabY.value = compactSidebarTabY.value
  }
})
const layersShellMotionStyle = computed<CSSProperties | undefined>(() => {
  const style: CSSProperties = {}
  if (compactSidebarTabActive.value) {
    style.cursor = compactSidebarTabDragging.value ? 'grabbing' : undefined
    style.left = '12px'
    style.position = 'absolute'
    style.top = `${compactSidebarTabY.value}px`
    style.transform = 'none'
    style.translate = 'none'
  }
  if (closingSidebarWidth.value !== null) style.width = `${closingSidebarWidth.value}px`
  return Object.keys(style).length > 0 ? style : undefined
})
const lastOpenSidebarInsets = ref<ReturnType<typeof editorViewportInsets>>({})
const sidebarFocusAdjustment = ref<{
  adjusted: EditorViewport
  nodeId: string
  original: EditorViewport
} | null>(null)
const viewportAnimation = useViewportAnimation(store)

function desktopWorkspaceBounds() {
  return desktopWorkspaceRef.value?.getBoundingClientRect() ?? null
}

function clampCompactSidebarTabY(candidate: number) {
  const bounds = desktopWorkspaceBounds()
  if (!bounds) return Math.max(12, candidate)
  const tabHeight = layersShellMotionRef.value?.getBoundingClientRect().height ?? 44
  return Math.min(Math.max(12, candidate), bounds.height - tabHeight - 12)
}

function moveCompactSidebarTab(deltaY: number) {
  compactSidebarTabY.value = clampCompactSidebarTabY(compactSidebarTabY.value + deltaY)
  storedCompactSidebarTabY.value = compactSidebarTabY.value
}

async function placeCompactSidebarTab() {
  if (!compactSidebarTabActive.value) return
  await nextTick()
  const bounds = desktopWorkspaceBounds()
  const tabHeight = layersShellMotionRef.value?.getBoundingClientRect().height ?? 44
  const preferred =
    storedCompactSidebarTabY.value ??
    (bounds ? (bounds.height - tabHeight) / 2 : compactSidebarTabY.value)
  compactSidebarTabY.value = clampCompactSidebarTabY(preferred)
}

watch(
  compactSidebarTabActive,
  (active) => {
    if (active) void placeCompactSidebarTab()
  },
  { flush: 'post' }
)

useEventListener(window, 'resize', () => {
  if (compactSidebarTabActive.value) {
    compactSidebarTabY.value = clampCompactSidebarTabY(compactSidebarTabY.value)
  }
})

function protectSidebarFocus(nodeId: string, insets: ReturnType<typeof editorViewportInsets>) {
  if (!store.state.selectedIds.has(nodeId)) return

  const previous = viewportSnapshot(store)
  const focused = store.zoomToNode(nodeId, insets, {
    maxZoom: Math.min(store.state.zoom, previous.zoom * 0.97)
  })
  if (!focused) return
  const adjusted = viewportSnapshot(store)
  store.setViewport(previous)
  sidebarFocusAdjustment.value = { adjusted, nodeId, original: previous }
  viewportAnimation.animateTo(adjusted)
}

function closeLayersPanel() {
  lastOpenSidebarInsets.value = editorViewportInsets()
  const adjustment = sidebarFocusAdjustment.value
  const expandedWidth = layersShellMotionRef.value?.getBoundingClientRect().width ?? null
  const transitionEpoch = ++sidebarTransitionEpoch
  closingSidebarWidth.value = expandedWidth
  showLayersPanel.value = false
  layersSplitterPanelRef.value?.collapse()
  if (expandedWidth !== null) {
    void nextTick(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (transitionEpoch === sidebarTransitionEpoch) closingSidebarWidth.value = null
        })
      })
    })
  }
  if (fullFrameCodeObjectId.value) void placeCompactSidebarTab()
  if (
    adjustment &&
    store.state.selectedIds.has(adjustment.nodeId) &&
    (viewportMatches(viewportSnapshot(store), adjustment.adjusted) ||
      viewportAnimation.isAnimatingTo(adjustment.adjusted))
  ) {
    viewportAnimation.animateTo(adjustment.original)
  } else {
    sidebarFocusAdjustment.value = null
    viewportAnimation.cancel()
  }
}

function openLayersPanel() {
  if (showLayersPanel.value) return
  sidebarTransitionEpoch += 1
  closingSidebarWidth.value = null
  const selectedId =
    store.state.selectedIds.size === 1 ? store.state.selectedIds.values().next().value : null
  showLayersPanel.value = true
  layersSplitterPanelRef.value?.expand()
  if (typeof selectedId !== 'string') {
    sidebarFocusAdjustment.value = null
    viewportAnimation.cancel()
    return
  }

  const adjustment = sidebarFocusAdjustment.value
  if (
    adjustment?.nodeId === selectedId &&
    (viewportMatches(viewportSnapshot(store), adjustment.original) ||
      viewportAnimation.isAnimatingTo(adjustment.original))
  ) {
    viewportAnimation.animateTo(adjustment.adjusted)
    return
  }

  sidebarFocusAdjustment.value = null
  viewportAnimation.cancel()
  protectSidebarFocus(selectedId, lastOpenSidebarInsets.value)
}

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

onMounted(async () => {
  try {
    await bindAssociatedFileOpen()
  } catch (e) {
    console.error('[Open With]', e)
  }
})

onUnmounted(() => {
  sidebarTransitionEpoch += 1
  window.clearTimeout(workspaceLoadingLimit)
  stopSmylrPagePersistence?.()
  stopSmylrSelectionPersistence?.()
  stopSmylrViewportPersistence?.()
  stopSmylrToolPersistence?.()
  stopSmylrDocumentPersistenceTracking()
  stopLocalWorkspaceAuthorityHeadSubscription?.()
  stopLocalWorkspaceAuthorityHeadSubscription = null
  releaseAutomationPersistence?.()
  releaseAutomationPersistence = null
  localAuthorityHistory.dispose()
  releaseSmylrProductionDocumentWriteGuard?.()
  localWorkspaceAuthority?.close()
  localWorkspaceAuthority = null
  fileAssociationCleanup.value?.()
})
</script>

<template>
  <div
    data-test-id="editor-root"
    :data-local-workspace-role="localWorkspaceRole"
    :aria-busy="store.state.loading"
    class="flex h-screen w-screen flex-col"
    style="overscroll-behavior: none"
  >
    <SafariBanner />
    <CloudWorkspaceGate :enabled="isSmylrProductionWorkspace" />
    <TabBar />
    <div
      v-if="isSmylrProductionWorkspace && localWorkspaceRole === 'viewer'"
      class="pointer-events-none fixed inset-x-0 top-10 z-[90] flex justify-center px-4"
      data-test-id="local-workspace-viewer"
      role="status"
      aria-live="polite"
    >
      <div
        class="border-chrome-border bg-chrome-raised/95 text-muted flex h-8 items-center gap-1.5 rounded-full border px-3 text-[10px] shadow-chrome-menu backdrop-blur-xl"
      >
        <icon-lucide-lock-keyhole class="size-3 text-amber-400" />
        <span>
          View only ·
          {{
            localWorkspaceHasNewerHead ? 'Newer saved Board available' : 'Another tab owns edits'
          }}
        </span>
      </div>
    </div>
    <MermaidImportDialog />

    <!-- Desktop: full-bleed canvas under one contextual sidebar and its tool rail -->
    <div
      v-if="!isMobile && showChrome && store.state.showUI"
      ref="desktopWorkspaceRef"
      :key="activeTab?.id"
      class="bg-canvas relative min-h-0 flex-1 overflow-hidden"
    >
      <!--
        Canvas must fill this box (absolute + flex). flex-1 alone does nothing
        without a flex parent — that collapsed the canvas to 0 height.
      -->
      <div class="absolute inset-0 isolate z-0 flex min-h-0 min-w-0">
        <EditorCanvas />
        <EmptyBoardStart
          v-if="showEmptyBoardStart"
          :page-is-empty="isCurrentPageEmpty"
          @start-native="startNativeBoard"
        />
      </div>

      <!-- Floating chrome over canvas; middle is transparent + click-through -->
      <SplitterGroup
        v-if="!showEmptyBoardStart"
        direction="horizontal"
        :inert="store.state.loading ? true : undefined"
        :data-sidebar-open="showLayersPanel ? 'true' : 'false'"
        class="pointer-events-none absolute inset-0 z-20 bg-transparent"
        @layout="handleEditorLayout"
      >
        <SplitterPanel
          ref="layersSplitterPanelRef"
          id="layers"
          collapsible
          :collapsed-size="0"
          :default-size="initialEditorLayout[0]"
          :min-size="14"
          :max-size="30"
          data-test-id="layers-splitter-panel"
          class="pointer-events-none relative flex min-h-0 flex-col !overflow-visible bg-transparent transition-[flex-grow] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          @collapse="showLayersPanel = false"
          @expand="showLayersPanel = true"
        >
          <div
            ref="layersShellMotionRef"
            data-test-id="layers-shell-motion"
            :data-sidebar-open="showLayersPanel ? 'true' : 'false'"
            :data-full-frame="fullFrameCodeObjectId ? 'true' : 'false'"
            :data-compact-tab-dragging="compactSidebarTabDragging ? 'true' : 'false'"
            :style="layersShellMotionStyle"
            class="pointer-events-auto absolute top-1/2 left-3 z-30 flex min-h-0 min-w-11 -translate-y-1/2 overflow-hidden border border-chrome-border bg-sidebar shadow-chrome-panel [contain:layout_paint_style] [interpolate-size:allow-keywords] transition-[width,height,border-radius] will-change-[width,height,border-radius] motion-reduce:transition-none"
            :class="
              showLayersPanel
                ? 'h-[calc(100%-1.5rem)] w-[calc(100%-0.75rem)] rounded-[14px] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
                : fullFrameCodeObjectId
                  ? 'h-11 w-11 rounded-[14px] bg-chrome/95 shadow-lg ring-1 ring-white/5 duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]'
                  : 'h-auto w-11 rounded-[22px] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]'
            "
          >
            <button
              v-if="compactSidebarTabActive"
              ref="compactSidebarTabDragHandleRef"
              type="button"
              data-test-id="sidebar-compact-tab-drag-handle"
              aria-label="Move sidebar tab"
              class="absolute top-1/2 left-0.5 z-40 flex h-6 w-2.5 -translate-y-1/2 touch-none cursor-grab flex-col items-center justify-center gap-0.5 rounded-full active:cursor-grabbing"
              @keydown.down.prevent="moveCompactSidebarTab(24)"
              @keydown.up.prevent="moveCompactSidebarTab(-24)"
            >
              <span class="size-0.5 rounded-full bg-accent/70" />
              <span class="size-0.5 rounded-full bg-accent/70" />
              <span class="size-0.5 rounded-full bg-accent/70" />
            </button>
            <div
              data-test-id="layers-shell"
              :aria-hidden="!showLayersPanel"
              :inert="showLayersPanel ? undefined : true"
              class="flex min-h-0 min-w-0 flex-col overflow-hidden transition-[opacity,transform] motion-reduce:transition-none [--color-accent:#7c3aed] [[data-theme=dark]_&]:[--color-accent:#9b82f3]"
              :class="
                showLayersPanel
                  ? 'flex-1 translate-x-0 opacity-100 delay-75 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]'
                  : 'pointer-events-none h-0 w-0 flex-1 -translate-x-2 opacity-0 delay-0 duration-100 ease-in'
              "
            >
              <LayersPanel />
            </div>
            <Toolbar
              embedded
              :sidebar-open="showLayersPanel"
              :sidebar-tab-only="Boolean(fullFrameCodeObjectId) && !showLayersPanel"
              @close-sidebar="closeLayersPanel"
              @open-sidebar="openLayersPanel"
            />
          </div>
        </SplitterPanel>
        <SplitterResizeHandle
          data-test-id="left-splitter-handle"
          :disabled="!showLayersPanel"
          class="relative z-30 w-3 cursor-col-resize bg-transparent transition-opacity motion-reduce:transition-none"
          :class="
            showLayersPanel
              ? 'pointer-events-auto opacity-100 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
              : 'pointer-events-none opacity-0 duration-100 ease-in'
          "
        />
        <SplitterPanel
          id="canvas"
          :default-size="initialEditorLayout[1]"
          :min-size="32"
          data-test-id="canvas-chrome-area"
          class="pointer-events-none relative min-w-0 bg-transparent"
        >
        </SplitterPanel>
      </SplitterGroup>
    </div>

    <!-- Mobile layout -->
    <div
      v-else-if="isMobile && showChrome && store.state.showUI"
      :key="'mobile-' + activeTab?.id"
      class="flex flex-1 overflow-hidden"
    >
      <div class="relative isolate flex min-w-0 flex-1 overflow-hidden">
        <EditorCanvas />
        <EmptyBoardStart
          v-if="showEmptyBoardStart"
          :page-is-empty="isCurrentPageEmpty"
          @start-native="startNativeBoard"
        />
        <MobileHud v-if="!showEmptyBoardStart" :inert="store.state.loading ? true : undefined" />
        <Toolbar v-if="!showEmptyBoardStart" :inert="store.state.loading ? true : undefined" />
      </div>
      <MobileDrawer
        v-if="!showEmptyBoardStart"
        :inert="store.state.loading ? true : undefined"
        :show-code-tab="showCodeTools"
      />
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
            store.state.documentName
          }}</span>
          <Tip
            :label="
              dialogs.showUI({
                shortcut: formatShortcut(appMenuShortcut('toggle-ui')) ?? ''
              })
            "
          >
            <button
              data-test-id="editor-show-ui"
              class="text-muted hover:bg-hover hover:text-surface ml-1 flex size-6 cursor-pointer items-center justify-center rounded transition-colors"
              @click="showEditorUI"
            >
              <icon-lucide-sidebar class="size-3.5" />
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
