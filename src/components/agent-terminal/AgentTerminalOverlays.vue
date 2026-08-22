<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onUnmounted, ref, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { AgentConversationThread } from '@/app/agent-chat/client'
import { matchesAgentBoardConversation } from '@/app/agent-chat/board-conversation'
import { useAgentConversationHistory } from '@/app/agent-chat/history-store'
import { agentConversationTitle } from '@/app/agent-chat/presentation'
import { placementForPage, type AgentBoardPlacement } from '@/app/agent-terminal/board-layout'
import {
  agentBoardObjectDocument,
  agentBoardObjectGroups,
  agentBoardObjectKey,
  createAgentConversationBoardObject,
  isAgentConversationDraftId
} from '@/app/agent-terminal/board-object'
import { codeObjectPluginData } from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { usePopoverUI } from '@/components/ui/popover'

const store = useEditorStore()
const { history } = useAgentConversationHistory()
const threads = computed<AgentConversationThread[]>(() => history.value?.threads ?? [])
const chatSwitcherOpen = ref(false)
const popover = usePopoverUI({
  content:
    'z-[80] w-72 max-w-[calc(100vw-24px)] overflow-hidden border-chrome-border bg-chrome-raised p-0 text-surface shadow-chrome-menu backdrop-blur-2xl'
})
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

type BoardChatEntry = {
  node: SceneNode
  state?: AgentConversationThread['state']
  title: string
}

type BoardChatGroup = {
  chats: BoardChatEntry[]
  current: boolean
  pageId: string
  pageName: string
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

const boardChatGroups = computed<BoardChatGroup[]>(() => {
  void store.state.sceneVersion
  const groups = agentBoardObjectGroups(store.graph).map(({ objects, page }) => ({
    chats: objects
      .map(({ document, node }) => {
        const thread = conversationThread(document.workerConversationId)
        return {
          node,
          state: thread?.state,
          title: node.name || document.name || 'Task'
        }
      })
      .sort((left, right) => {
        const leftActive = left.state === 'running' ? 1 : 0
        const rightActive = right.state === 'running' ? 1 : 0
        return rightActive - leftActive || left.title.localeCompare(right.title)
      }),
    current: page.id === store.state.currentPageId,
    pageId: page.id,
    pageName: page.name || 'Untitled Board'
  }))
  return groups.sort(
    (left, right) =>
      Number(right.current) - Number(left.current) || left.pageName.localeCompare(right.pageName)
  )
})

const boardChatCount = computed(() =>
  boardChatGroups.value.reduce((count, group) => count + group.chats.length, 0)
)
const available = computed(() => Boolean(history.value) || boardChatCount.value > 0)

function chatStateDotClass(state?: AgentConversationThread['state']): string {
  if (state === 'needs_attention') return 'bg-red-400'
  if (state === 'running') return 'bg-amber-400'
  if (state === 'completed') return 'bg-[var(--color-success-bg)]'
  return 'bg-muted/50'
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

async function focusBoardChat(group: BoardChatGroup, chat: BoardChatEntry) {
  chatSwitcherOpen.value = false
  if (store.state.currentPageId !== group.pageId) {
    await store.switchPage(group.pageId, { viewportInsets: editorViewportInsets() })
  }
  if (!store.graph.getNode(chat.node.id)) return
  store.select([chat.node.id])
  store.zoomToNode(chat.node.id, editorViewportInsets())
}

function removeBoardChat(chat: BoardChatEntry) {
  if (!store.graph.getNode(chat.node.id)) return
  const previousSelection = [...store.state.selectedIds]
  store.select([chat.node.id])
  store.deleteSelected()
  store.select(previousSelection.filter((nodeId) => Boolean(store.graph.getNode(nodeId))))
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

<template>
  <PopoverRoot v-if="available" v-model:open="chatSwitcherOpen" :modal="false">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="pointer-events-auto absolute top-3 right-3 z-[28] flex h-8 items-center gap-1.5 rounded-full border border-chrome-border bg-chrome-raised/95 px-3 text-[10px] font-medium text-muted shadow-chrome-panel backdrop-blur-xl hover:bg-hover hover:text-surface"
        data-test-id="agent-terminals-toggle"
        aria-label="Open Board chats"
      >
        <icon-lucide-messages-square class="size-3.5" />
        <span>Chats</span>
        <span
          v-if="boardChatCount > 0"
          class="min-w-4 rounded-full bg-accent/15 px-1 py-0.5 text-center text-[8px] font-semibold text-accent"
        >
          {{ boardChatCount }}
        </span>
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="agent-board-chat-switcher"
        :class="popover.content"
        side="bottom"
        align="end"
        :side-offset="8"
        @keydown.esc.capture.stop.prevent="chatSwitcherOpen = false"
      >
        <div class="flex h-11 items-center justify-between border-b border-border/70 px-3.5">
          <div>
            <div class="text-[11px] font-medium">Board chats</div>
            <div class="mt-0.5 text-[9px] text-muted/70">Jump to a placed chat</div>
          </div>
          <span class="text-[9px] tabular-nums text-muted/70">{{ boardChatCount }}</span>
        </div>

        <div v-if="boardChatGroups.length > 0" class="max-h-[min(420px,60vh)] overflow-y-auto p-2">
          <section
            v-for="group in boardChatGroups"
            :key="group.pageId"
            class="not-last:mb-2"
            :data-board-page-id="group.pageId"
          >
            <div class="flex h-7 items-center gap-1.5 px-2 text-[9px] font-medium text-muted/80">
              <icon-lucide-layout-dashboard class="size-3" />
              <span class="min-w-0 flex-1 truncate">{{ group.pageName }}</span>
              <span class="tabular-nums text-muted/50">{{ group.chats.length }}</span>
            </div>

            <div class="overflow-hidden rounded-md border border-border/60 bg-panel/40">
              <div
                v-for="chat in group.chats"
                :key="chat.node.id"
                class="group flex items-center border-b border-border/50 last:border-b-0 hover:bg-hover"
                :data-code-object-id="chat.node.id"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                  :aria-label="`Focus ${chat.title} on ${group.pageName}`"
                  @click="focusBoardChat(group, chat)"
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    :class="chatStateDotClass(chat.state)"
                    aria-hidden="true"
                  />
                  <span class="truncate text-[10px] text-surface/90">{{ chat.title }}</span>
                </button>
                <button
                  type="button"
                  class="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted/60 opacity-70 hover:bg-panel hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                  :aria-label="`Remove ${chat.title} from ${group.pageName}`"
                  @click="removeBoardChat(chat)"
                >
                  <icon-lucide-trash-2 class="size-3" />
                </button>
              </div>
            </div>
          </section>
        </div>

        <div v-else class="px-5 py-7 text-center">
          <icon-lucide-messages-square class="mx-auto size-5 text-muted/40" />
          <div class="mt-2 text-[10px] text-muted">No chats on the Board</div>
          <div class="mt-1 text-[9px] text-muted/60">Drag one from the CHATS sidebar.</div>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
