import type { ViewportInsets } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '../editor/session'
import { visibleElementRect } from '../editor/viewport-insets'
import type { LiveWorkspaceItem } from '../smylr-live-inspector/workspace'
import { syncDentalChartAppFlowScene } from './app-flow/scene'
import {
  createSmylrBrandDesignPage,
  SMYLR_BRAND_BOARD_KIND,
  SMYLR_BRAND_PAGE_ID,
  SMYLR_BRAND_PAGE_KIND
} from './create-brand-page'
import {
  createSmylrTokensDesignPage,
  SMYLR_TOKENS_DARK_BOARD_KIND,
  SMYLR_TOKENS_LIGHT_BOARD_KIND,
  SMYLR_TOKENS_PAGE_ID,
  SMYLR_TOKENS_PAGE_KIND
} from './create-tokens-page'
import {
  SMYLR_FOUNDATIONS_PLUGIN_ID,
  SMYLR_FOUNDATIONS_REV_KEY,
  SMYLR_FOUNDATIONS_REVISION
} from './foundations-revision'
import { DEFAULT_LIVE_FRAME_RADIUS } from './frame-corners'
import {
  applyLiveFrameTombstones,
  isWorkspaceItemTombstoned,
  loadLiveFrameTombstones
} from './live/frame-tombstones'
import { SMYLR_PRODUCTION_PAGES, smylrProductionPageById, type SmylrProductionPage } from './pages'
import { yieldAnimationFrames } from './yield-frames'

const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'
const LIVE_APP_FRAME_WIDTH = 1280
const LIVE_APP_FRAME_HEIGHT = 900
const LIVE_APP_FRAME_GAP = 120
const FLOW_PAGE_SUFFIX = ' — Flow'
const VIEWPORT_SAFE_GAP = 24

type WorkspaceOptions = {
  selectedPageId?: string
  /** Live HMR: keep pan/zoom (no fit / no camera jump). */
  preserveViewport?: boolean
}

type WorkspaceGraphResult = {
  graph: SceneGraph
  selectedPageId: string
  selectedPageNodeId: string
  selectedLiveFrameId: string
  selectedFocusId: string
  /** Multi-board pages (light + dark) — select all for fit-to-view */
  selectedFocusIds: string[]
}

type SmylrWorkspaceFrameItem = Pick<
  LiveWorkspaceItem,
  'branch' | 'flow' | 'id' | 'kind' | 'name' | 'route' | 'status'
>

export type SmylrAppViewKind = 'current' | 'flow'

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

export function isSmylrLiveAppFrameNode(node: SceneNode | null | undefined): boolean {
  return Boolean(node && pluginValue(node, 'kind') === LIVE_APP_KIND)
}

export function isSmylrFlowPageNode(node: SceneNode | null | undefined): boolean {
  return Boolean(node && pluginValue(node, 'kind') === 'smylr-flow-page')
}

function createLiveAppPage(graph: SceneGraph, page: SmylrProductionPage, pageNode: SceneNode) {
  graph.updateNode(pageNode.id, {
    name: page.label,
    pluginData: [
      pluginData('kind', 'smylr-production-page'),
      pluginData('pageId', page.id),
      pluginData('route', page.route)
    ]
  })

  const states = [{ id: 'current', label: 'Current' }]
  let currentFrameId = ''
  states.forEach((state, index) => {
    const frame = graph.createNode('FRAME', pageNode.id, {
      x: 96 + index * (LIVE_APP_FRAME_WIDTH + LIVE_APP_FRAME_GAP),
      y: 88,
      width: LIVE_APP_FRAME_WIDTH,
      height: LIVE_APP_FRAME_HEIGHT,
      name: `${page.label} / ${state.label}`,
      cornerRadius: DEFAULT_LIVE_FRAME_RADIUS,
      clipsContent: true,
      fills: [],
      // Geometry-only scene node. The live DOM iframe owns all visible paint.
      // Painting this native stroke creates a second frame underneath that can
      // visibly trail the iframe while CanvasKit and Chrome composite a pan/zoom.
      strokes: [],
      pluginData: [
        pluginData('kind', LIVE_APP_KIND),
        pluginData('pageId', page.id),
        pluginData('route', page.route),
        pluginData('state', state.id)
      ]
    })
    if (state.id === 'current') currentFrameId = frame.id
  })

  return currentFrameId
}

