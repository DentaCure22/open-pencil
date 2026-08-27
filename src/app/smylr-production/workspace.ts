import {
  SMYLR_CODE_OBJECT_FRAME_KIND,
  SMYLR_PRODUCTION_PLUGIN_ID as PLUGIN_ID
} from '@open-pencil/core/code-object'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  codeObjectDocument,
  createSmylrProductionAppDocument,
  setCodeObjectDocument
} from '@/app/code-object/model'
import { DEFAULT_CODE_OBJECT_RADIUS } from '@/app/code-object/transform'

import type { EditorStore } from '../editor/session'
import { editorViewportInsets } from '../editor/viewport-insets'
import {
  createSidebarBoard,
  createSidebarPage,
  moveSidebarBoard,
  orderedSidebarBoards,
  removeSidebarPage,
  renameSidebarBoard,
  resolveSidebarWorkspace,
  sidebarWorkspacePluginData,
  SMYLR_PROJECT_ID
} from '../sidebar-workspace/tree'
import {
  loadOpenPencilWorkspaceIdentity,
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  stampOpenPencilWorkspaceIdentity
} from '../workspace-document/identity'
import { syncAppScreenFlowCodeObjects } from './app-flow/code-objects'
import {
  DENTAL_CHART_APP_FLOW,
  PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
  SMYLR_DURABLE_APP_FLOW_DEFINITIONS,
  type AppScreenFlowDefinition
} from './app-flow/model'
import {
  syncAppScreenFlowScene,
  syncDentalChartAppFlowScene,
  syncProductMapDentalChartAppFlowScene
} from './app-flow/scene'
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
import {
  SMYLR_PRODUCTION_PAGES,
  SMYLR_RETIRED_PRODUCTION_PAGE_IDS,
  smylrProductionPageById,
  type SmylrProductionPage
} from './pages'
import { syncTechnicalFlowScene, TECHNICAL_FLOW_SAVE_FINDING_ID } from './technical-flow'
import { yieldAnimationFrames } from './yield-frames'

const CODE_OBJECT_FRAME_WIDTH = 1280
const CODE_OBJECT_FRAME_HEIGHT = 900
const FLOW_PAGE_SUFFIX = ' — Flow'
export const SMYLR_PRODUCT_MAP_PAGE_KIND = 'smylr-product-map-page'
export const SMYLR_PRODUCT_MAP_PAGE_ID = PRODUCT_MAP_DENTAL_CHART_APP_FLOW.pageId
export const SMYLR_PRODUCT_MAP_PAGE_NAME = PRODUCT_MAP_DENTAL_CHART_APP_FLOW.label
export const SMYLR_PRODUCT_MAP_PROJECT_NAME = 'Maps & Flows'

type WorkspaceOptions = {
  selectedPageId?: string
  /** Live HMR: keep pan/zoom (no fit / no camera jump). */
  preserveViewport?: boolean
}

type WorkspaceGraphResult = {
  graph: SceneGraph
  selectedPageId: string
  selectedPageNodeId: string
  selectedCodeObjectFrameId: string
  selectedFocusId: string
  /** Multi-board pages (light + dark) — select all for fit-to-view */
  selectedFocusIds: string[]
}

export type SmylrAppViewKind = 'current' | 'flow'

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

export function isSmylrCodeObjectFrame(node: SceneNode | null | undefined): boolean {
  const component = codeObjectDocument(node)?.component
  return Boolean(
    node &&
    pluginValue(node, 'kind') === SMYLR_CODE_OBJECT_FRAME_KIND &&
    (component === 'smylr-flow-screen' || component === 'smylr-production-app')
  )
}

export function isSmylrProductionAppCodeObjectFrame(node: SceneNode | null | undefined): boolean {
  return Boolean(
    node &&
    pluginValue(node, 'kind') === SMYLR_CODE_OBJECT_FRAME_KIND &&
    codeObjectDocument(node)?.component === 'smylr-production-app'
  )
}

export function resolveSmylrProductionIframeAnchor(
  graph: SceneGraph,
  pageId: string
): SceneNode | null {
  let anchor: SceneNode | null = null
  let anchorArea = -1
  for (const node of graph.getDescendants(pageId)) {
    if (!isSmylrProductionAppCodeObjectFrame(node)) continue
    const area = node.width * node.height
    if (area <= anchorArea) continue
    anchor = node
    anchorArea = area
  }
  return anchor
}

