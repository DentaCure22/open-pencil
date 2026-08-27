import type { InboxBriefingReport } from '@open-pencil/core/code-object'

import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

import type { AgentPromptAttachment } from './attachment-transfer'
import { agentRouterResponseError } from './router-response'

export type AgentWorkMapTodoStatus = 'todo' | 'in_motion'
export type AgentWorkMapBotAvatarVariant = 0 | 1 | 2 | 3 | 4 | 5

export type AgentWorkMapProject = {
  botId?: string
  createdAt: string
  id: string
  name: string
  parentId?: string
  spaceFrameId?: string
  spacePageId?: string
  updatedAt: string
  workspaceRoot?: string
}

export type AgentWorkMapPlacement = {
  manual: boolean
  projectId: string | null
  threadId: string
  updatedAt: string
}

export type AgentWorkMapBot = {
  avatarVariant: AgentWorkMapBotAvatarVariant
  createdAt: string
  id: string
  projectId: string | null
  threadId: string
  updatedAt: string
}

export type AgentWorkMapRoutine = {
  botId: string
  briefingObject?: boolean
  createdAt: string
  enabled: boolean
  everyMinutes?: number
  id: string
  lastRunAt?: string
  nextRunAt?: string
  prompt: string
  updatedAt: string
}

export type AgentWorkMapInboxItem = {
  archivedAt?: string
  botId: string
  briefing?: {
    content: string
    id: string
    report?: InboxBriefingReport
    title: string
  }
  createdAt: string
  id: string
  projectId: string | null
  readAt?: string
  routineId: string
  messageId?: string
  status: 'completed' | 'failed' | 'running' | 'stopped'
  summary: string
  threadId: string
  updatedAt: string
}

export type AgentWorkMapTodo = {
  archivedAt?: string
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
  bots: AgentWorkMapBot[]
  inbox: AgentWorkMapInboxItem[]
  placements: AgentWorkMapPlacement[]
  projects: AgentWorkMapProject[]
  revision: number
  routines: AgentWorkMapRoutine[]
  todos: AgentWorkMapTodo[]
}

type AgentWorkMapPayload = Omit<AgentWorkMap, 'bots' | 'inbox' | 'routines' | 'todos'> & {
  bots?: Array<Omit<AgentWorkMapBot, 'avatarVariant'> & { avatarVariant?: number }>
  inbox?: AgentWorkMapInboxItem[]
  routines?: AgentWorkMapRoutine[]
  todos: Array<
    Omit<AgentWorkMapTodo, 'status'> & {
      status: AgentWorkMapTodoStatus | 'finished' | 'needs_you' | 'review'
    }
  >
}

const WORK_MAP_BOT_AVATAR_VARIANT_COUNT = 6

function normalizeAgentWorkMapBots(bots: AgentWorkMapPayload['bots']): AgentWorkMapBot[] {
  const usage = Array<number>(WORK_MAP_BOT_AVATAR_VARIANT_COUNT).fill(0)

  for (const bot of bots ?? []) {
    if (
      Number.isInteger(bot.avatarVariant) &&
      bot.avatarVariant !== undefined &&
      bot.avatarVariant >= 0 &&
      bot.avatarVariant < WORK_MAP_BOT_AVATAR_VARIANT_COUNT
    ) {
      usage[bot.avatarVariant] += 1
    }
  }

  return (bots ?? []).map((bot) => {
    if (
      Number.isInteger(bot.avatarVariant) &&
      bot.avatarVariant !== undefined &&
      bot.avatarVariant >= 0 &&
      bot.avatarVariant < WORK_MAP_BOT_AVATAR_VARIANT_COUNT
    ) {
      return {
        ...bot,
        avatarVariant: bot.avatarVariant as AgentWorkMapBotAvatarVariant
      }
    }

    const avatarVariant = usage.indexOf(Math.min(...usage))
    usage[avatarVariant] += 1
    return {
      ...bot,
      avatarVariant: avatarVariant as AgentWorkMapBotAvatarVariant
    }
  })
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
  documentHtml?: string
  goal: string
  knownFacts?: string[]
  openQuestions?: string[]
  references?: AgentTodoBriefReference[]
  suggestedNextStep?: string
  title?: string
}

export type AgentWorkMapOperation =
  | { name: string; op: 'create_project'; parent_id?: string; project_id?: string }
  | {
      frame_id: string | null
      op: 'set_project_space'
      page_id: string | null
      project_id: string
    }
  | {
      op: 'set_project_workspace'
      project_id: string
      workspace_root: string | null
    }
  | { op: 'place_chat'; project_id: string | null; thread_id: string }
  | {
      bot_id?: string
      op: 'create_bot'
      project_id: string | null
      thread_id: string
    }
  | { bot_id: string; op: 'delete_bot' }
  | {
      bot_id: string
      create_briefing_object?: boolean
      every_minutes?: number
      next_run_at: string
      op: 'create_routine'
      prompt: string
      routine_id?: string
    }
  | {
      create_briefing_object: boolean
      op: 'update_routine'
      routine_id: string
    }
  | { routine_id: string; op: 'delete_routine' }
  | { inbox_id: string; op: 'mark_inbox_read' }
  | { inbox_id: string; op: 'archive_inbox' }
  | { op: 'delete_todo'; todo_id: string }
  | { op: 'archive_todo'; todo_id: string }
  | { op: 'restore_todo'; todo_id: string }
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
    bots: normalizeAgentWorkMapBots(payload.bots),
    inbox: payload.inbox ?? [],
    routines: payload.routines ?? [],
    todos: payload.todos.map((todo) => ({
      ...todo,
      ...(todo.status === 'finished' && !todo.archivedAt ? { archivedAt: todo.updatedAt } : {}),
      status: todo.status === 'todo' ? 'todo' : 'in_motion'
    }))
  }
}

