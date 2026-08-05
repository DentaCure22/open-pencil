import { afterEach, describe, expect, test } from 'bun:test'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:board-context-identity-test'

type BackgroundBoardContext = {
  board_build_base: { page_id: string }
  runtime: { page_visibility: string }
  selection: unknown[]
}

afterEach(() => Reflect.deleteProperty(globalThis, 'window'))

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

function automationTarget(): AutomationTarget {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    contentDocumentId: 'content-document:original',
    documentId: 'document-tab:original',
    documentName: 'Board context identity document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:board-context-identity'
  }
}

describe('OpenPencil Board context identity', () => {
  test('issues an exact background-page context without switching the visible page', async () => {
    installWindowFixture()
    const target = automationTarget()
    const visiblePage = target.store.graph.addPage('Visible work')
    await target.store.switchPage(visiblePage.id)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)

    const context = (await handlers.context(target)) as BackgroundBoardContext

    expect(target.store.state.currentPageId).toBe(visiblePage.id)
    expect(context.board_build_base.page_id).toBe(target.pageId)
    expect(context.runtime.page_visibility).toBe('background')
    expect(context.selection).toEqual([])
  })

  test('invalidates a context token when the stable content document changes', async () => {
    const target = automationTarget()
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = (await handlers.context(target)) as {
      context_token: string
      target: { contentDocumentId?: string }
    }

    expect(context.target.contentDocumentId).toBe('content-document:original')
    await expect(
      handlers.read(target, { context_token: context.context_token, scope: 'page' })
    ).resolves.toMatchObject({ scope: 'page' })

    target.contentDocumentId = 'content-document:replacement'

    expect(() =>
      handlers.read(target, { context_token: context.context_token, scope: 'page' })
    ).toThrow('Board context changed')
  })
})
