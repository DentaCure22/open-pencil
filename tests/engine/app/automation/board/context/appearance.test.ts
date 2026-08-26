import { afterEach, describe, expect, test } from 'bun:test'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:board-context-appearance-test'

class AppearanceFixtureElement {
  readonly dataset = { theme: 'dark' }
  readonly style = { colorScheme: 'dark' }
}

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    documentId: 'board-context-appearance-document',
    documentName: 'Board context appearance document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:board-context-appearance'
  }
}

function installAppearanceFixture() {
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: AppearanceFixtureElement
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: new AppearanceFixtureElement(),
      visibilityState: 'visible'
    }
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'HTMLElement')
})

describe('OpenPencil Board context appearance', () => {
  test('reports page-surface and observable UI appearance without nearby content', async () => {
    installAppearanceFixture()
    const store = createEditorStore()
    store.setPageColor({ a: 1, b: 0.12, g: 0.08, r: 0.04 })
    const target = automationTarget(store)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = (await handlers.context(target)) as { appearance: unknown }

    expect(context.appearance).toEqual({
      surface: {
        background: { a: 1, b: 0.12, g: 0.08, r: 0.04 },
        kind: 'solid_page',
        source: 'editor.state.pageColor'
      },
      ui: {
        color_scheme: 'dark',
        source: 'document.documentElement',
        theme: 'dark'
      }
    })
  })

  test('reports UI appearance as unknown when context is headless', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = (await handlers.context(target)) as { appearance: unknown }

    expect(context.appearance).toEqual({
      surface: {
        background: store.state.pageColor,
        kind: 'solid_page',
        source: 'editor.state.pageColor'
      },
      ui: {
        color_scheme: 'unknown',
        source: 'headless_unavailable',
        theme: 'unknown'
      }
    })
  })
})
