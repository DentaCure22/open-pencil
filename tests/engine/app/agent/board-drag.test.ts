import { describe, expect, test } from 'bun:test'

import {
  agentBoardObjectDocument,
  agentConversationBoardObject,
  createAgentConversationDraftId,
  isAgentConversationDraftId,
  markAgentConversationDraftAccepted
} from '@/app/agent-terminal/board-object'
import { placeAgentConversationBoardThread } from '@/app/agent-terminal/drag'
import { createEditorStore } from '@/app/editor/session'

describe('agent conversation Board drag', () => {
  test('places one thread at the drop point and repositions the same object', () => {
    const store = createEditorStore()
    const payload = {
      conversationId: 'conversation-1',
      threadId: 'thread-1',
      title: 'Review Dental Chart'
    }

    const created = placeAgentConversationBoardThread(store, payload, { x: 520, y: 460 })
    expect(created).toMatchObject({
      height: 800,
      name: 'Review Dental Chart',
      width: 640,
      x: 200,
      y: 60
    })
    expect(agentBoardObjectDocument(created)).toMatchObject({
      component: 'agent-conversation-terminal',
      name: 'Review Dental Chart',
      workerConversationId: 'conversation-1'
    })
    expect(store.state.selectedIds).toEqual(new Set([created.id]))

    const moved = placeAgentConversationBoardThread(store, payload, { x: 920, y: 700 })
    expect(moved.id).toBe(created.id)
    expect(moved).toMatchObject({ x: 600, y: 300 })
    expect(agentConversationBoardObject(store, payload.conversationId)?.id).toBe(created.id)
    expect(
      [...store.graph.getAllNodes()].filter(
        (node) => agentBoardObjectDocument(node)?.component === 'agent-conversation-terminal'
      )
    ).toHaveLength(1)

    store.undoAction()
    expect(store.graph.getNode(created.id)).toMatchObject({ x: 200, y: 60 })
    store.redoAction()
    expect(store.graph.getNode(created.id)).toMatchObject({ x: 600, y: 300 })
  })

  test('places a fresh draft and binds the same card to its accepted conversation', () => {
    const store = createEditorStore()
    const draftId = createAgentConversationDraftId()
    expect(isAgentConversationDraftId(draftId)).toBeTrue()

    const draft = placeAgentConversationBoardThread(
      store,
      {
        conversationId: draftId,
        newConversation: true,
        threadId: 'new',
        title: 'New task'
      },
      { x: 520, y: 460 }
    )
    expect(agentBoardObjectDocument(draft)).toMatchObject({
      component: 'agent-conversation-terminal',
      name: 'New task',
      workerConversationId: draftId
    })

    markAgentConversationDraftAccepted(store, draft.id, 'native-thread-1')
    expect(agentConversationBoardObject(store, 'native-thread-1')?.id).toBe(draft.id)
    expect(agentBoardObjectDocument(store.graph.getNode(draft.id))).toMatchObject({
      component: 'agent-conversation-terminal',
      name: 'New task',
      workerConversationId: 'native-thread-1'
    })

    store.undoAction()
    expect(store.graph.getNode(draft.id)).toBeUndefined()
  })
})
