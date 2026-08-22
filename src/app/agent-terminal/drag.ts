import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { SceneNode, Vector } from '@open-pencil/scene-graph'

import { codeObjectDocument, codeObjectPluginData } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'

import { AGENT_CARD_HEIGHT, AGENT_CARD_WIDTH } from './board-layout'
import {
  agentBoardObjectDocument,
  agentConversationBoardObject,
  createAgentConversationDraftId,
  createAgentConversationBoardObject,
  type AgentConversationBoardThread
} from './board-object'

export const AGENT_CONVERSATION_DRAG_TYPE = 'application/x-openpencil-agent-conversation'
const AGENT_CONVERSATION_DRAG_START_EVENT = 'openpencil:agent-conversation-drag-start'

export type AgentConversationDragPayload = AgentConversationBoardThread & {
  newConversation?: true
  threadId: string
}

function hasAgentConversation(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && [...dataTransfer.types].includes(AGENT_CONVERSATION_DRAG_TYPE))
}

export function writeAgentConversationDrag(
  event: DragEvent,
  payload: AgentConversationDragPayload
): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(AGENT_CONVERSATION_DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'copyMove'
  window.dispatchEvent(new CustomEvent(AGENT_CONVERSATION_DRAG_START_EVENT))
}

export function writeNewAgentConversationDrag(event: DragEvent): void {
  writeAgentConversationDrag(event, {
    conversationId: createAgentConversationDraftId(),
    newConversation: true,
    threadId: 'new',
    title: 'New task'
  })
}

export function readAgentConversationDrag(
  dataTransfer: DataTransfer | null
): AgentConversationDragPayload | null {
  if (!hasAgentConversation(dataTransfer)) return null
  try {
    const value = JSON.parse(dataTransfer?.getData(AGENT_CONVERSATION_DRAG_TYPE) ?? '') as unknown
    if (!value || typeof value !== 'object') return null
    if (
      !('conversationId' in value) ||
      typeof value.conversationId !== 'string' ||
      !('threadId' in value) ||
      typeof value.threadId !== 'string' ||
      !('title' in value) ||
      typeof value.title !== 'string'
    ) {
      return null
    }
    const conversationId = value.conversationId.trim()
    const threadId = value.threadId.trim()
    const title = value.title.trim()
    if (!conversationId || !threadId || !title) return null
    return {
      conversationId,
      ...('newConversation' in value && value.newConversation === true
        ? { newConversation: true as const }
        : {}),
      threadId,
      title
    }
  } catch {
    return null
  }
}

function parentOffset(store: EditorStore, parentId: string): Vector {
  const parent = store.graph.getNode(parentId)
  if (!parent || parent.type === 'CANVAS') return { x: 0, y: 0 }
  return store.graph.getAbsolutePosition(parentId)
}

function usableDropParent(node: SceneNode | null | undefined): boolean {
  return Boolean(
    node &&
    (node.type === 'CANVAS' || node.type === 'FRAME' || node.type === 'SECTION') &&
    !codeObjectDocument(node) &&
    node.layoutMode === 'NONE'
  )
}

function dropParentId(store: EditorStore, point: Vector, existingId?: string): string {
  const entered = store.state.enteredContainerId
    ? store.graph.getNode(store.state.enteredContainerId)
    : undefined
  if (entered && usableDropParent(entered)) return entered.id

  let candidate: SceneNode | undefined | null = store.graph.hitTestFrame(
    point.x,
    point.y,
    new Set(existingId ? [existingId] : []),
    store.state.currentPageId
  )
  while (candidate && !usableDropParent(candidate)) {
    candidate = candidate.parentId ? store.graph.getNode(candidate.parentId) : null
  }
  return candidate?.id ?? store.state.currentPageId
}

function centeredPlacement(
  store: EditorStore,
  parentId: string,
  point: Vector,
  size: { height: number; width: number }
) {
  const offset = parentOffset(store, parentId)
  return {
    parentId,
    x: Math.round(point.x - offset.x - size.width / 2),
    y: Math.round(point.y - offset.y - size.height / 2)
  }
}

export function placeAgentConversationBoardThread(
  store: EditorStore,
  payload: AgentConversationDragPayload,
  point: Vector
): SceneNode {
  const existing = agentConversationBoardObject(store, payload.conversationId)
  const parentId = dropParentId(store, point, existing?.id)
  if (!existing) {
    return createAgentConversationBoardObject(
      store,
      { conversationId: payload.conversationId, title: payload.title },
      centeredPlacement(store, parentId, point, {
        height: AGENT_CARD_HEIGHT,
        width: AGENT_CARD_WIDTH
      })
    )
  }

  const original = new Map([
    [
      existing.id,
      {
        parentId: existing.parentId ?? store.state.currentPageId,
        x: existing.x,
        y: existing.y
      }
    ]
  ])
  const placement = centeredPlacement(store, parentId, point, existing)
  if (existing.parentId !== parentId) store.graph.reparentNode(existing.id, parentId)
  const document = agentBoardObjectDocument(existing)
  store.updateNode(existing.id, {
    name: payload.title,
    pluginData:
      document?.component === 'agent-conversation-terminal'
        ? codeObjectPluginData(existing, { ...document, name: payload.title })
        : existing.pluginData,
    x: placement.x,
    y: placement.y
  })
  store.commitMoveWithReparent(original)
  store.select([existing.id])
  store.requestRender()
  return store.graph.getNode(existing.id) ?? existing
}

export function useAgentConversationDrop(
  canvasAreaRef: Ref<HTMLElement | null>,
  store: EditorStore
) {
  const isDraggingAgentConversation = ref(false)

  function onDragEnter(event: DragEvent) {
    if (!hasAgentConversation(event.dataTransfer)) return
    event.preventDefault()
    isDraggingAgentConversation.value = true
  }

  function onDragOver(event: DragEvent) {
    if (!hasAgentConversation(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    isDraggingAgentConversation.value = true
  }

  function onDragLeave(event: DragEvent) {
    const area = canvasAreaRef.value
    const related = event.relatedTarget
    if (area && related instanceof Node && area.contains(related)) return
    isDraggingAgentConversation.value = false
  }

  function onDrop(event: DragEvent) {
    const area = canvasAreaRef.value
    const payload = readAgentConversationDrag(event.dataTransfer)
    isDraggingAgentConversation.value = false
    if (!area || !payload) return
    event.preventDefault()
    const bounds = area.getBoundingClientRect()
    const point = store.screenToCanvas(event.clientX - bounds.left, event.clientY - bounds.top)
    placeAgentConversationBoardThread(store, payload, point)
  }

  useEventListener(window, AGENT_CONVERSATION_DRAG_START_EVENT, () => {
    isDraggingAgentConversation.value = true
  })
  useEventListener(window, 'dragend', () => {
    isDraggingAgentConversation.value = false
  })

  return { isDraggingAgentConversation, onDragEnter, onDragLeave, onDragOver, onDrop }
}
