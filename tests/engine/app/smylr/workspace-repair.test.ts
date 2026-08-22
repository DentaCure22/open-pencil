import { describe, expect, test } from 'bun:test'

import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import {
  orderedSidebarBoards,
  orderedSidebarPages,
  resolveSidebarWorkspace,
  SMYLR_PROJECT_ID
} from '@/app/sidebar-workspace/tree'
import { SMYLR_DURABLE_APP_FLOW_DEFINITIONS } from '@/app/smylr-production/app-flow/model'
import { SMYLR_PRODUCTION_PAGES } from '@/app/smylr-production/pages'
import {
  createSmylrProductionWorkspaceGraph,
  getSmylrFoundationsRevision,
  SMYLR_PRODUCT_MAP_PAGE_ID,
  SMYLR_PRODUCT_MAP_PAGE_KIND,
  SMYLR_PRODUCT_MAP_PAGE_NAME,
  SMYLR_PRODUCT_MAP_PROJECT_NAME,
  repairSmylrProductionWorkspaceStructure,
  SMYLR_FOUNDATIONS_REVISION,
  stampSmylrFoundationsRevision
} from '@/app/smylr-production/workspace'

function pluginValue(
  node: { pluginData: Array<{ key: string; pluginId: string; value: string }> },
  key: string
) {
  return node.pluginData.find((entry) => entry.pluginId === 'smylr-production' && entry.key === key)
    ?.value
}

