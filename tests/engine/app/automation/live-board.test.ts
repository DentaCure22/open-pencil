import { afterEach, describe, expect, test } from 'bun:test'

import { createLiveBoardHandlers } from '@/app/automation/bridge/live-board'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:live-board-test'

function target(): AutomationTarget {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  return {
    contentDocumentId: store.graph.rootId,
    documentId: 'document:live-board-test',
    documentName: 'Live Board test',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:live-board-test'
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('live Board presentation adapter', () => {
  test('issues a presentation-only context and focuses exact objects', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1200 }
    })
    const liveTarget = target()
    const nodeId = liveTarget.store.createShape('RECTANGLE', 40, 60, 120, 80)
    const handlers = createLiveBoardHandlers(RUNTIME_ID)
    const context = await handlers.context(liveTarget)

    expect(context.capabilities).toEqual(['board.present'])
    expect(context).not.toHaveProperty('board_build_base')

    const result = await handlers.present(liveTarget, {
      context_token: context.context_token,
      object_ids: [nodeId]
    })
    expect(result).toMatchObject({
      presentation: {
        acknowledged: false,
        selected_ids: [nodeId]
      },
      status: { command: 'completed', mutation: 'not_applicable' }
    })
  })

  test('rejects a context from another runtime', async () => {
    const liveTarget = target()
    const handlers = createLiveBoardHandlers('runtime:other')
    expect(() => handlers.context(liveTarget)).toThrow('does not belong')
  })
})
