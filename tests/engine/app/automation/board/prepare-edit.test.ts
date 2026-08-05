import { describe, expect, test } from 'bun:test'

import { createAutomationBoardPrepareEditHandler } from '@/app/automation/bridge/board-prepare-edit'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

function targetFixture() {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  const card = store.graph.createNode('FRAME', pageId, {
    height: 240,
    name: 'Patient card',
    width: 360,
    x: 80,
    y: 60
  })
  const header = store.graph.createNode('RECTANGLE', card.id, {
    height: 48,
    name: 'Header',
    width: 320,
    x: 20,
    y: 16
  })
  const target: AutomationTarget = {
    contentDocumentId: 'content:1',
    documentId: 'tab:1',
    documentName: 'Dental board',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: 'runtime:1',
    store,
    workspaceId: 'workspace:1'
  }
  return { card, header, target }
}

describe('Trace-guided Board edit preparation', () => {
  test('revalidates bounded candidate IDs and returns one fresh build base plus readback', async () => {
    const { card, header, target } = targetFixture()
    let readArgs: unknown = null
    let codeObjectReads = 0
    const handle = createAutomationBoardPrepareEditHandler({
      board: {
        context: async () => ({
          board_build_base: {
            content_document_id: 'content:1',
            context_token: 'context:1',
            document_id: 'tab:1',
            expected_revision: 12,
            page_id: target.pageId,
            runtime_instance_id: 'runtime:1',
            workspace_id: 'workspace:1'
          },
          context_token: 'context:1'
        }),
        read: async (_target, args) => {
          readArgs = args
          return { count: 2, nodes: [{ id: card.id }, { id: header.id }], scope: 'objects' }
        }
      },
      codeObjectRead: async () => {
        codeObjectReads += 1
        return {}
      }
    })

    const result = await handle(target, {
      candidate_object_ids: [card.id, header.id, 'missing:1'],
      gesture_id: 'gesture:1',
      intent: 'Make the header white',
      primary_target_id: header.id,
      region: { height: 40, width: 200, x: 100, y: 80 }
    })

    expect(readArgs).toEqual({
      context_token: 'context:1',
      limit: 25,
      object_ids: [card.id],
      scope: 'objects'
    })
    expect(result).toMatchObject({
      board_build_base: { context_token: 'context:1', expected_revision: 12 },
      code_object: null,
      contract: 'board-edit-context/v1',
      resolution: {
        candidate_object_ids: [card.id],
        missing_object_ids: ['missing:1'],
        selected_object_id: card.id,
        status: 'resolved'
      },
      trace_connections: { count: 0, items: [], truncated: false }
    })
    expect(codeObjectReads).toBe(0)
  })
})