export function smylrProductionAppPageId(node: SceneNode | null | undefined): string | undefined {
  const pageId = node ? pluginValue(node, 'pageId') : undefined
  return pageId?.trim() || undefined
}

export function isSmylrFlowPageNode(node: SceneNode | null | undefined): boolean {
  const kind = node ? pluginValue(node, 'kind') : undefined
  return kind === 'smylr-flow-page' || kind === SMYLR_PRODUCT_MAP_PAGE_KIND
}

function createCodeObjectPage(graph: SceneGraph, page: SmylrProductionPage, pageNode: SceneNode) {
  graph.updateNode(pageNode.id, {
    name: page.label,
    pluginData: [
      pluginData('kind', 'smylr-production-page'),
      pluginData('pageId', page.id),
      pluginData('route', page.route)
    ]
  })

  return createProductionCodeObjectFrame(graph, page, pageNode)
}

function productionCodeObjectDocument(page: SmylrProductionPage, frame: SceneNode) {
  const created = createSmylrProductionAppDocument({
    label: `${page.label} / Current`,
    route: page.route
  })
  const current = codeObjectDocument(frame)
  return current?.component === 'smylr-production-app' &&
    current.route === created.route &&
    current.label === created.label
    ? { ...created, state: current.state }
    : created
}

function createProductionCodeObjectFrame(
  graph: SceneGraph,
  page: SmylrProductionPage,
  pageNode: SceneNode
) {
  const frame = graph.createNode('FRAME', pageNode.id, {
    x: 96,
    y: 88,
    width: CODE_OBJECT_FRAME_WIDTH,
    height: CODE_OBJECT_FRAME_HEIGHT,
    name: `${page.label} / Current`,
    cornerRadius: DEFAULT_CODE_OBJECT_RADIUS,
    clipsContent: true,
    fills: [],
    strokes: [],
    pluginData: [
      pluginData('kind', SMYLR_CODE_OBJECT_FRAME_KIND),
      pluginData('pageId', page.id),
      pluginData('route', page.route),
      pluginData('state', 'current')
    ]
  })
  setCodeObjectDocument(graph, frame.id, productionCodeObjectDocument(page, frame))
  return frame.id
}

function ensureProductionCodeObjectFrame(
  graph: SceneGraph,
  page: SmylrProductionPage,
  pageNode: SceneNode
): boolean {
  const pageNodes = [...graph.getDescendants(pageNode.id)]
  const managedFrames = pageNodes.filter(
    (candidate) =>
      candidate.type === 'FRAME' &&
      pluginValue(candidate, 'pageId') === page.id &&
      pluginValue(candidate, 'state') === 'current'
  )
  const nestedManagedFrame = managedFrames.find((candidate) => candidate.parentId !== pageNode.id)
  const frame =
    nestedManagedFrame ??
    managedFrames.at(0) ??
    pageNodes.find(
      (candidate) => candidate.type === 'FRAME' && candidate.name === `${page.label} / Current`
    )
  if (!frame) {
    createProductionCodeObjectFrame(graph, page, pageNode)
    return true
  }

  const expectedPluginData = [
    pluginData('kind', SMYLR_CODE_OBJECT_FRAME_KIND),
    pluginData('pageId', page.id),
    pluginData('route', page.route),
    pluginData('state', 'current')
  ]
  const nextPluginData = [
    ...expectedPluginData,
    ...frame.pluginData.filter((entry) => entry.pluginId !== PLUGIN_ID)
  ]
  let changed = false
  for (const duplicate of managedFrames.filter((candidate) => candidate.id !== frame.id)) {
    graph.deleteNode(duplicate.id)
    changed = true
  }
  if (
    frame.name !== `${page.label} / Current` ||
    frame.cornerRadius !== DEFAULT_CODE_OBJECT_RADIUS ||
    !frame.clipsContent ||
    JSON.stringify(frame.pluginData) !== JSON.stringify(nextPluginData)
  ) {
    graph.updateNode(frame.id, {
      name: `${page.label} / Current`,
      cornerRadius: DEFAULT_CODE_OBJECT_RADIUS,
      clipsContent: true,
      pluginData: nextPluginData
    })
    changed = true
  }
  const current = graph.getNode(frame.id)
  const expectedDocument = current ? productionCodeObjectDocument(page, current) : null
  if (
    current &&
    expectedDocument &&
    JSON.stringify(codeObjectDocument(current)) !== JSON.stringify(expectedDocument)
  ) {
    setCodeObjectDocument(graph, current.id, expectedDocument)
    changed = true
  }
  return changed
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

function appFlowPagePluginData(definition: AppScreenFlowDefinition): SceneNode['pluginData'] {
  return [
    pluginData('kind', 'smylr-flow-page'),
    pluginData('pageId', definition.pageId),
    pluginData('route', definition.route),
    pluginData('flowId', definition.id),
    pluginData('flowSchemaVersion', definition.schemaVersion),
    pluginData('flowSourceFile', definition.sourceFile),
    pluginData('flowSourceFormat', 'markdown')
  ]
}

function appFlowPageByDefinition(
  graph: SceneGraph,
  definition: AppScreenFlowDefinition
): SceneNode | null {
  return (
    graph.getPages().find((page) => pluginValue(page, 'flowId') === definition.id) ??
    graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === 'smylr-flow-page' &&
          pluginValue(page, 'pageId') === definition.pageId
      ) ??
    graph.getPages().find((page) => page.name === definition.label) ??
    null
  )
}

