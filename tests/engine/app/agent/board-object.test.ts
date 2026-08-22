import { describe, expect, test } from 'bun:test'

import { agentBoardObjectDocument, agentBoardObjectGroups } from '@/app/agent-terminal/board-object'
import { createAgentConversationTerminalDocument, createCodeObject } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

describe('Agent terminal Board objects', () => {
  test('keeps task identities as ordinary Code Object frames', () => {
    const store = createEditorStore()
    const worker = createCodeObject(store, {
      document: createAgentConversationTerminalDocument({
        name: 'Review Dental Chart',
        workerConversationId: 'worker-conversation-1'
      }),
      height: 390,
      name: 'Review Dental Chart',
      width: 640,
      x: 840,
      y: 180
    })

    expect(agentBoardObjectDocument(worker)).toMatchObject({
      component: 'agent-conversation-terminal',
      workerConversationId: 'worker-conversation-1'
    })
    expect(store.state.selectedIds).toEqual(new Set([worker.id]))

    store.undoAction()
    expect(store.graph.getNode(worker.id)).toBeUndefined()
    store.redoAction()
    expect(agentBoardObjectDocument(store.graph.getNode(worker.id))?.component).toBe(
      'agent-conversation-terminal'
    )
  })

  test('groups nested chat cards under the Board page that owns them', () => {
    const store = createEditorStore()
    const firstPage = store.graph.getPages()[0]
    const secondPage = store.graph.addPage('Dental Chart')
    if (!firstPage) throw new Error('Expected an initial page')
    const boardSection = store.graph.createNode('FRAME', secondPage.id, {
      height: 800,
      name: 'Clinical workspace',
      width: 1200
    })
    const firstChat = createCodeObject(store, {
      document: createAgentConversationTerminalDocument({
        name: 'Review schedule',
        workerConversationId: 'thread-1'
      }),
      height: 390,
      name: 'Review schedule',
      parentId: firstPage.id,
      width: 640
    })
    const dentalChat = createCodeObject(store, {
      document: createAgentConversationTerminalDocument({
        name: 'Check tooth 14',
        workerConversationId: 'thread-2'
      }),
      height: 390,
      name: 'Check tooth 14',
      parentId: boardSection.id,
      width: 640
    })
    store.graph.reparentNode(dentalChat.id, boardSection.id)

    expect(
      agentBoardObjectGroups(store.graph).map((group) => ({
        objectIds: group.objects.map(({ node }) => node.id),
        pageId: group.page.id,
        pageName: group.page.name
      }))
    ).toEqual([
      { objectIds: [firstChat.id], pageId: firstPage.id, pageName: 'Page 1' },
      { objectIds: [dentalChat.id], pageId: secondPage.id, pageName: 'Dental Chart' }
    ])
  })
})
