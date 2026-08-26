import { afterEach, describe, expect, test } from 'bun:test'

import { createAutomationBoardOpenHandler } from '@/app/automation/bridge/board-navigation-handler'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

function targetFixture(): { destinationPageId: string; target: AutomationTarget } {
  const store = createEditorStore()
  const destinationPageId = store.graph.addPage('Agent Sandbox').id
  const page = store.graph.getNode(destinationPageId)
  return {
    destinationPageId,
    target: {
      contentDocumentId: 'content:1',
      documentId: 'tab:1',
      documentName: 'Workspace',
      pageId: destinationPageId,
      pageName: page?.name ?? 'Agent Sandbox',
      runtimeInstanceId: 'runtime:1',
      store,
      workspaceId: 'workspace:1'
    }
  }
}

describe('Board navigation handler', () => {
  test('activates the exact document tab and opens the exact page without changing the graph', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1200 }
    })
    const { destinationPageId, target } = targetFixture()
    const beforeNodes = [...target.store.graph.getAllNodes()].map((node) => ({
      childIds: [...node.childIds],
      id: node.id,
      name: node.name,
      parentId: node.parentId,
      type: node.type
    }))
    const viewportInsets = { bottom: 60, left: 260, right: 20, top: 72 }
    const switchPage = target.store.switchPage.bind(target.store)
    let observedInsets: typeof viewportInsets | undefined
    target.store.switchPage = async (pageId, options) => {
      observedInsets = options.viewportInsets
      await switchPage(pageId, options)
    }
    let activeDocumentId = 'tab:other'
    const handleOpen = createAutomationBoardOpenHandler({
      activeDocumentId: () => activeDocumentId,
      activateDocument: (documentId) => {
        activeDocumentId = documentId
      },
      viewportInsets: () => viewportInsets
    })

    const result = await handleOpen(target)

    expect(activeDocumentId).toBe('tab:1')
    expect(observedInsets).toEqual(viewportInsets)
    expect(target.store.state.currentPageId).toBe(destinationPageId)
    expect(
      [...target.store.graph.getAllNodes()].map((node) => ({
        childIds: [...node.childIds],
        id: node.id,
        name: node.name,
        parentId: node.parentId,
        type: node.type
      }))
    ).toEqual(beforeNodes)
    expect(result).toMatchObject({
      action: 'opened',
      active: true,
      page_id: destinationPageId,
      status: 'completed'
    })
  })

  test('fails when the exact document cannot be activated', async () => {
    const { target } = targetFixture()
    const handleOpen = createAutomationBoardOpenHandler({
      activeDocumentId: () => 'tab:other',
      activateDocument: () => undefined,
      viewportInsets: () => ({})
    })

    await expect(handleOpen(target)).rejects.toThrow('could not be activated')
  })
})