function ensureAppFlowPageMetadata(
  graph: SceneGraph,
  page: SceneNode,
  definition: AppScreenFlowDefinition
): boolean {
  const expectedPluginData = appFlowPagePluginData(definition)
  const managedKeys = new Set(expectedPluginData.map((entry) => entry.key))
  const managedEntries = page.pluginData.filter(
    (entry) => entry.pluginId === PLUGIN_ID && managedKeys.has(entry.key)
  )
  const metadataMatches =
    managedEntries.length === expectedPluginData.length &&
    expectedPluginData.every((expected) =>
      managedEntries.some(
        (actual) => actual.key === expected.key && actual.value === expected.value
      )
    )
  if (page.name === definition.label && metadataMatches) return false

  graph.updateNode(page.id, {
    name: definition.label,
    pluginData: [
      ...page.pluginData.filter(
        (entry) => !(entry.pluginId === PLUGIN_ID && managedKeys.has(entry.key))
      ),
      ...expectedPluginData
    ]
  })
  return true
}

function syncAppFlowPage(
  graph: SceneGraph,
  page: SceneNode,
  definition: AppScreenFlowDefinition
): boolean {
  const metadataChanged = ensureAppFlowPageMetadata(graph, page, definition)
  const synced = syncAppScreenFlowScene(graph, page.id, definition)
  return metadataChanged || synced.changed
}

function createDurableAppFlowPage(
  graph: SceneGraph,
  definition: AppScreenFlowDefinition
): SceneNode {
  const page = graph.addPage(definition.label)
  if (definition.id === TECHNICAL_FLOW_SAVE_FINDING_ID) {
    syncTechnicalFlowScene(graph, page.id, definition)
  } else {
    syncAppFlowPage(graph, page, definition)
  }
  return graph.getNode(page.id) ?? page
}

function syncCodeObjectFlowBoards(graph: SceneGraph): boolean {
  const definitions = [
    DENTAL_CHART_APP_FLOW,
    PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
    ...SMYLR_DURABLE_APP_FLOW_DEFINITIONS.filter(
      (definition) => definition.id !== TECHNICAL_FLOW_SAVE_FINDING_ID
    )
  ]
  let changed = false
  for (const definition of definitions) {
    const page =
      definition.id === PRODUCT_MAP_DENTAL_CHART_APP_FLOW.id
        ? productMapPageByIdentity(graph)
        : appFlowPageByDefinition(graph, definition)
    if (!page) continue
    const result = syncAppScreenFlowCodeObjects(graph, page.id, definition)
    changed ||= result.changed
  }
  return changed
}

function productMapPagePluginData(): SceneNode['pluginData'] {
  return [
    pluginData('kind', SMYLR_PRODUCT_MAP_PAGE_KIND),
    pluginData('pageId', SMYLR_PRODUCT_MAP_PAGE_ID),
    pluginData('route', PRODUCT_MAP_DENTAL_CHART_APP_FLOW.route)
  ]
}