describe('Smylr production workspace repair', () => {
  test('converts a managed production frame to a Code Object in place', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const dentalPage = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === 'dental-chart')
    const frame = dentalPage
      ? store.graph
          .getChildren(dentalPage.id)
          .find((node) => pluginValue(node, 'state') === 'current')
      : null
    if (!dentalPage || !frame) throw new Error('Expected Dental Chart production frame')
    const userNote = store.graph.createNode('TEXT', dentalPage.id, { name: 'User note' })
    const legacyPluginData = frame.pluginData
      .filter((entry) => entry.pluginId !== 'openpencil-code-object')
      .map((entry) =>
        entry.pluginId === 'smylr-production' && entry.key === 'kind'
          ? { ...entry, value: 'live-app-frame' }
          : entry
      )
    store.graph.updateNode(frame.id, { pluginData: legacyPluginData })

    expect(codeObjectDocument(store.graph.getNode(frame.id))).toBeNull()
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)

    const repaired = store.graph.getNode(frame.id)
    expect(repaired?.id).toBe(frame.id)
    expect(pluginValue(repaired ?? frame, 'kind')).toBe('smylr-code-object-frame')
    expect(codeObjectDocument(repaired)).toMatchObject({
      component: 'smylr-production-app',
      launch: { launcherId: 'smylr', startScript: 'npm run dev' },
      route: '/dental-chart'
    })
    expect(store.graph.getNode(userNote.id)?.name).toBe('User note')
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(false)
  })

  test('removes retired managed route pages from a restored workspace', async () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    store.setViewportSize(1200, 800)
    const legacyCurrent = store.graph.addPage('Dental Imaging')
    store.graph.updateNode(legacyCurrent.id, {
      pluginData: [
        { key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' },
        { key: 'pageId', pluginId: 'smylr-production', value: 'dental-imaging' },
        { key: 'route', pluginId: 'smylr-production', value: '/dental-imaging' }
      ]
    })
    const legacyFlow = store.graph.addPage('Dental Imaging — Flow')
    store.graph.updateNode(legacyFlow.id, {
      pluginData: [
        { key: 'kind', pluginId: 'smylr-production', value: 'smylr-flow-page' },
        { key: 'pageId', pluginId: 'smylr-production', value: 'dental-imaging' },
        { key: 'route', pluginId: 'smylr-production', value: '/dental-imaging' }
      ]
    })
    await store.switchPage(legacyCurrent.id)

    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)
    expect(store.graph.getNode(legacyCurrent.id)).toBeUndefined()
    expect(store.graph.getNode(legacyFlow.id)).toBeUndefined()
    expect(store.state.currentPageId).not.toBe(legacyCurrent.id)
  })

  test('restores missing foundation pages without replacing ordinary boards', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const productMap = store.graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === SMYLR_PRODUCT_MAP_PAGE_KIND &&
          pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID
      )
    if (!productMap) throw new Error('Expected Product Map page')
    const productMapId = productMap.id
    const missingCurrent = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === 'treatment-plan')
    const missingFlow = store.graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === 'smylr-flow-page' &&
          pluginValue(page, 'pageId') === 'calendar'
      )
    if (!missingCurrent || !missingFlow) throw new Error('Expected production test pages')
    store.graph.deleteNode(missingCurrent.id)
    store.graph.deleteNode(missingFlow.id)

    const root = store.graph.getNode(store.graph.rootId)
    const firstPage = store.graph.getPages()[0]
    const nested = firstPage ? store.graph.getChildren(firstPage.id)[0] : undefined
    if (!root || !nested) throw new Error('Expected production graph hierarchy')
    store.graph.updateNode(root.id, { childIds: [...root.childIds, nested.id] })

    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)
    expect(store.graph.getNode(productMapId)?.type).toBe('CANVAS')
    expect(root.childIds.every((id) => store.graph.getNode(id)?.parentId === root.id)).toBe(true)
    for (const page of SMYLR_PRODUCTION_PAGES) {
      const matches = store.graph
        .getPages()
        .filter((candidate) => pluginValue(candidate, 'pageId') === page.id)
      expect(
        matches.some((candidate) => pluginValue(candidate, 'kind') === 'smylr-production-page')
      ).toBe(true)
      expect(
        matches.some((candidate) => pluginValue(candidate, 'kind') === 'smylr-flow-page')
      ).toBe(true)
    }
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(false)
  })

  test('seeds Product Map with five live routes under the Maps & Flows project', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const productMap = graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID)
    if (!productMap) throw new Error('Expected Product Map page')

    const frames = graph
      .getChildren(productMap.id)
      .filter((node) => pluginValue(node, 'kind') === 'smylr-code-object-frame')
    expect(productMap.name).toBe(SMYLR_PRODUCT_MAP_PAGE_NAME)
    expect(frames).toHaveLength(5)
    expect(new Set(frames.map((frame) => pluginValue(frame, 'route')))).toEqual(
      new Set(['/calendar', '/patient-admin', '/dental-chart', '/treatment-plan', '/health-chart'])
    )

    const sidebar = resolveSidebarWorkspace(graph).workspace
    const project = orderedSidebarPages(sidebar, SMYLR_PROJECT_ID).find(
      (page) => page.name === SMYLR_PRODUCT_MAP_PROJECT_NAME
    )
    if (!project) throw new Error('Expected Maps & Flows project')
    expect(orderedSidebarBoards(sidebar, project.id)).toContainEqual(
      expect.objectContaining({
        label: SMYLR_PRODUCT_MAP_PAGE_NAME,
        pageId: productMap.id,
        parentPageId: project.id
      })
    )
  })

  test('repairs Product Map in place, remains idempotent, and preserves an ordinary board', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const productMap = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID)
    if (!productMap) throw new Error('Expected Product Map page')
    const productMapId = productMap.id
    const ordinaryBoard = store.graph.addPage('Unrelated ordinary board')
    const frame = store.graph
      .getChildren(productMap.id)
      .find((node) => pluginValue(node, 'route') === '/health-chart')
    if (!frame) throw new Error('Expected health chart frame')
    store.graph.deleteNode(frame.id)

    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)
    expect(store.graph.getNode(productMapId)?.name).toBe(SMYLR_PRODUCT_MAP_PAGE_NAME)
    expect(
      store.graph
        .getChildren(productMapId)
        .filter((node) => pluginValue(node, 'kind') === 'smylr-code-object-frame')
    ).toHaveLength(5)
    expect(store.graph.getNode(ordinaryBoard.id)?.name).toBe('Unrelated ordinary board')
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(false)
  })

  test('seeds both durable flow boards under Maps & Flows without changing Product Map identity', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const productMap = graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID)
    if (!productMap) throw new Error('Expected Product Map page')

    const sidebar = resolveSidebarWorkspace(graph).workspace
    const project = orderedSidebarPages(sidebar, SMYLR_PROJECT_ID).find(
      (page) => page.name === SMYLR_PRODUCT_MAP_PROJECT_NAME
    )
    if (!project) throw new Error('Expected Maps & Flows project')

    expect(pluginValue(productMap, 'pageId')).toBe(SMYLR_PRODUCT_MAP_PAGE_ID)
    expect(orderedSidebarBoards(sidebar, project.id).map((board) => board.label)).toEqual([
      SMYLR_PRODUCT_MAP_PAGE_NAME,
      ...SMYLR_DURABLE_APP_FLOW_DEFINITIONS.map((definition) => definition.label)
    ])
    for (const definition of SMYLR_DURABLE_APP_FLOW_DEFINITIONS) {
      const page = graph
        .getPages()
        .find((candidate) => pluginValue(candidate, 'flowId') === definition.id)
      if (!page) throw new Error(`Expected durable flow page ${definition.id}`)
      expect(pluginValue(page, 'flowSourceFile')).toBe(definition.sourceFile)
      expect(orderedSidebarBoards(sidebar, project.id)).toContainEqual(
        expect.objectContaining({
          label: definition.label,
          pageId: page.id,
          parentPageId: project.id
        })
      )
    }
  })

  test('repairs a missing durable flow board idempotently and preserves user boards', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const productMap = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID)
    const taskFlow = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'flowId') === 'task-flow-record-finding')
    if (!productMap || !taskFlow) throw new Error('Expected seeded flow pages')
    const productMapId = productMap.id
    const ordinaryBoard = store.graph.addPage('User-created board')
    store.graph.deleteNode(taskFlow.id)

    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)
    expect(
      store.graph
        .getPages()
        .filter((page) => pluginValue(page, 'flowId') === 'task-flow-record-finding')
    ).toHaveLength(1)
    expect(store.graph.getNode(productMapId)?.id).toBe(productMapId)
    expect(store.graph.getNode(ordinaryBoard.id)?.name).toBe('User-created board')
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(false)
  })

  test('repairs Screen States and Recovery boards without touching Product Map or user boards', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const productMap = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'pageId') === SMYLR_PRODUCT_MAP_PAGE_ID)
    const screenStates = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'flowId') === 'dental-chart-screen-states')
    const recovery = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'flowId') === 'save-finding-recovery')
    if (!productMap || !screenStates || !recovery)
      throw new Error('Expected new durable flow pages')

    const productMapId = productMap.id
    const userBoard = store.graph.addPage('User-created board')
    store.graph.deleteNode(screenStates.id)
    store.graph.deleteNode(recovery.id)

    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)
    expect(
      store.graph
        .getPages()
        .filter((page) => pluginValue(page, 'flowId') === 'dental-chart-screen-states')
    ).toHaveLength(1)
    expect(
      store.graph
        .getPages()
        .filter((page) => pluginValue(page, 'flowId') === 'save-finding-recovery')
    ).toHaveLength(1)
    expect(store.graph.getNode(productMapId)?.id).toBe(productMapId)
    expect(store.graph.getNode(userBoard.id)?.name).toBe('User-created board')
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(false)
  })

  test('repairs Technical Flow in place, removes its legacy projection, and avoids duplicates', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const technical = store.graph
      .getPages()
      .find((page) => pluginValue(page, 'flowId') === 'technical-flow-save-finding')
    if (!technical) throw new Error('Expected Technical Flow page')
    const ownerId = pluginValue(technical, 'technicalFlowOwnerId')
    if (!ownerId) throw new Error('Expected durable Technical Flow owner metadata')
    const owner = store.graph.getNode(ownerId)
    if (!owner) throw new Error('Expected durable Technical Flow Mermaid owner')

    const unrelated = store.graph.createNode('FRAME', technical.id, { name: 'User annotation' })
    store.graph.updateNode(owner.id, {
      name: 'Mermaid diagram',
      pluginData: owner.pluginData.filter(
        (entry) =>
          ![
            'technicalFlowOwnerKey',
            'technicalFlowOwnerId',
            'technicalFlowSourceFile',
            'kind',
            'flowId'
          ].includes(entry.key)
      )
    })
    store.graph.createNode('FRAME', technical.id, {
      name: 'Toggle / Live',
      pluginData: [
        {
          key: 'flowId',
          pluginId: 'smylr-production',
          value: 'technical-flow-save-finding'
        }
      ]
    })
    store.graph.createNode('FRAME', technical.id, {
      name: 'Technical Flow — Save Finding / legacy web view',
      pluginData: [
        {
          key: 'flowId',
          pluginId: 'smylr-production',
          value: 'technical-flow-save-finding'
        }
      ]
    })
    store.graph.createNode('SECTION', technical.id, {
      name: 'Technical Flow — Save Finding',
      pluginData: [
        { key: 'kind', pluginId: 'smylr-production', value: 'smylr-board-guide' },
        {
          key: 'sourceFile',
          pluginId: 'smylr-production',
          value: 'technical-flow-save-finding.md'
        }
      ]
    })

    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(true)
    const repaired = store.graph.getNode(technical.id)
    if (!repaired) throw new Error('Technical Flow page was not preserved')
    const owners = store.graph
      .getChildren(technical.id)
      .filter((node) => pluginValue(node, 'kind') === 'technical-flow-mermaid')
    expect(owners).toHaveLength(1)
    expect(owners[0]?.id).toBe(ownerId)
    expect(owners[0]?.name).toBe('Mermaid · Flowchart')
    expect(store.graph.getNode(unrelated.id)?.name).toBe('User annotation')
    expect(
      store.graph.getChildren(technical.id).some((node) => node.name === 'Mermaid diagram')
    ).toBe(false)
    expect(
      store.graph.getChildren(technical.id).some((node) => node.name === 'Toggle / Live')
    ).toBe(false)
    expect(
      store.graph
        .getChildren(technical.id)
        .filter((node) => pluginValue(node, 'kind') === 'smylr-code-object-frame')
        .map((node) => pluginValue(node, 'captureSrc'))
    ).toEqual([])
    expect(
      store.graph
        .getChildren(technical.id)
        .some((node) => pluginValue(node, 'kind') === 'smylr-board-guide')
    ).toBe(false)
    expect(repairSmylrProductionWorkspaceStructure(store)).toBe(false)
    expect(
      store.graph
        .getPages()
        .filter((page) => pluginValue(page, 'flowId') === 'technical-flow-save-finding')
    ).toHaveLength(1)

    stampSmylrFoundationsRevision(store)
    expect(SMYLR_FOUNDATIONS_REVISION).toBe('2026-08-08-native-workspace-surfaces-v69')
    expect(getSmylrFoundationsRevision(store)).toBe(SMYLR_FOUNDATIONS_REVISION)
  })
})
