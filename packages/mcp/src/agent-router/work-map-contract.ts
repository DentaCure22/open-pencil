import { randomInt } from 'node:crypto'

import type { InboxBriefingReport } from '@open-pencil/core/code-object'

export const WORK_MAP_TODO_STATUSES = ['todo', 'in_motion'] as const
export const WORK_MAP_BOT_AVATAR_VARIANTS = [0, 1, 2, 3, 4, 5] as const

export type WorkMapTodoStatus = (typeof WORK_MAP_TODO_STATUSES)[number]
export type WorkMapBotAvatarVariant = (typeof WORK_MAP_BOT_AVATAR_VARIANTS)[number]

export function isWorkMapBotAvatarVariant(value: unknown): value is WorkMapBotAvatarVariant {
  return WORK_MAP_BOT_AVATAR_VARIANTS.includes(value as WorkMapBotAvatarVariant)
}

export type WorkMapProject = {
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

export type WorkMapPlacement = {
  manual: boolean
  projectId: string | null
  threadId: string
  updatedAt: string
}

export type WorkMapBot = {
  avatarVariant: WorkMapBotAvatarVariant
  createdAt: string
  id: string
  projectId: string | null
  threadId: string
  updatedAt: string
}

export function nextWorkMapBotAvatarVariant(
  bots: readonly Pick<WorkMapBot, 'avatarVariant'>[]
): WorkMapBotAvatarVariant {
  const counts = WORK_MAP_BOT_AVATAR_VARIANTS.map((variant) => ({
    count: 0,
    variant
  }))
  for (const bot of bots) counts[bot.avatarVariant].count += 1
  const leastUsedCount = Math.min(...counts.map((entry) => entry.count))
  const candidates = counts.filter((entry) => entry.count === leastUsedCount)
  return candidates[randomInt(candidates.length)]?.variant ?? WORK_MAP_BOT_AVATAR_VARIANTS[0]
}

export type WorkMapRoutine = {
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

export type WorkMapInboxStatus = 'completed' | 'failed' | 'running' | 'stopped'

export type WorkMapInboxBriefing = {
  content: string
  id: string
  report?: InboxBriefingReport
  title: string
}

export type WorkMapInboxItem = {
  archivedAt?: string
  botId: string
  briefing?: WorkMapInboxBriefing
  createdAt: string
  id: string
  projectId: string | null
  readAt?: string
  routineId: string
  messageId?: string
  status: WorkMapInboxStatus
  summary: string
  threadId: string
  updatedAt: string
}

export type WorkMapTodo = {
  archivedAt?: string
  createdAt: string
  description?: string
  id: string
  planObjectId?: string
  planPageId?: string
  projectId: string
  status: WorkMapTodoStatus
  threadId?: string
  title: string
  updatedAt: string
}

export type WorkMapSnapshot = {
  bots: WorkMapBot[]
  inbox: WorkMapInboxItem[]
  placements: WorkMapPlacement[]
  projects: WorkMapProject[]
  revision: number
  routines: WorkMapRoutine[]
  todos: WorkMapTodo[]
  version: 2
}

export type WorkMapOperation =
  | {
      name: string
      op: 'create_project'
      parent_id?: string
      project_id?: string
    }
  | { name: string; op: 'rename_project'; project_id: string }
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
      thread_id?: string
      title: string
      todo_id?: string
    }
  | {
      description?: string
      op: 'update_todo'
      plan_object_id?: string | null
      plan_page_id?: string | null
      project_id?: string
      status?: WorkMapTodoStatus
      thread_id?: string | null
      title?: string
      todo_id: string
    }

export type WorkMapActor =
  | { createdThreadIds?: string[]; currentThreadId?: string; kind: 'agent' }
  | { kind: 'system' }
  | { kind: 'user' }

export type WorkMapOperationResult = {
  changed: boolean
  id: string
  op: WorkMapOperation['op']
}

export type WorkMapApplyReceipt = {
  previousRevision: number
  requestId?: string
  results: WorkMapOperationResult[]
  revision: number
}
