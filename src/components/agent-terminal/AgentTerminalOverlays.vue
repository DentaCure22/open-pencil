<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import { matchesAgentBoardConversation } from '@/app/agent-chat/board-conversation'
import { useAgentConversationHistory } from '@/app/agent-chat/history-store'
import { agentConversationTitle } from '@/app/agent-chat/presentation'
import {
  agentBoardObjectDocument,
  isAgentConversationDraftId
} from '@/app/agent-terminal/board-object'
import { codeObjectPluginData } from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const { history } = useAgentConversationHistory()
const threads = computed<AgentConversationThread[]>(() => history.value?.threads ?? [])
let reconciledSourceSignature = ''

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

function reconcileFromCurrentState() {
  if (!history.value) return
  const sourceSignature = currentSourceSignature()
  if (sourceSignature === reconciledSourceSignature) return
  reconciledSourceSignature = sourceSignature
  reconcileBoardObjectNames()
}

const stopGraphReplacedListener = store.onEditorEvent('graph:replaced', () => {
  reconciledSourceSignature = ''
  reconcileFromCurrentState()
})
const stopPageChangedListener = store.onEditorEvent('page:changed', reconcileFromCurrentState)

onUnmounted(() => {
  stopGraphReplacedListener()
  stopPageChangedListener()
})

watch(history, reconcileFromCurrentState, { immediate: true })
</script>