export async function runAgentWorkMapRoutine(routineId: string): Promise<AgentWorkMap> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/work-map/routines/${encodeURIComponent(routineId)}/run`,
    { method: 'POST' }
  )
  if (!response.ok) throw await agentRouterResponseError(response, 'Bot routine could not start')
  return normalizeAgentWorkMap((await response.json()) as AgentWorkMapPayload)
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

export async function setAgentWorkMapTodosArchivedForThread(
  threadId: string,
  archived: boolean
): Promise<AgentWorkMap> {
  const workMap = await getAgentWorkMap()
  const todos = workMap.todos.filter(
    (todo) => todo.threadId === threadId && Boolean(todo.archivedAt) !== archived
  )
  if (!todos.length) return workMap
  return applyAgentWorkMap({
    expectedRevision: workMap.revision,
    operations: todos.map<AgentWorkMapOperation>((todo) =>
      archived ? { op: 'archive_todo', todo_id: todo.id } : { op: 'restore_todo', todo_id: todo.id }
    )
  })
}

export async function createAgentTodoChat(input: {
  attachments?: AgentPromptAttachment[]
  brief: AgentTodoBrief
  effort?: string
  expectedRevision: number
  model?: string
  projectId: string
  requestId: string
  title?: string
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

export async function updateAgentTodoDraft(input: {
  attachments?: AgentPromptAttachment[]
  brief: AgentTodoBrief
  threadId: string
}): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(input.threadId)}/todo-draft`,
    {
      body: JSON.stringify({
        attachments: input.attachments,
        brief: input.brief
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    }
  )
  if (!response.ok) throw await agentRouterResponseError(response, 'Todo update failed')
}

function escapeTodoDocumentText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function appendTodoDocumentBlocks(documentHtml: string, blocks: string): string {
  if (!blocks) return documentHtml
  const mainEnd = documentHtml.toLowerCase().lastIndexOf('</main>')
  if (mainEnd !== -1)
    return `${documentHtml.slice(0, mainEnd)}${blocks}\n${documentHtml.slice(mainEnd)}`
  const bodyEnd = documentHtml.toLowerCase().lastIndexOf('</body>')
  if (bodyEnd !== -1)
    return `${documentHtml.slice(0, bodyEnd)}${blocks}\n${documentHtml.slice(bodyEnd)}`
  return `${documentHtml}\n${blocks}`
}

function todoDocumentContentBlocks(
  text: string | undefined,
  attachments: AgentPromptAttachment[] | undefined
): string {
  const note = text
    ? `<section data-kind="added-note"><h2>Added note</h2><p>${escapeTodoDocumentText(text).replaceAll('\n', '<br>')}</p></section>`
    : ''
  const references = attachments?.length
    ? `<section data-todo-references><h2>References</h2><div class="references">${attachments
        .map(
          (attachment) =>
            `<article data-todo-reference="${escapeTodoDocumentText(attachment.path)}" contenteditable="false"><span aria-hidden="true">${attachment.type?.startsWith('image/') || attachment.visual?.kind === 'image' ? 'Image' : 'File'}</span><strong>${escapeTodoDocumentText(attachment.name)}</strong>${attachment.visual?.summary ? `<small>${escapeTodoDocumentText(attachment.visual.summary)}</small>` : ''}</article>`
        )
        .join('')}</div></section>`
    : ''
  return `${note}${references}`
}

export function appendAgentTodoBrief(
  brief: AgentTodoBrief,
  input: { attachments?: AgentPromptAttachment[]; text?: string }
): AgentTodoBrief {
  const text = input.text?.trim()
  const references = [
    ...(brief.references ?? []),
    ...(input.attachments ?? []).map(
      (attachment): AgentTodoBriefReference => ({
        id: attachment.path,
        kind:
          attachment.type?.startsWith('image/') || attachment.visual?.kind === 'image'
            ? 'image'
            : 'file',
        label: attachment.name,
        ...(attachment.visual?.summary ? { note: attachment.visual.summary } : {})
      })
    )
  ]
  if (references.length > 24) throw new Error('A Todo can hold up to 24 references.')
  const documentBlocks = todoDocumentContentBlocks(text, input.attachments)
  return {
    ...brief,
    ...(text ? { context: [brief.context?.trim(), text].filter(Boolean).join('\n\n') } : {}),
    ...(brief.documentHtml && documentBlocks
      ? {
          documentHtml: appendTodoDocumentBlocks(brief.documentHtml, documentBlocks)
        }
      : {}),
    ...(references.length ? { references } : {})
  }
}

export async function openAgentWorkMapProjectPage(pageId: string): Promise<void> {
  const destination = pageId.trim()
  if (!destination) throw new Error('This project has no Board workspace yet')
  const response = await localWorkspaceAuthorityFetch('/navigation', {
    body: JSON.stringify({ pageId: destination }),
    headers: { 'content-type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok)
    throw await agentRouterResponseError(response, 'Board workspace could not be opened')
}
