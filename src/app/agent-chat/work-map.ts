import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

import { agentRouterResponseError } from './router-response'

export type AgentWorkMapTodoStatus = 'todo' | 'in_motion' | 'finished'

export type AgentWorkMapProject = {
  createdAt: string
  id: string
  name: string
  parentId?: string
  updatedAt: string
}

export type AgentWorkMapPlacement = {
  manual: boolean
  projectId: string | null
  threadId: string
  updatedAt: string
}

export type AgentWorkMapTodo = {
  createdAt: string
  description?: string
  id: string
  planObjectId?: string
  planPageId?: string
  projectId: string
  status: AgentWorkMapTodoStatus
  threadId?: string
  title: string
  updatedAt: string
}

export type AgentWorkMap = {
  placements: AgentWorkMapPlacement[]
  projects: AgentWorkMapProject[]
  revision: number
  todos: AgentWorkMapTodo[]
}

type AgentWorkMapPayload = Omit<AgentWorkMap, 'todos'> & {
  todos: Array<
    Omit<AgentWorkMapTodo, 'status'> & {
      status: AgentWorkMapTodoStatus | 'needs_you' | 'review'
    }
  >
}

export type AgentTodoBriefReference = {
  id: string
  kind: 'board_object' | 'chat' | 'file' | 'image' | 'trace_evidence' | 'url'
  label: string
  note?: string
}

export type AgentTodoBrief = {
  acceptance?: string[]
  constraints?: string[]
  context?: string
  desiredOutcome?: string
  goal: string
  knownFacts?: string[]
  openQuestions?: string[]
  references?: AgentTodoBriefReference[]
  suggestedNextStep?: string
}

export type AgentWorkMapOperation =
  | { name: string; op: 'create_project'; parent_id?: string }
  | { op: 'place_chat'; project_id: string | null; thread_id: string }
  | {
      description?: string
      op: 'create_todo'
      plan_object_id?: string
      plan_page_id?: string
      project_id: string
      thread_id?: string | null
      title: string
    }
  | {
      description?: string
      op: 'update_todo'
      plan_object_id?: string | null
      plan_page_id?: string | null
      project_id?: string
      status?: AgentWorkMapTodoStatus
      thread_id?: string
      title?: string
      todo_id: string
    }

function normalizeAgentWorkMap(payload: AgentWorkMapPayload): AgentWorkMap {
  return {
    ...payload,
    todos: payload.todos.map((todo) => ({
      ...todo,
      status: todo.status === 'needs_you' || todo.status === 'review' ? 'in_motion' : todo.status
    }))
  }
}

export async function getAgentWorkMap(): Promise<AgentWorkMap> {
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/work-map')
  if (!response.ok) throw await agentRouterResponseError(response, 'Work map unavailable')
  return normalizeAgentWorkMap((await response.json()) as AgentWorkMapPayload)
}

export async function applyAgentWorkMap(input: {
  expectedRevision: number
  operations: AgentWorkMapOperation[]
  requestId?: string
}): Promise<AgentWorkMap> {
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/work-map/apply', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok) throw await agentRouterResponseError(response, 'Work map update failed')
  if (response.status === 204) return getAgentWorkMap()
  return normalizeAgentWorkMap((await response.json()) as AgentWorkMapPayload)
}

export async function createAgentTodoChat(input: {
  brief: AgentTodoBrief
  effort?: string
  expectedRevision: number
  model?: string
  projectId: string
  requestId: string
  title: string
}): Promise<{ threadId: string; workMap: AgentWorkMap }> {
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/work-map/todo-chats', {
    body: JSON.stringify(input),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok) throw await agentRouterResponseError(response, 'Todo chat creation failed')
  const payload = (await response.json()) as AgentWorkMapPayload & {
    thread?: { id?: string }
  }
  const threadId = payload.thread?.id
  if (!threadId) throw new Error('Todo chat creation returned no chat')
  return { threadId, workMap: normalizeAgentWorkMap(payload) }
}

export async function openAgentTodoPlan(todo: AgentWorkMapTodo): Promise<void> {
  if (!todo.planObjectId) throw new Error('This todo has no plan object yet')
  const response = await localWorkspaceAuthorityFetch('/navigation', {
    body: JSON.stringify({
      objectIds: [todo.planObjectId],
      ...(todo.planPageId ? { pageId: todo.planPageId } : {})
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok) throw await agentRouterResponseError(response, 'Plan could not be opened')
}
