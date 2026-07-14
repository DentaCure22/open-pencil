import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  SIDEBAR_WORKSPACE_PLUGIN_ID,
  createSidebarBoard,
  createSidebarPage,
  moveSidebarBoard,
  moveSidebarPage,
  orderedSidebarBoards,
  orderedSidebarPages,
  removeSidebarPage,
  resolveSidebarWorkspace,
  sidebarWorkspacePluginData
} from '@/app/sidebar-workspace/tree'

function persist(
  graph: SceneGraph,
  workspace: ReturnType<typeof resolveSidebarWorkspace>['workspace']
) {
  const root = graph.getNode(graph.rootId)
  if (!root) throw new Error('missing document root')
  graph.updateNode(root.id, { pluginData: sidebarWorkspacePluginData(root, workspace) })
}

describe('sidebar Page and Board workspace', () => {
  test('migrates scene pages into logical Pages with movable Boards', () => {
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
        label: 'Current chart',
        order: 0,
        pageId: scenePage.id,
        parentPageId: logicalPage?.id
      }
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

  test('allows unlimited boards under one Page and moves them between Pages', () => {
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

  test('reorders nested Pages and rejects parent cycles', () => {
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

  test('removes empty Pages but protects Pages that still contain work', () => {
    const graph = new SceneGraph()
    const initial = resolveSidebarWorkspace(graph).workspace
    const root = orderedSidebarPages(initial, null)[0]
    if (!root) throw new Error('missing root page')
    const empty = createSidebarPage(initial, { name: 'Empty' })

    expect(removeSidebarPage(empty.workspace, empty.page.id).pages).not.toContainEqual(empty.page)
    expect(() => removeSidebarPage(initial, root.id)).toThrow('sidebar_page_not_empty')
  })
})
