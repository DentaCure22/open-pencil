import { computed, type ComputedRef, type Ref } from 'vue'

import type { AgentConversationThread } from './conversations'
import {
  agentRightPanelState,
  openAgentRightPanel,
  setAgentRightPanelSurface,
  type AgentRightPanelSurface
} from './right-panel'
import type { AgentWorkMap, AgentWorkMapTodo } from './work-map'

export function openAgentPanelTodoObject(todo: AgentWorkMapTodo, thread: AgentConversationThread) {
  openAgentRightPanel('object', {
    objectId: undefined,
    objectThreadId: thread.nativeThreadId,
    objectTodoId: todo.id,
    projectId: todo.projectId
  })
}

export function useAgentPanelObjectNavigation(options: {
  conversationThreadId: ComputedRef<string>
  refresh: (fresh?: boolean) => Promise<unknown>
  selectedThread: ComputedRef<AgentConversationThread | null>
  selectedWorkMapTodo: ComputedRef<AgentWorkMapTodo | null>
  selectThread: (thread: AgentConversationThread) => Promise<unknown>
  threadByNativeId: ComputedRef<ReadonlyMap<string, AgentConversationThread>>
  workMap: Readonly<Ref<AgentWorkMap | null>>
}) {
  const rightPanelTodoThread = computed(() => {
    const state = agentRightPanelState.value
    if (state.objectThreadId)
      return options.threadByNativeId.value.get(state.objectThreadId) ?? null
    return options.selectedThread.value?.todoDraft ? options.selectedThread.value : null
  })
  const rightPanelTodoDraft = computed(() => rightPanelTodoThread.value?.todoDraft ?? null)
  const rightPanelWorkMapTodo = computed(() => {
    const todoId = rightPanelTodoDraft.value?.todoId ?? agentRightPanelState.value.objectTodoId
    if (!todoId) return null
    return options.workMap.value?.todos.find((todo) => todo.id === todoId) ?? null
  })
  const rightPanelWorkspaceId = computed(() => {
    const state = agentRightPanelState.value
    return state.objectThreadId
      ? `object:${state.objectThreadId}`
      : options.conversationThreadId.value
  })

  function selectRightPanelSurface(surface: AgentRightPanelSurface) {
    setAgentRightPanelSurface(surface)
  }

  function openSelectedTodoObject() {
    const thread = options.selectedThread.value
    const draft = thread?.todoDraft
    if (!thread || !draft) return
    const todo = options.selectedWorkMapTodo.value
    openAgentRightPanel('object', {
      objectId: undefined,
      objectThreadId: thread.nativeThreadId,
      objectTodoId: draft.todoId,
      projectId: todo?.projectId ?? draft.projectId
    })
  }

  function openSelectedPlan() {
    const todo = options.selectedWorkMapTodo.value
    if (!todo?.planObjectId) return
    openAgentRightPanel('object', {
      objectId: todo.planObjectId,
      objectThreadId: options.selectedThread.value?.nativeThreadId,
      objectTodoId: todo.id,
      projectId: todo.projectId
    })
  }

  async function openRightPanelTodoChat() {
    const thread = rightPanelTodoThread.value
    if (thread) await options.selectThread(thread)
  }

  async function refreshRightPanelTodo() {
    await options.refresh(true)
  }

  return {
    openRightPanelTodoChat,
    openSelectedPlan,
    openSelectedTodoObject,
    refreshRightPanelTodo,
    rightPanelTodoDraft,
    rightPanelTodoThread,
    rightPanelWorkMapTodo,
    rightPanelWorkspaceId,
    selectRightPanelSurface
  }
}
