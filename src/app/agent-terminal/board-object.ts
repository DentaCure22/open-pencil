import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  codeObjectDocument,
  codeObjectPluginData,
  createAgentConversationTerminalDocument,
  createCodeObject,
  type AgentConversationTerminalDocument
} from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'

import { AGENT_CARD_HEIGHT, AGENT_CARD_WIDTH, type AgentBoardPlacement } from './board-layout'

export type AgentBoardObjectDocument = AgentConversationTerminalDocument

export type AgentBoardObjectGroup = {
  objects: Array<{ document: AgentBoardObjectDocument; node: SceneNode }>
  page: SceneNode
}

const AGENT_CONVERSATION_DRAFT_PREFIX = 'draft:'

export function agentBoardObjectDocument(
  node: SceneNode | null | undefined
): AgentBoardObjectDocument | null {
  const document = codeObjectDocument(node)
  return document?.component === 'agent-conversation-terminal' ? document : null
}

export function agentBoardObjectKey(document: AgentBoardObjectDocument): string {
  return `conversation:${document.workerConversationId}`
}

export function agentBoardObjectPage(graph: SceneGraph, node: SceneNode): SceneNode | null {
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && !visited.has(current.id)) {
    if (current.type === 'CANVAS') return current
    visited.add(current.id)
    current = current.parentId ? graph.getNode(current.parentId) : undefined
  }
  return null
}

export function agentBoardObjectGroups(graph: SceneGraph): AgentBoardObjectGroup[] {
  const groups = new Map<string, AgentBoardObjectGroup>()
  for (const node of graph.getAllNodes()) {
    const document = agentBoardObjectDocument(node)
    if (!document) continue
    const page = agentBoardObjectPage(graph, node)
    if (!page) continue
    const group = groups.get(page.id) ?? { objects: [], page }
    group.objects.push({ document, node })
    groups.set(page.id, group)
  }
  return [...groups.values()]
}

export type AgentConversationBoardThread = {
  conversationId: string
  title: string
}

export function createAgentConversationDraftId(): string {
  return `${AGENT_CONVERSATION_DRAFT_PREFIX}${crypto.randomUUID()}`
}

export function isAgentConversationDraftId(conversationId: string | undefined): boolean {
  return Boolean(conversationId?.startsWith(AGENT_CONVERSATION_DRAFT_PREFIX))
}

export function agentConversationBoardObject(
  store: EditorStore,
  conversationId: string
): SceneNode | null {
  for (const node of store.graph.getAllNodes()) {
    const document = agentBoardObjectDocument(node)
    if (
      document?.component === 'agent-conversation-terminal' &&
      document.workerConversationId === conversationId
    ) {
      return node
    }
  }
  return null
}

export function createAgentConversationBoardObject(
  store: EditorStore,
  thread: AgentConversationBoardThread,
  placement: AgentBoardPlacement
): SceneNode {
  return createCodeObject(store, {
    cornerRadius: 8,
    document: createAgentConversationTerminalDocument({
      name: thread.title,
      workerConversationId: thread.conversationId
    }),
    height: AGENT_CARD_HEIGHT,
    name: thread.title,
    width: AGENT_CARD_WIDTH,
    ...placement
  })
}

export function markAgentConversationDraftAccepted(
  store: EditorStore,
  frameId: string,
  nativeThreadId: string
): void {
  const node = store.graph.getNode(frameId)
  const document = agentBoardObjectDocument(node)
  if (
    !node ||
    document?.component !== 'agent-conversation-terminal' ||
    !isAgentConversationDraftId(document.workerConversationId)
  ) {
    return
  }
  store.graph.updateNode(frameId, {
    pluginData: codeObjectPluginData(node, {
      ...document,
      definitionId: `agent.conversation.${nativeThreadId}`,
      workerConversationId: nativeThreadId
    })
  })
  store.requestRender()
}
