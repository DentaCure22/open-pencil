import { ref, type Ref } from 'vue'

import {
  armAgentConversationPointerDrag,
  completeAgentConversationDropOutsideBoard,
  newAgentConversationDragPayload,
  writeNewAgentConversationDrag,
  writeAgentConversationDrag,
  type AgentConversationDragPayload
} from '@/app/agent-terminal/drag'

import type { AgentConversationThread } from './conversations'
import { agentConversationDisplayTitle } from './thread-preferences'
import type { AgentWorkMap, AgentWorkMapTodo, AgentWorkMapTodoStatus } from './work-map'
import {
  readWorkMapCreationDrag,
  writeWorkMapCreationDrag,
  type WorkMapCreationKind
} from './work-map-create-drag'

type WorkMapDragOptions = {
  clearContentDrop: () => void
  createChat: (projectId: string | null) => Promise<void>
  createProject: (parentId?: string) => void
  placeChat: (threadId: string, projectId: string | null) => Promise<void>
  setTodoStatus: (todoId: string, status: AgentWorkMapTodoStatus) => Promise<void>
  workMap: Ref<AgentWorkMap | null>
}

export type WorkMapDropEvent = {
  dataTransfer: Pick<
    DataTransfer,
    'dropEffect' | 'effectAllowed' | 'getData' | 'setData' | 'types'
  > | null
  preventDefault: () => void
  stopPropagation: () => void
}

function threadDragPayload(thread: AgentConversationThread): AgentConversationDragPayload {
  return {
    conversationId: thread.nativeThreadId,
    threadId: thread.id,
    title: agentConversationDisplayTitle(thread)
  }
}

export function useWorkMapDrag(options: WorkMapDragOptions) {
  const draggedWorkMapThreadId = ref<string | null>(null)
  const pressedWorkMapThreadId = ref<string | null>(null)
  const draggedWorkMapTodoId = ref<string | null>(null)
  const draggedWorkMapCreationKind = ref<WorkMapCreationKind | null>(null)
  const pressedWorkMapTodoId = ref<string | null>(null)
  const workMapDropProjectId = ref<string | null | undefined>(undefined)
  const workMapDropTodoStatus = ref<string | null>(null)

  function beginWorkMapTodoDrag(event: WorkMapDropEvent, todo: AgentWorkMapTodo) {
    draggedWorkMapTodoId.value = todo.id
    event.dataTransfer?.setData('application/x-openpencil-work-map-todo', todo.id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function endWorkMapDrag() {
    draggedWorkMapThreadId.value = null
    pressedWorkMapThreadId.value = null
    draggedWorkMapTodoId.value = null
    draggedWorkMapCreationKind.value = null
    pressedWorkMapTodoId.value = null
    options.clearContentDrop()
    workMapDropProjectId.value = undefined
    workMapDropTodoStatus.value = null
  }

  function showWorkMapProjectDrop(event: WorkMapDropEvent, projectId: string | null) {
    const creationKind =
      draggedWorkMapCreationKind.value ??
      readWorkMapCreationDrag(event.dataTransfer as DataTransfer)
    if (!draggedWorkMapThreadId.value && !creationKind) return
    const target = projectId
      ? options.workMap.value?.projects.find((project) => project.id === projectId)
      : undefined
    if (creationKind === 'bot' && target?.parentId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = creationKind ? 'copy' : 'move'
    workMapDropProjectId.value = projectId
  }

  async function dropWorkMapThread(event: WorkMapDropEvent, projectId: string | null) {
    const threadId = draggedWorkMapThreadId.value
    const creationKind =
      draggedWorkMapCreationKind.value ??
      readWorkMapCreationDrag(event.dataTransfer as DataTransfer)
    if (!threadId && !creationKind) return
    const target = projectId
      ? options.workMap.value?.projects.find((project) => project.id === projectId)
      : undefined
    if (creationKind === 'bot' && target?.parentId) return
    event.preventDefault()
    event.stopPropagation()
    endWorkMapDrag()
    if (threadId || creationKind === 'chat') completeAgentConversationDropOutsideBoard()
    if (threadId) {
      await options.placeChat(threadId, projectId)
      return
    }
    if (creationKind === 'bot') {
      options.createProject(projectId ?? undefined)
      return
    }
    await options.createChat(projectId)
  }

  function showWorkMapTodoDrop(
    event: WorkMapDropEvent,
    projectId: string,
    status: AgentWorkMapTodoStatus
  ) {
    const todoId = draggedWorkMapTodoId.value
    const todo = options.workMap.value?.todos.find((candidate) => candidate.id === todoId)
    if (!todo || todo.projectId !== projectId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    workMapDropTodoStatus.value = `${projectId}:${status}`
  }

  async function dropWorkMapTodo(
    event: WorkMapDropEvent,
    projectId: string,
    status: AgentWorkMapTodoStatus
  ) {
    const todoId = draggedWorkMapTodoId.value
    const todo = options.workMap.value?.todos.find((candidate) => candidate.id === todoId)
    if (!todo || todo.projectId !== projectId) return
    event.preventDefault()
    event.stopPropagation()
    endWorkMapDrag()
    await options.setTodoStatus(todo.id, status)
  }

  function beginThreadDrag(event: DragEvent, thread: AgentConversationThread) {
    draggedWorkMapThreadId.value = thread.nativeThreadId
    writeAgentConversationDrag(event, threadDragPayload(thread))
  }

  function beginWorkMapCreationDrag(event: DragEvent, kind: WorkMapCreationKind) {
    draggedWorkMapCreationKind.value = kind
    writeWorkMapCreationDrag(event, kind)
    if (kind === 'chat') writeNewAgentConversationDrag(event)
  }

  function armThreadPointerDrag(event: PointerEvent, thread: AgentConversationThread) {
    pressedWorkMapThreadId.value = thread.id
    armAgentConversationPointerDrag(event, threadDragPayload(thread))
  }

  function releaseThreadPointerDrag() {
    pressedWorkMapThreadId.value = null
    pressedWorkMapTodoId.value = null
  }

  function armWorkMapTodoPointerDrag(todo: AgentWorkMapTodo) {
    pressedWorkMapTodoId.value = todo.id
  }

  function armNewThreadPointerDrag(event: PointerEvent) {
    armAgentConversationPointerDrag(event, newAgentConversationDragPayload())
  }

  return {
    armNewThreadPointerDrag,
    armThreadPointerDrag,
    armWorkMapTodoPointerDrag,
    beginWorkMapCreationDrag,
    beginThreadDrag,
    beginWorkMapTodoDrag,
    draggedWorkMapThreadId,
    draggedWorkMapCreationKind,
    draggedWorkMapTodoId,
    dropWorkMapThread,
    dropWorkMapTodo,
    endWorkMapDrag,
    pressedWorkMapThreadId,
    pressedWorkMapTodoId,
    releaseThreadPointerDrag,
    showWorkMapProjectDrop,
    showWorkMapTodoDrop,
    workMapDropProjectId,
    workMapDropTodoStatus
  }
}
