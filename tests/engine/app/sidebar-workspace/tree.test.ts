import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { defaultBoardIcon } from '@/app/sidebar-workspace/icons'
import {
  SIDEBAR_WORKSPACE_PLUGIN_ID,
  createSidebarBoard,
  createSidebarPage,
  hasMoreOrganizedSidebarHierarchy,
  moveSidebarBoard,
  moveSidebarPage,
  orderedSidebarBoards,
  orderedSidebarPages,
  removeSidebarPage,
  resolveSidebarWorkspace,
  sidebarWorkspacePluginData
} from '@/app/sidebar-workspace/tree'
import { ensureWorkspaceProjectionPage } from '@/app/workspace-ui/projection'

function persist(
  graph: SceneGraph,
  workspace: ReturnType<typeof resolveSidebarWorkspace>['workspace']
) {
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('missing document root')
  graph.updateNode(root.id, { pluginData: sidebarWorkspacePluginData(root, workspace) })
}

describe('sidebar Project and Board workspace', () => {
  test('migrates scene pages into logical Projects with movable Boards', () => {
    const graph = new SceneGraph()
    const scenePage = graph.getPages()[0]
    if (!scenePage) throw new Error('missing scene page')
    graph.updateNode(scenePage.id, { name: 'Dental Chart' })

    const { workspace, changed } = resolveSidebarWorkspace(graph)
    const logicalPage = orderedSidebarPages(workspace, null)[0]

    expect(changed).toBe(true)
    expect(logicalPage?.name).toBe('Dental Chart')
    expect(orderedSidebarBoards(workspace, logicalPage?.id ?? '')).toEqual([
      {
        icon: defaultBoardIcon('Main board Dental Chart', scenePage.id),
        label: 'Main board',
        order: 0,
        pageId: scenePage.id,
        parentPageId: logicalPage?.id
      }
    ])
  })

  test('groups generated Smylr pages as named Boards under one Project', () => {
    const graph = new SceneGraph()
    const dentalPage = graph.getPages()[0]
    if (!dentalPage) throw new Error('missing dental page')
    graph.updateNode(dentalPage.id, {
      name: 'Dental Chart',
      pluginData: [{ key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' }]
    })
    const flowPage = graph.addPage('Dental Chart · Flow')
    graph.updateNode(flowPage.id, {
      pluginData: [{ key: 'kind', pluginId: 'smylr-production', value: 'smylr-flow-page' }]
    })

    const { workspace } = resolveSidebarWorkspace(graph)
    const project = orderedSidebarPages(workspace, null)[0]

    expect(orderedSidebarPages(workspace, null).map((page) => page.name)).toEqual(['Smylr'])
    expect(orderedSidebarBoards(workspace, project?.id ?? '').map((board) => board.label)).toEqual([
      'Dental Chart',
      'Dental Chart · Flow'
    ])
  })

  test('persists the logical hierarchy on the document root', () => {
    const graph = new SceneGraph()
    const initial = resolveSidebarWorkspace(graph).workspace
    const rootPage = orderedSidebarPages(initial, null)[0]
    if (!rootPage) throw new Error('missing root page')
    const nested = createSidebarPage(initial, { name: 'Research', parentId: rootPage.id })
    persist(graph, nested.workspace)

    const restored = resolveSidebarWorkspace(graph)
    expect(restored.changed).toBe(false)
    expect(orderedSidebarPages(restored.workspace, rootPage.id).map((page) => page.name)).toEqual([
      'Research'
    ])
    const root = graph.getNode(graph.rootId)
    expect(root?.pluginData.some((entry) => entry.pluginId === SIDEBAR_WORKSPACE_PLUGIN_ID)).toBe(
      true
    )
  })

  test('prefers the same boards in a more organized local hierarchy during cloud migration', () => {
    const graph = new SceneGraph()
    const flat = resolveSidebarWorkspace(graph).workspace
    const root = orderedSidebarPages(flat, null)[0]
    if (!root) throw new Error('missing root page')
    const nested = createSidebarPage(flat, { name: 'Product Screens', parentId: root.id }).workspace

    expect(hasMoreOrganizedSidebarHierarchy(nested, flat)).toBe(true)
    expect(hasMoreOrganizedSidebarHierarchy(flat, nested)).toBe(false)

    const extraBoard = graph.addPage('Cloud-only board')
    const cloudWithExtraBoard = createSidebarBoard(flat, {
      pageId: extraBoard.id,
      parentPageId: root.id
    })
    expect(hasMoreOrganizedSidebarHierarchy(nested, cloudWithExtraBoard)).toBe(false)
  })

  test('keeps generated projection pages out of authored navigation and removes stale entries', () => {
    const graph = new SceneGraph()
    const basePage = graph.getPages()[0]
    if (!basePage) throw new Error('missing scene page')
    const initial = resolveSidebarWorkspace(graph).workspace
    const derived = ensureWorkspaceProjectionPage(graph, {
      basePageId: basePage.id,
      basePageName: basePage.name,
      kind: 'review',
      purpose: 'review',
      viewId: 'view-review-generated',
      workspaceId: 'workspace-generated'
    })
    const staleLogicalPageId = `sidebar-page:${derived.id}`
    persist(graph, {
      ...initial,
      boards: [
        ...initial.boards,
        {
          label: 'Version review',
          order: 0,
          pageId: derived.id,
          parentPageId: staleLogicalPageId
        }
      ],
      pages: [
        ...initial.pages,
        { id: staleLogicalPageId, name: derived.name, order: 1, parentId: null }
      ]
    })

    const resolved = resolveSidebarWorkspace(graph).workspace
    expect(resolved.boards.map((board) => board.pageId)).toEqual([basePage.id])
    expect(resolved.pages.some((page) => page.id === staleLogicalPageId)).toBe(false)
  })

  test('removes an orphaned generated Project after its scene Board is deleted', () => {
    const graph = new SceneGraph()
    const originalPage = graph.getPages()[0]
    if (!originalPage) throw new Error('missing scene page')
    const initial = resolveSidebarWorkspace(graph).workspace
    const orphanedProjectId = `sidebar-page:${originalPage.id}`
    persist(graph, initial)

    graph.deleteNode(originalPage.id)
    const replacement = graph.addPage('Replacement')
    const resolved = resolveSidebarWorkspace(graph).workspace

    expect(resolved.pages.some((page) => page.id === orphanedProjectId)).toBe(false)
    expect(resolved.boards.some((board) => board.pageId === replacement.id)).toBe(true)
  })

  test('keeps nested Projects when removing their orphaned generated parent', () => {
    const graph = new SceneGraph()
    const originalPage = graph.getPages()[0]
    if (!originalPage) throw new Error('missing scene page')
    const initial = resolveSidebarWorkspace(graph).workspace
    const orphanedProjectId = `sidebar-page:${originalPage.id}`
    const nested = createSidebarPage(initial, {
      name: 'Research',
      parentId: orphanedProjectId
    })
    persist(graph, nested.workspace)

    graph.deleteNode(originalPage.id)
    graph.addPage('Replacement')
    const resolved = resolveSidebarWorkspace(graph).workspace

    expect(resolved.pages.some((page) => page.id === orphanedProjectId)).toBe(false)
    expect(resolved.pages.find((page) => page.id === nested.page.id)?.parentId).toBeNull()
  })

  test('allows unlimited boards under one Project and moves them between Projects', () => {
    const graph = new SceneGraph()
    const initial = resolveSidebarWorkspace(graph).workspace
    const firstPage = orderedSidebarPages(initial, null)[0]
    if (!firstPage) throw new Error('missing first page')
    const secondPageResult = createSidebarPage(initial, { name: 'Patient experience' })
    const secondPage = secondPageResult.page
    const boardA = graph.addPage('Charting flow')
    const boardB = graph.addPage('Version review')
    let workspace = createSidebarBoard(secondPageResult.workspace, {
      pageId: boardA.id,
      parentPageId: firstPage.id
    })
    workspace = createSidebarBoard(workspace, {
      pageId: boardB.id,
      parentPageId: firstPage.id
    })
    workspace = moveSidebarBoard(workspace, boardB.id, secondPage.id, 0)

    expect(orderedSidebarBoards(workspace, firstPage.id).map((board) => board.pageId)).toContain(
      boardA.id
    )
    expect(orderedSidebarBoards(workspace, secondPage.id).map((board) => board.pageId)).toEqual([
      boardB.id
    ])
  })

  test('persists a chosen board icon and infers one for older boards', () => {
    const graph = new SceneGraph()
    const initial = resolveSidebarWorkspace(graph).workspace
    const root = orderedSidebarPages(initial, null)[0]
    if (!root) throw new Error('missing root page')
    const flowPage = graph.addPage('Clinical flow')
    const workspace = createSidebarBoard(initial, {
      icon: 'flow',
      label: 'Clinical flow',
      pageId: flowPage.id,
      parentPageId: root.id
    })

    expect(workspace.boards.find((board) => board.pageId === flowPage.id)?.icon).toBe('flow')
    expect(initial.boards[0]?.icon).toBeDefined()
  })

  test('reorders nested Projects and rejects parent cycles', () => {
    const graph = new SceneGraph()
    const initial = resolveSidebarWorkspace(graph).workspace
    const root = orderedSidebarPages(initial, null)[0]
    if (!root) throw new Error('missing root page')
    const childA = createSidebarPage(initial, { name: 'A', parentId: root.id })
    const childB = createSidebarPage(childA.workspace, { name: 'B', parentId: root.id })
    const reordered = moveSidebarPage(childB.workspace, childB.page.id, root.id, 0)

    expect(orderedSidebarPages(reordered, root.id).map((page) => page.name)).toEqual(['B', 'A'])
    expect(() => moveSidebarPage(reordered, root.id, childB.page.id, 0)).toThrow(
      'sidebar_page_cycle'
    )
  })

  test('removes empty Projects but protects Projects that still contain work', () => {
    const graph = new SceneGraph()
    const initial = resolveSidebarWorkspace(graph).workspace
    const root = orderedSidebarPages(initial, null)[0]
    if (!root) throw new Error('missing root page')
    const empty = createSidebarPage(initial, { name: 'Empty' })

    expect(removeSidebarPage(empty.workspace, empty.page.id).pages).not.toContainEqual(empty.page)
    expect(() => removeSidebarPage(initial, root.id)).toThrow('sidebar_page_not_empty')
  })
})