function productMapPageByIdentity(graph: SceneGraph): SceneNode | null {
  return (
    graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === SMYLR_PRODUCT_MAP_PAGE_KIND &&
          pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID
      ) ??
    graph.getPages().find((page) => page.name === SMYLR_PRODUCT_MAP_PAGE_NAME) ??
    null
  )
}

function ensureProductMapPageMetadata(graph: SceneGraph, page: SceneNode): boolean {
  const managedKeys = new Set(['kind', 'pageId', 'route'])
  const expectedPluginData = productMapPagePluginData()
  const managedEntries = page.pluginData.filter(
    (entry) => entry.pluginId === PLUGIN_ID && managedKeys.has(entry.key)
  )
  const metadataMatches =
    managedEntries.length === expectedPluginData.length &&
    expectedPluginData.every((expected) =>
      managedEntries.some(
        (actual) => actual.key === expected.key && actual.value === expected.value
      )
    )
  if (page.name === SMYLR_PRODUCT_MAP_PAGE_NAME && metadataMatches) return false

  const nextPluginData = [
    ...page.pluginData.filter(
      (entry) => !(entry.pluginId === PLUGIN_ID && managedKeys.has(entry.key))
    ),
    ...expectedPluginData
  ]
  graph.updateNode(page.id, { name: SMYLR_PRODUCT_MAP_PAGE_NAME, pluginData: nextPluginData })
  return true
}

function removeLegacyProductMapProjection(graph: SceneGraph, pageId: string): boolean {
  let changed = false
  for (const child of graph.getChildren(pageId)) {
    const isLegacyCapture = child.name.startsWith('Saved capture ·')
    const isLegacyConnector = child.name === 'Line'
    const isLegacyMermaid = child.name === 'Mermaid diagram'
    if (!isLegacyCapture && !isLegacyConnector && !isLegacyMermaid) continue
    graph.deleteNode(child.id)
    changed = true
  }
  return changed
}

function syncProductMapPage(graph: SceneGraph, page: SceneNode): boolean {
  const removedLegacy = removeLegacyProductMapProjection(graph, page.id)
  const synced = syncProductMapDentalChartAppFlowScene(graph, page.id)
  return removedLegacy || synced.changed
}

function createProductMapCanvasPage(graph: SceneGraph): SceneNode {
  const page = graph.addPage(SMYLR_PRODUCT_MAP_PAGE_NAME)
  graph.updateNode(page.id, { pluginData: productMapPagePluginData() })
  syncProductMapPage(graph, page)
  return graph.getNode(page.id) ?? page
}

type ManagedFlowBoard = {
  label: string
  pageId: string
}