function createFlowCanvasPage(graph: SceneGraph, page: SmylrProductionPage) {
  const flowPage = graph.addPage(`${page.label}${FLOW_PAGE_SUFFIX}`)
  graph.updateNode(flowPage.id, {
    name: `${page.label}${FLOW_PAGE_SUFFIX}`,
    pluginData: [
      pluginData('kind', 'smylr-flow-page'),
      pluginData('pageId', page.id),
      pluginData('route', page.route)
    ]
  })
  if (page.id !== 'dental-chart') return flowPage.id
  syncDentalChartAppFlowScene(graph, flowPage.id)
  return flowPage.id
}

const DESIGN_PAGE_IDS = new Set([SMYLR_TOKENS_PAGE_ID, SMYLR_BRAND_PAGE_ID])

export function createSmylrProductionWorkspaceGraph(
  options: WorkspaceOptions = {}
): WorkspaceGraphResult {
  const wantsDesignPage = DESIGN_PAGE_IDS.has(options.selectedPageId ?? '')
  const selectedPage = !wantsDesignPage
    ? (smylrProductionPageById(options.selectedPageId) ?? SMYLR_PRODUCTION_PAGES[0])
    : SMYLR_PRODUCTION_PAGES[0]

  const graph = new SceneGraph()
  const firstPageNode = graph.getPages()[0] ?? graph.addPage(SMYLR_PRODUCTION_PAGES[0].label)
  let selectedPageNodeId = firstPageNode.id
  let selectedLiveFrameId = ''
  let selectedFocusId = ''
  let selectedFocusIds: string[] = []

  SMYLR_PRODUCTION_PAGES.forEach((page, index) => {
    const pageNode = index === 0 ? firstPageNode : graph.addPage(page.label)
    const liveFrameId = createLiveAppPage(graph, page, pageNode)
    createFlowCanvasPage(graph, page)

    if (!wantsDesignPage && page.id === selectedPage.id) {
      selectedPageNodeId = pageNode.id
      selectedLiveFrameId = liveFrameId
      selectedFocusId = liveFrameId
      selectedFocusIds = [liveFrameId]
    }
  })

  // Foundations pages — native canvas only (no live app iframe).
  // Design System = semantic tokens board; Brand Guidelines = identity rules.
  const tokensPageNode = graph.addPage('Design System')
  const tokensBoardId = createSmylrTokensDesignPage(graph, tokensPageNode)

  const brandPageNode = graph.addPage('Brand Guidelines')
  const brandBoardId = createSmylrBrandDesignPage(graph, brandPageNode)

  if (options.selectedPageId === SMYLR_TOKENS_PAGE_ID) {
    selectedPageNodeId = tokensPageNode.id
    selectedLiveFrameId = ''
    // Both light + dark boards — never focus only one (that zooms past the pair).
    const boardIds = graph
      .getChildren(tokensPageNode.id)
      .filter((n) => {
        const k = pluginValue(n, 'kind')
        return k === SMYLR_TOKENS_LIGHT_BOARD_KIND || k === SMYLR_TOKENS_DARK_BOARD_KIND
      })
      .map((n) => n.id)
    selectedFocusIds = boardIds.length > 0 ? boardIds : [tokensBoardId]
    selectedFocusId = selectedFocusIds[0] ?? tokensBoardId
  } else if (options.selectedPageId === SMYLR_BRAND_PAGE_ID) {
    selectedPageNodeId = brandPageNode.id
    selectedLiveFrameId = ''
    selectedFocusId = brandBoardId
    selectedFocusIds = [brandBoardId]
  }

  computeAllLayouts(graph)

  return {
    graph,
    selectedPageId: wantsDesignPage ? (options.selectedPageId as string) : selectedPage.id,
    selectedPageNodeId,
    selectedLiveFrameId,
    selectedFocusId,
    selectedFocusIds
  }
}

