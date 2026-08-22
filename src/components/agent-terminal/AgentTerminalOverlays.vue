<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { AgentConversationThread } from '@/app/agent-chat/client'
import { matchesAgentBoardConversation } from '@/app/agent-chat/board-conversation'
import { useAgentConversationHistory } from '@/app/agent-chat/history-store'
import { agentConversationTitle } from '@/app/agent-chat/presentation'
import { placementForPage, type AgentBoardPlacement } from '@/app/agent-terminal/board-layout'
import {
  agentBoardObjectDocument,
  agentBoardObjectKey,
  createAgentConversationBoardObject,
  isAgentConversationDraftId
} from '@/app/agent-terminal/board-object'
import { codeObjectPluginData } from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const { history } = useAgentConversationHistory()
const threads = computed<AgentConversationThread[]>(() => history.value?.threads ?? [])
const dismissedKeys = ref<string[]>([])
const knownConversationIds = useLocalStorage<string[]>('op-agent-board-known-conversations-v1', [])
const seenKeys = new Set<string>()
const nodeKeyById = new Map<string, string>()
const pendingConversationIds = new Set<string>()
let inventoryInitialized = false
let reconciledSourceSignature = ''

type ConversationBoardThread = {
  conversationId: string
  name: string
}

function boardObjects(): Array<{
  document: NonNullable<ReturnType<typeof agentBoardObjectDocument>>
  node: SceneNode
}> {
  const objects = []
  for (const node of store.graph.getAllNodes()) {
    const document = agentBoardObjectDocument(node)
    if (document) objects.push({ document, node })
  }
  return objects
}

function fallbackPlacement(index: number): AgentBoardPlacement {
  return placementForPage(store.graph, store.state.currentPageId, index, {
    parentId: store.state.currentPageId,
    x: 160,
    y: 120
  })
}

function createConversationObject(thread: ConversationBoardThread, index: number) {
  return createAgentConversationBoardObject(
    store,
    { conversationId: thread.conversationId, title: thread.name },
    fallbackPlacement(index)
  )
}

function coveredConversationIds() {
  const covered = new Set<string>()
  for (const { document } of boardObjects()) {
    covered.add(document.workerConversationId)
  }
  return covered
}

function compareConversationPriority(
  left: AgentConversationThread,
  right: AgentConversationThread
): number {
  const leftActive = left.state === 'running' ? 1 : 0
  const rightActive = right.state === 'running' ? 1 : 0
  return rightActive - leftActive || right.updatedAt.localeCompare(left.updatedAt)
}

function conversationThread(conversationId: string): AgentConversationThread | undefined {
  return threads.value
    .filter((candidate) => matchesAgentBoardConversation(candidate, conversationId))
    .sort(compareConversationPriority)
    .at(0)
}

function conversationThreadTitle(conversationId: string): string {
  const thread = conversationThread(conversationId)
  return thread ? agentConversationTitle(thread) : 'Task'
}

function conversationBoardThreads(): ConversationBoardThread[] {
  const objects = boardObjects()
  const covered = coveredConversationIds()
  const boardThreads = new Map<string, ConversationBoardThread>()
  for (const { document } of objects) {
    if (document.component !== 'agent-conversation-terminal') continue
    boardThreads.set(document.workerConversationId, {
      conversationId: document.workerConversationId,
      name: conversationThreadTitle(document.workerConversationId)
    })
  }
  const candidates = [...threads.value]
    .filter((thread) => pendingConversationIds.has(thread.nativeThreadId))
    .sort(compareConversationPriority)
  for (const thread of candidates) {
    const conversationId = thread.nativeThreadId
    if (covered.has(conversationId) || boardThreads.has(conversationId)) {
      continue
    }
    boardThreads.set(conversationId, {
      conversationId,
      name: agentConversationTitle(thread)
    })
  }
  return [...boardThreads.values()]
}

function observeConversationInventory() {
  const knownIds = new Set(knownConversationIds.value)
  const dismissed = new Set(dismissedKeys.value)
  const existingIds = coveredConversationIds()
  const conversationThreads = threads.value
  const firstInventory = !inventoryInitialized && knownIds.size === 0
  const newestConversationId = conversationThreads
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.nativeThreadId
  for (const thread of conversationThreads) {
    const conversationId = thread.nativeThreadId
    const known = knownIds.has(conversationId)
    const key = `conversation:${conversationId}`
    if (
      !existingIds.has(conversationId) &&
      !dismissed.has(key) &&
      ((!firstInventory && !known) || (firstInventory && conversationId === newestConversationId))
    ) {
      pendingConversationIds.add(conversationId)
    }
    knownIds.add(conversationId)
  }
  knownConversationIds.value = [...knownIds]
  inventoryInitialized = true
}

function boardObjectTitle(
  document: NonNullable<ReturnType<typeof agentBoardObjectDocument>>
): string {
  if (isAgentConversationDraftId(document.workerConversationId)) return document.name || 'New task'
  return conversationThreadTitle(document.workerConversationId)
}

function reconcileBoardObjectNames() {
  for (const { document, node } of boardObjects()) {
    const nextName = boardObjectTitle(document)
    if (node.name === nextName && document.name === nextName) continue
    store.graph.updateNode(node.id, {
      name: nextName,
      pluginData: codeObjectPluginData(node, { ...document, name: nextName })
    })
  }
}

function currentSourceSignature() {
  return JSON.stringify(
    threads.value.map((thread) => [
      thread.id,
      thread.state,
      thread.task,
      thread.updatedAt,
      thread.nativeThreadId
    ])
  )
}

function ensureBoardObjects() {
  const existing = new Map(
    boardObjects().map(({ document, node }) => {
      const key = agentBoardObjectKey(document)
      nodeKeyById.set(node.id, key)
      seenKeys.add(key)
      return [key, node] as const
    })
  )
  const dismissed = new Set(dismissedKeys.value)
  let index = existing.size
  for (const thread of conversationBoardThreads()) {
    const key = `conversation:${thread.conversationId}`
    if (existing.has(key) || dismissed.has(key) || seenKeys.has(key)) {
      pendingConversationIds.delete(thread.conversationId)
      continue
    }
    const node = createConversationObject(thread, index)
    nodeKeyById.set(node.id, key)
    seenKeys.add(key)
    pendingConversationIds.delete(thread.conversationId)
    index += 1
  }
}

function reconcileFromCurrentState() {
  if (!history.value) return
  const sourceSignature = currentSourceSignature()
  if (sourceSignature === reconciledSourceSignature) return
  reconciledSourceSignature = sourceSignature
  observeConversationInventory()
  ensureBoardObjects()
  reconcileBoardObjectNames()
}

const stopDeletedListener = store.onEditorEvent('node:deleted', (nodeId) => {
  const key = nodeKeyById.get(nodeId)
  if (!key) return
  nodeKeyById.delete(nodeId)
  dismissedKeys.value = [...new Set([...dismissedKeys.value, key])]
})
const stopGraphReplacedListener = store.onEditorEvent('graph:replaced', () => {
  reconciledSourceSignature = ''
  reconcileFromCurrentState()
})
const stopPageChangedListener = store.onEditorEvent('page:changed', reconcileFromCurrentState)

onUnmounted(() => {
  stopDeletedListener()
  stopGraphReplacedListener()
  stopPageChangedListener()
})

watch(history, reconcileFromCurrentState, { immediate: true })
</script>