function ensureMapsAndFlowsSidebarPlacement(
  graph: SceneGraph,
  managedBoards: ManagedFlowBoard[]
): boolean {
  const root = graph.getNode(graph.rootId)
  if (!root) return false

  const resolution = resolveSidebarWorkspace(graph)
  let workspace = resolution.workspace
  const smylrProject = workspace.pages.find((page) => page.id === SMYLR_PROJECT_ID)
  if (!smylrProject) return false

  let project = workspace.pages.find(
    (page) => page.parentId === smylrProject.id && page.name === SMYLR_PRODUCT_MAP_PROJECT_NAME
  )
  if (!project) {
    const created = createSidebarPage(workspace, {
      name: SMYLR_PRODUCT_MAP_PROJECT_NAME,
      parentId: smylrProject.id
    })
    workspace = created.workspace
    project = created.page
  }

  for (const managedBoard of managedBoards) {
    let board = workspace.boards.find((candidate) => candidate.pageId === managedBoard.pageId)
    if (!board) {
      workspace = createSidebarBoard(workspace, {
        icon: 'flow',
        label: managedBoard.label,
        pageId: managedBoard.pageId,
        parentPageId: project.id
      })
      board = workspace.boards.find((candidate) => candidate.pageId === managedBoard.pageId)
    }
    if (!board) continue

    if (board.parentPageId !== project.id) {
      workspace = moveSidebarBoard(
        workspace,
        managedBoard.pageId,
        project.id,
        orderedSidebarBoards(workspace, project.id).length
      )
    }
    const currentBoard = workspace.boards.find(
      (candidate) => candidate.pageId === managedBoard.pageId
    )
    if (currentBoard && currentBoard.label !== managedBoard.label) {
      workspace = renameSidebarBoard(workspace, managedBoard.pageId, managedBoard.label)
    }
  }

  for (const legacyProject of workspace.pages.filter(
    (page) => page.parentId === null && page.name === SMYLR_PRODUCT_MAP_PROJECT_NAME
  )) {
    const isEmpty =
      !workspace.boards.some((board) => board.parentPageId === legacyProject.id) &&
      !workspace.pages.some((page) => page.parentId === legacyProject.id)
    if (isEmpty) workspace = removeSidebarPage(workspace, legacyProject.id)
  }

  const nextPluginData = sidebarWorkspacePluginData(root, workspace)
  const changed =
    resolution.changed || JSON.stringify(root.pluginData) !== JSON.stringify(nextPluginData)
  if (changed) graph.updateNode(root.id, { pluginData: nextPluginData })
  return changed
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
  let selectedCodeObjectFrameId = ''
  let selectedFocusId = ''
  let selectedFocusIds: string[] = []

  SMYLR_PRODUCTION_PAGES.forEach((page, index) => {
    const pageNode = index === 0 ? firstPageNode : graph.addPage(page.label)
    const codeObjectFrameId = createCodeObjectPage(graph, page, pageNode)
    createFlowCanvasPage(graph, page)

    if (!wantsDesignPage && page.id === selectedPage.id) {
      selectedPageNodeId = pageNode.id
      selectedCodeObjectFrameId = codeObjectFrameId
      selectedFocusId = codeObjectFrameId
      selectedFocusIds = [codeObjectFrameId]
    }
  })

  // Foundations pages are ordinary native Boards.
  // Design System = semantic tokens board; Brand Guidelines = identity rules.
  const tokensPageNode = graph.addPage('Design System')
  const tokensBoardId = createSmylrTokensDesignPage(graph, tokensPageNode)

  const brandPageNode = graph.addPage('Brand Guidelines')
  const brandBoardId = createSmylrBrandDesignPage(graph, brandPageNode)

  const productMapPage = createProductMapCanvasPage(graph)
  const durableFlowPages = SMYLR_DURABLE_APP_FLOW_DEFINITIONS.map((definition) =>
    createDurableAppFlowPage(graph, definition)
  )
  ensureMapsAndFlowsSidebarPlacement(graph, [
    { label: SMYLR_PRODUCT_MAP_PAGE_NAME, pageId: productMapPage.id },
    ...durableFlowPages.map((page) => ({ label: page.name, pageId: page.id }))
  ])

  if (options.selectedPageId === SMYLR_TOKENS_PAGE_ID) {
    selectedPageNodeId = tokensPageNode.id
    selectedCodeObjectFrameId = ''
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
    selectedCodeObjectFrameId = ''
    selectedFocusId = brandBoardId
    selectedFocusIds = [brandBoardId]
  }

  computeAllLayouts(graph)

  return {
    graph,
    selectedPageId: wantsDesignPage ? (options.selectedPageId as string) : selectedPage.id,
    selectedPageNodeId,
    selectedCodeObjectFrameId,
    selectedFocusId,
    selectedFocusIds
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
    const insets = editorViewportInsets()
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
    const focusIds = workspace.selectedFocusIds.slice()
    if (focusIds.length === 0 && workspace.selectedFocusId) {
      focusIds.push(workspace.selectedFocusId)
    }
    await fitDesignBoardsToViewport(store, focusIds)
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

function removeRetiredProductionPages(store: EditorStore): boolean {
  let touched = false
  for (const page of store.graph.getPages()) {
    const kind = pluginValue(page, 'kind')
    const pageId = pluginValue(page, 'pageId')
    const managed = kind === 'smylr-production-page' || kind === 'smylr-flow-page'
    if (!managed || !pageId || !SMYLR_RETIRED_PRODUCTION_PAGE_IDS.has(pageId)) continue
    store.deletePage(page.id)
    touched = true
  }
  return touched
}

function ensureProductionPagePair(
  store: EditorStore,
  page: SmylrProductionPage
): { pageIds: string[]; touched: boolean } {
  let touched = false
  let currentPage = store.graph
    .getPages()
    .find(
      (candidate) =>
        pluginValue(candidate, 'kind') === 'smylr-production-page' &&
        pluginValue(candidate, 'pageId') === page.id
    )
  if (!currentPage) {
    currentPage = store.graph.addPage(page.label)
    createCodeObjectPage(store.graph, page, currentPage)
    touched = true
  } else if (ensureProductionCodeObjectFrame(store.graph, page, currentPage)) {
    touched = true
  }

  let flowPage = store.graph
    .getPages()
    .find(
      (candidate) =>
        pluginValue(candidate, 'kind') === 'smylr-flow-page' &&
        pluginValue(candidate, 'pageId') === page.id
    )
  if (!flowPage) {
    const flowPageId = createFlowCanvasPage(store.graph, page)
    flowPage = store.graph.getNode(flowPageId) ?? undefined
    touched = true
  }
  return { pageIds: [currentPage.id, ...(flowPage ? [flowPage.id] : [])], touched }
}

function ensureFoundationDesignPage(
  store: EditorStore,
  pageId: string,
  name: string,
  create: (graph: SceneGraph, page: SceneNode) => unknown
): { page: SceneNode; touched: boolean } {
  const existing = findFoundationsPage(store, pageId)
  if (existing) return { page: existing, touched: false }
  const page = store.graph.addPage(name)
  create(store.graph, page)
  return { page, touched: true }
}

function ensureProductMapWorkspacePage(store: EditorStore): { page: SceneNode; touched: boolean } {
  let page = productMapPageByIdentity(store.graph)
  let touched = false
  if (!page) {
    page = store.graph.addPage(SMYLR_PRODUCT_MAP_PAGE_NAME)
    touched = true
  }
  if (ensureProductMapPageMetadata(store.graph, page)) touched = true
  if (syncProductMapPage(store.graph, page)) touched = true
  return { page, touched }
}

function ensureDurableFlowPages(store: EditorStore): { pages: SceneNode[]; touched: boolean } {
  const pages: SceneNode[] = []
  let touched = false
  for (const definition of SMYLR_DURABLE_APP_FLOW_DEFINITIONS) {
    let page = appFlowPageByDefinition(store.graph, definition)
    if (!page) {
      page = createDurableAppFlowPage(store.graph, definition)
      touched = true
    } else {
      const changed =
        definition.id === TECHNICAL_FLOW_SAVE_FINDING_ID
          ? syncTechnicalFlowScene(store.graph, page.id, definition).changed
          : syncAppFlowPage(store.graph, page, definition)
      if (changed) {
        computeAllLayouts(store.graph, page.id)
        touched = true
      }
    }
    pages.push(page)
  }
  return { pages, touched }
}

function orderManagedWorkspacePages(store: EditorStore, managedPageIds: string[]): boolean {
  const root = store.graph.getNode(store.graph.rootId)
  if (!root) return false
  const managedIds = new Set(managedPageIds)
  const remainingPageIds = root.childIds.filter((id) => {
    const node = store.graph.getNode(id)
    return node?.type === 'CANVAS' && node.parentId === root.id && !managedIds.has(id)
  })
  const orderedPageIds = [...managedPageIds, ...remainingPageIds]
  const unchanged =
    orderedPageIds.length === root.childIds.length &&
    orderedPageIds.every((id, index) => root.childIds[index] === id)
  if (unchanged) return false
  store.graph.updateNode(root.id, { childIds: orderedPageIds })
  return true
}

/** Repair missing production pages without replacing user-authored ordinary boards. */
export function repairSmylrProductionWorkspaceStructure(store: EditorStore): boolean {
  if (!hasSmylrProductionWorkspace(store)) return false
  let touched = removeRetiredProductionPages(store)
  const productionPageIds: string[] = []

  for (const page of SMYLR_PRODUCTION_PAGES) {
    const result = ensureProductionPagePair(store, page)
    productionPageIds.push(...result.pageIds)
    if (result.touched) touched = true
  }

  const tokens = ensureFoundationDesignPage(
    store,
    SMYLR_TOKENS_PAGE_ID,
    'Design System',
    createSmylrTokensDesignPage
  )
  const brand = ensureFoundationDesignPage(
    store,
    SMYLR_BRAND_PAGE_ID,
    'Brand Guidelines',
    createSmylrBrandDesignPage
  )
  const productMap = ensureProductMapWorkspacePage(store)
  const durableFlows = ensureDurableFlowPages(store)
  productionPageIds.push(
    tokens.page.id,
    brand.page.id,
    productMap.page.id,
    ...durableFlows.pages.map((page) => page.id)
  )
  if (tokens.touched || brand.touched || productMap.touched || durableFlows.touched) touched = true
  const reorderedPages = orderManagedWorkspacePages(store, productionPageIds)
  if (reorderedPages) touched = true

  const sidebarChanged = ensureMapsAndFlowsSidebarPlacement(store.graph, [
    { label: SMYLR_PRODUCT_MAP_PAGE_NAME, pageId: productMap.page.id },
    ...durableFlows.pages.map((page) => ({ label: page.name, pageId: page.id }))
  ])
  if (sidebarChanged) touched = true

  return touched
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

type FoundationTarget = 'brand' | 'tokens'

function refreshFlowScenes(store: EditorStore): {
  durableFlowPages: Array<{ definition: AppScreenFlowDefinition; page: SceneNode }>
  productMapPage: SceneNode | null
  touched: boolean
} {
  let touched = false
  const dentalFlowPage = store.graph
    .getPages()
    .find(
      (page) =>
        pluginValue(page, 'kind') === 'smylr-flow-page' &&
        pluginValue(page, 'pageId') === 'dental-chart'
    )
  if (dentalFlowPage && syncDentalChartAppFlowScene(store.graph, dentalFlowPage.id).changed) {
    computeAllLayouts(store.graph, dentalFlowPage.id)
    touched = true
  }

  const productMapPage = productMapPageByIdentity(store.graph)
  if (productMapPage && syncProductMapPage(store.graph, productMapPage)) {
    computeAllLayouts(store.graph, productMapPage.id)
    touched = true
  }

  const durableFlowPages = SMYLR_DURABLE_APP_FLOW_DEFINITIONS.flatMap((definition) => {
    const page = appFlowPageByDefinition(store.graph, definition)
    if (!page) return []
    const changed =
      definition.id === TECHNICAL_FLOW_SAVE_FINDING_ID
        ? syncTechnicalFlowScene(store.graph, page.id, definition).changed
        : syncAppFlowPage(store.graph, page, definition)
    if (changed) {
      computeAllLayouts(store.graph, page.id)
      touched = true
    }
    return [{ definition, page }]
  })
  return { durableFlowPages, productMapPage, touched }
}

function foundationRefreshTargets(pageId?: string): FoundationTarget[] {
  if (pageId === SMYLR_BRAND_PAGE_ID) return ['brand']
  if (pageId) return ['tokens']
  return ['tokens', 'brand']
}

async function rebuildFoundationTarget(
  store: EditorStore,
  target: FoundationTarget
): Promise<boolean> {
  const pageId = target === 'tokens' ? SMYLR_TOKENS_PAGE_ID : SMYLR_BRAND_PAGE_ID
  const page = findFoundationsPage(store, pageId)
  if (!page) return false
  const selectedBefore = [...store.state.selectedIds]
  store.select([])
  for (const child of store.graph.getChildren(page.id)) {
    try {
      store.graph.deleteNode(child.id)
    } catch (error) {
      console.warn('[refresh foundations] delete child', child.id, error)
    }
  }

  if (target === 'tokens') {
    const module = await import('./create-tokens-page')
    module.createSmylrTokensDesignPage(store.graph, page)
  } else {
    const module = await import('./create-brand-page')
    module.createSmylrBrandDesignPage(store.graph, page)
  }
  const survivingSelection = selectedBefore.filter((id) => store.graph.getNode(id))
  if (survivingSelection.length) store.select(survivingSelection)
  return true
}

function currentFoundationBoardIds(store: EditorStore): string[] {
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) => {
      const kind = pluginValue(node, 'kind')
      return (
        kind === SMYLR_TOKENS_LIGHT_BOARD_KIND ||
        kind === SMYLR_TOKENS_DARK_BOARD_KIND ||
        kind === SMYLR_BRAND_BOARD_KIND
      )
    })
    .map((node) => node.id)
}

async function restoreFoundationsViewport(
  store: EditorStore,
  preserveViewport: boolean,
  saved: { panX: number; panY: number; zoom: number }
): Promise<void> {
  if (preserveViewport) {
    if (!Number.isFinite(saved.zoom) || saved.zoom <= 0.02) return
    store.state.zoom = saved.zoom
    store.state.panX = saved.panX
    store.state.panY = saved.panY
    return
  }
  store.setTool('SELECT')
  try {
    await fitDesignBoardsToViewport(store, currentFoundationBoardIds(store))
  } catch (error) {
    console.warn('[refreshSmylrFoundationsBoardsInPlace] viewport fit skipped', error)
  }
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
  const refreshedFlows = refreshFlowScenes(store)
  let touched = refreshedFlows.touched

  if (syncCodeObjectFlowBoards(store.graph)) touched = true

  if (
    refreshedFlows.productMapPage &&
    ensureMapsAndFlowsSidebarPlacement(store.graph, [
      { label: SMYLR_PRODUCT_MAP_PAGE_NAME, pageId: refreshedFlows.productMapPage.id },
      ...refreshedFlows.durableFlowPages.map(({ definition, page }) => ({
        label: definition.label,
        pageId: page.id
      }))
    ])
  ) {
    touched = true
  }

  const targets = foundationRefreshTargets(pageId)
  const savedViewport = {
    panX: store.state.panX,
    panY: store.state.panY,
    zoom: store.state.zoom
  }

  await yieldAnimationFrames(1)
  for (const target of targets) {
    if (await rebuildFoundationTarget(store, target)) touched = true
  }

  if (!touched) return false

  stampFoundationsRevision(store.graph)
  computeAllLayouts(store.graph, store.state.currentPageId)

  await restoreFoundationsViewport(store, preserveViewport, savedViewport)

  store.requestRender()
  store.requestRepaint()
  return true
}

export async function openSmylrProductionWorkspace(
  store: EditorStore,
  options: WorkspaceOptions = {}
) {
  const workspace = createSmylrProductionWorkspaceGraph(options)
  const isDesignPage = DESIGN_PAGE_IDS.has(options.selectedPageId ?? '')

  syncCodeObjectFlowBoards(workspace.graph)

  stampFoundationsRevision(workspace.graph)
  stampOpenPencilWorkspaceIdentity(workspace.graph, await loadOpenPencilWorkspaceIdentity())

  // Pause a frame so HMR / renderer aren't mid-draw when we swap the graph.
  await yieldAnimationFrames(1)

  store.state.documentName = OPENPENCIL_WORKSPACE_DOCUMENT_NAME
  try {
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
    } catch (fallbackError) {
      console.warn('[openSmylrProductionWorkspace] fallback viewport fit skipped', fallbackError)
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

    const pageNodes = [...store.graph.getDescendants(page.id)]
    const focus =
      pageNodes.find((n) =>
        n.pluginData.some(
          (e) =>
            e.pluginId === PLUGIN_ID && e.key === 'kind' && e.value === SMYLR_CODE_OBJECT_FRAME_KIND
        )
      ) ?? pageNodes.at(0)

    if (focus) {
      store.select([focus.id])
    }

    await fitSmylrPageToViewport(store)
    return true
  }
  return false
}

export function findCurrentSmylrCodeObjectFrame(store: EditorStore): SceneNode | null {
  void store.state.currentPageId
  void store.state.sceneVersion

  return (
    [...store.graph.getDescendants(store.state.currentPageId)].find(
      (node) => isSmylrCodeObjectFrame(node) && smylrCodeObjectFrameState(node) === 'current'
    ) ?? null
  )
}

export function findSmylrCodeObjectFrames(store: EditorStore): SceneNode[] {
  void store.state.currentPageId
  void store.state.sceneVersion
  return [...store.graph.getDescendants(store.state.currentPageId)].filter((node) =>
    isSmylrCodeObjectFrame(node)
  )
}

export function smylrCodeObjectFrameState(node: SceneNode): string {
  return pluginValue(node, 'state') ?? 'current'
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

export function smylrCodeObjectFrameRoute(node: SceneNode): string {
  return pluginValue(node, 'route') ?? SMYLR_PRODUCTION_PAGES[0].route
}

export function hasSmylrProductionWorkspace(store: EditorStore): boolean {
  for (const node of store.graph.getAllNodes()) {
    if (isSmylrCodeObjectFrame(node)) return true
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