/** Keep fitted Smylr frames clear of the floating editor chrome. */
function smylrViewportInsets(): ViewportInsets {
  const canvas = visibleElementRect('[data-test-id="canvas-area"]')
  if (!canvas) return {}

  const layers = visibleElementRect('[data-test-id="layers-panel"]')
  const toolbar = visibleElementRect('[data-test-id="toolbar"]')
  const boardDock = visibleElementRect('[data-test-id="board-dock"]')

  return {
    left: layers
      ? Math.max(VIEWPORT_SAFE_GAP, layers.right - canvas.left + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP,
    right: VIEWPORT_SAFE_GAP,
    top: toolbar
      ? Math.max(VIEWPORT_SAFE_GAP, toolbar.bottom - canvas.top + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP,
    bottom: boardDock
      ? Math.max(VIEWPORT_SAFE_GAP, canvas.bottom - boardDock.top + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP
  }
}

/** Fit page content into the canvas area that remains visible around editor panels. */
export async function fitSmylrPageToViewport(
  store: EditorStore,
  focusIds: string[] = [],
  options: { settle?: boolean } = {}
) {
  const ids = focusIds.filter((id) => store.graph.getNode(id))
  if (ids.length > 0) store.select(ids)

  const fit = () => {
    const insets = smylrViewportInsets()
    if (ids.length > 0) store.zoomToSelection(insets)
    else store.zoomToFit(insets)
  }

  if (options.settle === false) {
    fit()
    return
  }

  await yieldAnimationFrames(2)
  fit()
  await yieldAnimationFrames(2)
  fit()
}

/** Keep the state-specific part of a live frame name readable in compact canvas chrome. */
export function smylrLiveAppFrameDisplayName(name: string) {
  return name.replace(/^Live Smylr App\s*\/\s*/i, '').replace(/^.+?\s*\/\s*/, '')
}

/**
 * Zoom out so light + dark (or brand) boards fit with breathing room.
 * Never zoomToSelection on a single board after open — that crops the pair.
 */
async function fitDesignBoardsToViewport(store: EditorStore, focusIds: string[]) {
  const pageId = store.state.currentPageId
  if (!pageId || !store.graph.getNode(pageId)) {
    await store.fitCurrentPageToViewport()
    return
  }

  const ids =
    focusIds.length > 0
      ? focusIds.filter((id) => store.graph.getNode(id))
      : store.graph
          .getChildren(pageId)
          .filter((n) => n.width > 80 && n.height > 80)
          .map((n) => n.id)

  await fitSmylrPageToViewport(store, ids)
}

/**
 * Fit the whole page (or design boards) into the canvas.
 */
async function focusWorkspaceViewport(
  store: EditorStore,
  workspace: WorkspaceGraphResult,
  isDesignPage: boolean
) {
  if (isDesignPage) {
    await fitDesignBoardsToViewport(
      store,
      workspace.selectedFocusIds.length > 0
        ? workspace.selectedFocusIds
        : workspace.selectedFocusId
          ? [workspace.selectedFocusId]
          : []
    )
    return
  }

  if (workspace.selectedFocusId) {
    store.select([workspace.selectedFocusId])
  }
  await fitSmylrPageToViewport(store)
}

/** Stamp board-builder revision on the document root so the editor can re-seed. */
export function stampSmylrFoundationsRevision(store: EditorStore) {
  stampFoundationsRevision(store.graph)
}

function stampFoundationsRevision(graph: SceneGraph) {
  const root = graph.rootId ? graph.getNode(graph.rootId) : null
  if (!root) return
  const next = [
    ...root.pluginData.filter(
      (e) => !(e.pluginId === SMYLR_FOUNDATIONS_PLUGIN_ID && e.key === SMYLR_FOUNDATIONS_REV_KEY)
    ),
    {
      pluginId: SMYLR_FOUNDATIONS_PLUGIN_ID,
      key: SMYLR_FOUNDATIONS_REV_KEY,
      value: SMYLR_FOUNDATIONS_REVISION
    }
  ]
  graph.updateNode(root.id, { pluginData: next })
}

export function getSmylrFoundationsRevision(store: EditorStore): string | undefined {
  void store.state.sceneVersion
  const root = store.graph.rootId ? store.graph.getNode(store.graph.rootId) : null
  if (!root) return undefined
  return root.pluginData.find(
    (e) => e.pluginId === SMYLR_FOUNDATIONS_PLUGIN_ID && e.key === SMYLR_FOUNDATIONS_REV_KEY
  )?.value
}

/** True when boards were built by an older builder and should be re-opened. */
export function isSmylrFoundationsStale(store: EditorStore): boolean {
  if (!hasSmylrProductionWorkspace(store)) return true
  return getSmylrFoundationsRevision(store) !== SMYLR_FOUNDATIONS_REVISION
}

function findFoundationsPage(store: EditorStore, pageId: string): SceneNode | null {
  for (const page of store.graph.getPages()) {
    const kind = pluginValue(page, 'kind')
    const id = pluginValue(page, 'pageId')
    if (id === pageId) return page
    if (pageId === SMYLR_TOKENS_PAGE_ID && kind === SMYLR_TOKENS_PAGE_KIND) return page
    if (pageId === SMYLR_BRAND_PAGE_ID && kind === SMYLR_BRAND_PAGE_KIND) return page
  }
  return null
}

/**
 * Live-edit path: rebuild foundations boards **in place**.
 * - no replaceGraph
 * - no window reload
 * - optionally keep pan/zoom (HMR “just show the change”)
 */
export async function refreshSmylrFoundationsBoardsInPlace(
  store: EditorStore,
  options: WorkspaceOptions = {}
): Promise<boolean> {
  if (!hasSmylrProductionWorkspace(store)) return false

  const pageId = options.selectedPageId
  const preserveViewport = options.preserveViewport !== false
  let touched = false

  const dentalFlowPage = store.graph
    .getPages()
    .find(
      (page) =>
        pluginValue(page, 'kind') === 'smylr-flow-page' &&
        pluginValue(page, 'pageId') === 'dental-chart'
    )
  if (dentalFlowPage) {
    const flowResult = syncDentalChartAppFlowScene(store.graph, dentalFlowPage.id)
    if (flowResult.changed) {
      computeAllLayouts(store.graph, dentalFlowPage.id)
      touched = true
    }
  }

  // Only refresh the page you're looking at (or both if unspecified).
  const targets: Array<'tokens' | 'brand'> =
    pageId === SMYLR_BRAND_PAGE_ID
      ? ['brand']
      : pageId === SMYLR_TOKENS_PAGE_ID
        ? ['tokens']
        : pageId
          ? pageId === SMYLR_TOKENS_PAGE_ID
            ? ['tokens']
            : pageId === SMYLR_BRAND_PAGE_ID
              ? ['brand']
              : ['tokens']
          : ['tokens', 'brand']

  // Freeze camera
  const savedZoom = store.state.zoom
  const savedPanX = store.state.panX
  const savedPanY = store.state.panY

  await yieldAnimationFrames(1)

  // Prefer the page currently open when smylr-page matches / is unset
  for (const target of targets) {
    const wantId = target === 'tokens' ? SMYLR_TOKENS_PAGE_ID : SMYLR_BRAND_PAGE_ID
    const page = findFoundationsPage(store, wantId)
    if (!page) continue

    // Only rebuild if this is the current page (when preserving viewport)
    // or always when force multi-target.
    if (preserveViewport && page.id !== store.state.currentPageId && targets.length > 1) {
      // Still update the other foundations page quietly without switching camera.
    }

    const selectedBefore = [...store.state.selectedIds]
    store.select([])

    const children = [...store.graph.getChildren(page.id)]
    for (const child of children) {
      try {
        store.graph.deleteNode(child.id)
      } catch (err) {
        console.warn('[refresh foundations] delete child', child.id, err)
      }
    }

    // Dynamic import every time so Vite HMR delivers the NEW module
    // (static imports stay frozen on the first version after page load).
    if (target === 'tokens') {
      const mod = await import('./create-tokens-page')
      mod.createSmylrTokensDesignPage(store.graph, page)
    } else {
      const mod = await import('./create-brand-page')
      mod.createSmylrBrandDesignPage(store.graph, page)
    }
    touched = true

    // Restore selection only if nodes still exist (usually not after rebuild)
    const still = selectedBefore.filter((id) => store.graph.getNode(id))
    if (still.length) store.select(still)
  }

  if (!touched) return false

  stampFoundationsRevision(store.graph)
  computeAllLayouts(store.graph, store.state.currentPageId)

  // Keep tool + camera — this is the "don't reload the canvas" part.
  if (preserveViewport) {
    if (Number.isFinite(savedZoom) && savedZoom > 0.02) {
      store.state.zoom = savedZoom
      store.state.panX = savedPanX
      store.state.panY = savedPanY
    }
  } else {
    store.setTool('SELECT')
    const boards = store.graph
      .getChildren(store.state.currentPageId)
      .filter((n) => {
        const k = pluginValue(n, 'kind')
        return (
          k === SMYLR_TOKENS_LIGHT_BOARD_KIND ||
          k === SMYLR_TOKENS_DARK_BOARD_KIND ||
          k === SMYLR_BRAND_BOARD_KIND
        )
      })
      .map((n) => n.id)
    try {
      await fitDesignBoardsToViewport(store, boards)
    } catch {
      /* ignore */
    }
  }

  store.requestRender?.()
  store.requestRepaint?.()
  return true
}

export async function openSmylrProductionWorkspace(
  store: EditorStore,
  options: WorkspaceOptions = {}
) {
  const workspace = createSmylrProductionWorkspaceGraph(options)
  const isDesignPage = DESIGN_PAGE_IDS.has(options.selectedPageId ?? '')

  stampFoundationsRevision(workspace.graph)

  // Pause a frame so HMR / renderer aren't mid-draw when we swap the graph.
  await yieldAnimationFrames(1)

  store.state.documentName = 'Smylr Production Canvas'
  try {
    await loadLiveFrameTombstones()
    applyLiveFrameTombstones(workspace.graph)
    store.replaceGraph(workspace.graph)
  } catch (err) {
    console.error('[openSmylrProductionWorkspace] replaceGraph failed', err)
    throw err
  }
  store.undo.clear()

  await yieldAnimationFrames(1)
  await store.switchPage(workspace.selectedPageNodeId)

  if (workspace.selectedFocusIds.length > 0) {
    store.select(workspace.selectedFocusIds)
  } else if (workspace.selectedFocusId) {
    store.select([workspace.selectedFocusId])
  }

  // A newly opened production workspace starts in the editor's default Move
  // mode. Container selection remains an explicit user choice.
  store.setTool('SELECT')

  try {
    await focusWorkspaceViewport(store, workspace, isDesignPage)
  } catch (err) {
    // Zoom helpers can throw if viewport size is 0 mid-HMR — non-fatal.
    console.warn('[openSmylrProductionWorkspace] viewport fit skipped', err)
    try {
      await store.fitCurrentPageToViewport()
    } catch {
      /* ignore */
    }
  }
  return workspace
}

/**
 * Switch to a production / foundations page if the graph already has it.
 * Returns false when the page is missing (caller should re-open workspace).
 */
export async function switchSmylrProductionPage(
  store: EditorStore,
  pageId: string | undefined
): Promise<boolean> {
  if (!pageId) return false
  void store.state.sceneVersion

  for (const page of store.graph.getPages()) {
    const kind = pluginValue(page, 'kind')
    const id = pluginValue(page, 'pageId')
    const isMatch =
      id === pageId ||
      (pageId === SMYLR_TOKENS_PAGE_ID && kind === SMYLR_TOKENS_PAGE_KIND) ||
      (pageId === SMYLR_BRAND_PAGE_ID && kind === SMYLR_BRAND_PAGE_KIND) ||
      (kind === 'smylr-production-page' && id === pageId)
    if (!isMatch) continue

    await store.switchPage(page.id)

    if (DESIGN_PAGE_IDS.has(pageId)) {
      const boardIds = store.graph
        .getChildren(page.id)
        .filter((n) => {
          const k = pluginValue(n, 'kind')
          return (
            k === SMYLR_TOKENS_LIGHT_BOARD_KIND ||
            k === SMYLR_TOKENS_DARK_BOARD_KIND ||
            k === SMYLR_BRAND_BOARD_KIND ||
            k === 'smylr-tokens-board' ||
            k === 'smylr-brand-board'
          )
        })
        .map((n) => n.id)
      store.setTool('SELECT')
      await fitDesignBoardsToViewport(store, boardIds)
      return true
    }

    const focus =
      store.graph
        .getChildren(page.id)
        .find((n) =>
          n.pluginData.some(
            (e) => e.pluginId === PLUGIN_ID && e.key === 'kind' && e.value === LIVE_APP_KIND
          )
        ) ?? store.graph.getChildren(page.id).at(0)

    if (focus) {
      store.select([focus.id])
    }

    await fitSmylrPageToViewport(store)
    return true
  }
  return false
}

export function findCurrentSmylrLiveAppFrame(store: EditorStore): SceneNode | null {
  void store.state.currentPageId
  void store.state.sceneVersion

  return (
    store.graph
      .getChildren(store.state.currentPageId)
      .find(
        (node) => isSmylrLiveAppFrameNode(node) && smylrLiveAppFrameState(node) === 'current'
      ) ?? null
  )
}

export function findSmylrLiveAppFrames(store: EditorStore): SceneNode[] {
  void store.state.currentPageId
  void store.state.sceneVersion
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) => isSmylrLiveAppFrameNode(node))
}

export function smylrLiveAppFrameState(node: SceneNode): string {
  return pluginValue(node, 'state') ?? 'current'
}

export function smylrLiveAppFrameWorkspaceItemId(node: SceneNode): string | null {
  return pluginValue(node, 'workspaceItemId') ?? null
}

export function findSmylrAppViewPage(
  store: EditorStore,
  route: string,
  view: SmylrAppViewKind
): SceneNode | null {
  const kind = view === 'flow' ? 'smylr-flow-page' : 'smylr-production-page'
  return (
    store.graph
      .getPages()
      .find((page) => pluginValue(page, 'kind') === kind && pluginValue(page, 'route') === route) ??
    null
  )
}

const WORKSPACE_FRAME_MANAGED_KEYS = new Set([
  'branch',
  'branchStatus',
  'flowId',
  'flowIndex',
  'flowNextIds',
  'flowPreviousId',
  'flowTransition',
  'status',
  'workspaceKind'
])

function workspaceFramePluginData(item: SmylrWorkspaceFrameItem) {
  return [
    pluginData('status', item.status),
    pluginData('workspaceKind', item.kind),
    pluginData('branch', item.branch?.name ?? ''),
    pluginData('branchStatus', item.branch?.status ?? 'not-started'),
    pluginData('flowId', item.flow?.flowId ?? ''),
    pluginData('flowIndex', String(item.flow?.index ?? '')),
    pluginData('flowPreviousId', item.flow?.previousId ?? ''),
    pluginData('flowNextIds', (item.flow?.nextIds ?? []).join(',')),
    pluginData('flowTransition', item.flow?.transition ?? '')
  ]
}

function updateWorkspaceFrame(
  store: EditorStore,
  existing: SceneNode,
  item: SmylrWorkspaceFrameItem
): SceneNode {
  store.graph.updateNode(existing.id, {
    name: item.name,
    pluginData: [
      ...existing.pluginData.filter(
        (entry) => !(entry.pluginId === PLUGIN_ID && WORKSPACE_FRAME_MANAGED_KEYS.has(entry.key))
      ),
      ...workspaceFramePluginData(item)
    ]
  })
  return store.graph.getNode(existing.id) ?? existing
}

function workspaceFrameX(
  frames: SceneNode[],
  current: SceneNode,
  item: SmylrWorkspaceFrameItem,
  isFlowView: boolean
) {
  if (!isFlowView || !item.flow) {
    return Math.max(...frames.map((frame) => frame.x + frame.width)) + LIVE_APP_FRAME_GAP
  }
  const baseFrames = frames.filter((frame) => !smylrLiveAppFrameWorkspaceItemId(frame))
  const baseRightEdge = Math.max(...baseFrames.map((frame) => frame.x + frame.width))
  return (
    baseRightEdge +
    LIVE_APP_FRAME_GAP +
    (item.flow.index ?? 0) * (current.width + LIVE_APP_FRAME_GAP)
  )
}

export function ensureSmylrAlternateLiveAppFrameOnPage(
  store: EditorStore,
  item: SmylrWorkspaceFrameItem,
  pageId: string
): SceneNode | null {
  if (isWorkspaceItemTombstoned(item.id)) return null
  const pageNode = store.graph.getNode(pageId)
  const isFlowView = isSmylrFlowPageNode(pageNode)
  if (isFlowView && pageNode && pluginValue(pageNode, 'flowSchemaVersion')) return null
  if (isFlowView && !item.flow) return null
  if (pageNode && pluginValue(pageNode, 'route') !== item.route) return null
  const frames = store.graph.getChildren(pageId).filter(isSmylrLiveAppFrameNode)
  const existing = frames.find((frame) => smylrLiveAppFrameWorkspaceItemId(frame) === item.id)
  if (existing) return updateWorkspaceFrame(store, existing, item)
  const current = frames.find((frame) => smylrLiveAppFrameState(frame) === 'current')
  if (!current || smylrLiveAppFrameRoute(current) !== item.route) return null
  const frame = store.graph.createNode('FRAME', pageId, {
    x: workspaceFrameX(frames, current, item, isFlowView),
    y: current.y,
    width: current.width,
    height: current.height,
    name: item.name,
    cornerRadius: current.cornerRadius,
    clipsContent: true,
    fills: [],
    strokes: [],
    pluginData: [
      pluginData('kind', LIVE_APP_KIND),
      pluginData('pageId', pluginValue(current, 'pageId') ?? ''),
      pluginData('route', item.route),
      pluginData('state', item.id),
      pluginData('workspaceItemId', item.id),
      ...workspaceFramePluginData(item)
    ]
  })
  store.requestRender()
  return frame
}

export function ensureSmylrAlternateLiveAppFrame(
  store: EditorStore,
  item: SmylrWorkspaceFrameItem
): SceneNode | null {
  return ensureSmylrAlternateLiveAppFrameOnPage(store, item, store.state.currentPageId)
}

export function smylrLiveAppFrameRoute(node: SceneNode): string {
  return pluginValue(node, 'route') ?? SMYLR_PRODUCTION_PAGES[0].route
}

export function hasSmylrProductionWorkspace(store: EditorStore): boolean {
  for (const node of store.graph.getAllNodes()) {
    if (isSmylrLiveAppFrameNode(node)) return true
    if (
      node.pluginData.some(
        (entry) =>
          entry.pluginId === PLUGIN_ID &&
          entry.key === 'kind' &&
          (entry.value === SMYLR_TOKENS_PAGE_KIND || entry.value === SMYLR_BRAND_PAGE_KIND)
      )
    ) {
      return true
    }
  }
  return false
}

export { SMYLR_TOKENS_PAGE_ID, SMYLR_BRAND_PAGE_ID, SMYLR_FOUNDATIONS_REVISION }
