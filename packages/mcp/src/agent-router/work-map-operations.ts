import { randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  nextWorkMapBotAvatarVariant,
  WORK_MAP_TODO_STATUSES,
  type WorkMapActor,
  type WorkMapBot,
  type WorkMapInboxItem,
  type WorkMapOperation,
  type WorkMapOperationResult,
  type WorkMapProject,
  type WorkMapRoutine,
  type WorkMapSnapshot,
  type WorkMapTodo,
  type WorkMapTodoStatus
} from './work-map-contract'

type WorkMapState = Pick<
  WorkMapSnapshot,
  'bots' | 'inbox' | 'placements' | 'projects' | 'routines' | 'todos'
>
type Operation<Kind extends WorkMapOperation['op']> = Extract<WorkMapOperation, { op: Kind }>

const MAX_PROJECT_NAME = 120
const MAX_TODO_TITLE = 240
const MAX_TODO_DESCRIPTION = 4_000
const MAX_ROUTINE_PROMPT = 8_000
const UPDATE_TODO_FIELDS = [
  'description',
  'plan_object_id',
  'plan_page_id',
  'project_id',
  'status',
  'thread_id',
  'title'
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

function isTodoStatus(value: unknown): value is WorkMapTodoStatus {
  return WORK_MAP_TODO_STATUSES.includes(value as WorkMapTodoStatus)
}

function parseCreateProject(operation: Record<string, unknown>): Operation<'create_project'> {
  if (
    typeof operation.name !== 'string' ||
    !isOptionalString(operation.parent_id) ||
    !isOptionalString(operation.project_id)
  ) {
    throw new TypeError('create_project requires name and optional string IDs.')
  }
  return operation as Operation<'create_project'>
}

function parseRenameProject(operation: Record<string, unknown>): Operation<'rename_project'> {
  if (typeof operation.name !== 'string' || typeof operation.project_id !== 'string') {
    throw new TypeError('rename_project requires project_id and name.')
  }
  return operation as Operation<'rename_project'>
}

function parseSetProjectSpace(operation: Record<string, unknown>): Operation<'set_project_space'> {
  const validFrame = operation.frame_id === null || typeof operation.frame_id === 'string'
  const validPage = operation.page_id === null || typeof operation.page_id === 'string'
  if (
    typeof operation.project_id !== 'string' ||
    !validFrame ||
    !validPage ||
    (operation.frame_id === null) !== (operation.page_id === null)
  ) {
    throw new TypeError(
      'set_project_space requires project_id and either both page_id and frame_id or both null.'
    )
  }
  return operation as Operation<'set_project_space'>
}

function parseSetProjectWorkspace(
  operation: Record<string, unknown>
): Operation<'set_project_workspace'> {
  if (
    typeof operation.project_id !== 'string' ||
    (operation.workspace_root !== null && typeof operation.workspace_root !== 'string')
  ) {
    throw new TypeError('set_project_workspace requires project_id and a workspace_root or null.')
  }
  return operation as Operation<'set_project_workspace'>
}

function parsePlaceChat(operation: Record<string, unknown>): Operation<'place_chat'> {
  if (
    typeof operation.thread_id !== 'string' ||
    (operation.project_id !== null && typeof operation.project_id !== 'string')
  ) {
    throw new TypeError('place_chat requires thread_id and a project_id or null.')
  }
  return operation as Operation<'place_chat'>
}

function parseCreateBot(operation: Record<string, unknown>): Operation<'create_bot'> {
  if (
    !isOptionalString(operation.bot_id) ||
    typeof operation.thread_id !== 'string' ||
    (operation.project_id !== null && typeof operation.project_id !== 'string')
  ) {
    throw new TypeError('create_bot requires thread_id, a project_id or null, and an optional ID.')
  }
  return operation as Operation<'create_bot'>
}

function parseDeleteBot(operation: Record<string, unknown>): Operation<'delete_bot'> {
  if (typeof operation.bot_id !== 'string') throw new TypeError('delete_bot requires bot_id.')
  return operation as Operation<'delete_bot'>
}

function parseCreateRoutine(operation: Record<string, unknown>): Operation<'create_routine'> {
  if (
    typeof operation.bot_id !== 'string' ||
    (operation.create_briefing_object !== undefined &&
      typeof operation.create_briefing_object !== 'boolean') ||
    typeof operation.next_run_at !== 'string' ||
    typeof operation.prompt !== 'string' ||
    !isOptionalString(operation.routine_id) ||
    !(
      operation.every_minutes === undefined ||
      (typeof operation.every_minutes === 'number' && Number.isInteger(operation.every_minutes))
    )
  ) {
    throw new TypeError('create_routine contains invalid fields.')
  }
  return operation as Operation<'create_routine'>
}

function parseUpdateRoutine(operation: Record<string, unknown>): Operation<'update_routine'> {
  if (
    typeof operation.routine_id !== 'string' ||
    typeof operation.create_briefing_object !== 'boolean'
  ) {
    throw new TypeError('update_routine requires routine_id and create_briefing_object.')
  }
  return operation as Operation<'update_routine'>
}

function parseDeleteRoutine(operation: Record<string, unknown>): Operation<'delete_routine'> {
  if (typeof operation.routine_id !== 'string') {
    throw new TypeError('delete_routine requires routine_id.')
  }
  return operation as Operation<'delete_routine'>
}

function parseMarkInboxRead(operation: Record<string, unknown>): Operation<'mark_inbox_read'> {
  if (typeof operation.inbox_id !== 'string') {
    throw new TypeError('mark_inbox_read requires inbox_id.')
  }
  return operation as Operation<'mark_inbox_read'>
}

function parseArchiveInbox(operation: Record<string, unknown>): Operation<'archive_inbox'> {
  if (typeof operation.inbox_id !== 'string') {
    throw new TypeError('archive_inbox requires inbox_id.')
  }
  return operation as Operation<'archive_inbox'>
}

function parseCreateTodo(operation: Record<string, unknown>): Operation<'create_todo'> {
  if (
    typeof operation.project_id !== 'string' ||
    typeof operation.title !== 'string' ||
    !isOptionalString(operation.description) ||
    !isOptionalString(operation.plan_object_id) ||
    !isOptionalString(operation.plan_page_id) ||
    !isOptionalString(operation.thread_id) ||
    !isOptionalString(operation.todo_id)
  ) {
    throw new TypeError('create_todo requires project_id, title, and optional text fields.')
  }
  return operation as Operation<'create_todo'>
}

function parseDeleteTodo(operation: Record<string, unknown>): Operation<'delete_todo'> {
  if (typeof operation.todo_id !== 'string') {
    throw new TypeError('delete_todo requires todo_id.')
  }
  return operation as Operation<'delete_todo'>
}

function parseArchiveTodo(operation: Record<string, unknown>): Operation<'archive_todo'> {
  if (typeof operation.todo_id !== 'string') {
    throw new TypeError('archive_todo requires todo_id.')
  }
  return operation as Operation<'archive_todo'>
}

function parseRestoreTodo(operation: Record<string, unknown>): Operation<'restore_todo'> {
  if (typeof operation.todo_id !== 'string') {
    throw new TypeError('restore_todo requires todo_id.')
  }
  return operation as Operation<'restore_todo'>
}

function parseUpdateTodo(operation: Record<string, unknown>): Operation<'update_todo'> {
  if (
    typeof operation.todo_id !== 'string' ||
    !isOptionalString(operation.description) ||
    !isOptionalNullableString(operation.plan_object_id) ||
    !isOptionalNullableString(operation.plan_page_id) ||
    !isOptionalString(operation.project_id) ||
    !isOptionalString(operation.title) ||
    !isOptionalNullableString(operation.thread_id) ||
    !(operation.status === undefined || isTodoStatus(operation.status))
  ) {
    throw new TypeError('update_todo contains invalid fields.')
  }
  if (!UPDATE_TODO_FIELDS.some((field) => operation[field] !== undefined)) {
    throw new TypeError('update_todo needs at least one change.')
  }
  return operation as Operation<'update_todo'>
}

function parseWorkMapOperation(value: unknown): WorkMapOperation {
  if (!isRecord(value) || typeof value.op !== 'string') {
    throw new TypeError('Every Work Map operation needs an op value.')
  }
  if (value.op === 'create_project') return parseCreateProject(value)
  if (value.op === 'rename_project') return parseRenameProject(value)
  if (value.op === 'set_project_space') return parseSetProjectSpace(value)
  if (value.op === 'set_project_workspace') return parseSetProjectWorkspace(value)
  if (value.op === 'place_chat') return parsePlaceChat(value)
  if (value.op === 'create_bot') return parseCreateBot(value)
  if (value.op === 'delete_bot') return parseDeleteBot(value)
  if (value.op === 'create_routine') return parseCreateRoutine(value)
  if (value.op === 'update_routine') return parseUpdateRoutine(value)
  if (value.op === 'delete_routine') return parseDeleteRoutine(value)
  if (value.op === 'mark_inbox_read') return parseMarkInboxRead(value)
  if (value.op === 'archive_inbox') return parseArchiveInbox(value)
  if (value.op === 'create_todo') return parseCreateTodo(value)
  if (value.op === 'delete_todo') return parseDeleteTodo(value)
  if (value.op === 'archive_todo') return parseArchiveTodo(value)
  if (value.op === 'restore_todo') return parseRestoreTodo(value)
  if (value.op === 'update_todo') return parseUpdateTodo(value)
  throw new TypeError(`Unknown Work Map operation "${value.op}".`)
}

export function parseWorkMapOperations(value: unknown): WorkMapOperation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TypeError('Work Map apply requires 1-100 operations.')
  }
  return value.map(parseWorkMapOperation)
}

function boundedText(value: string, field: string, maximum: number): string {
  const text = value.trim()
  if (!text) throw new TypeError(`${field} is required.`)
  if (text.length > maximum) throw new TypeError(`${field} is too long.`)
  return text
}

function optionalBoundedText(
  value: string | undefined,
  field: string,
  maximum: number
): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  if (text.length > maximum) throw new TypeError(`${field} is too long.`)
  return text || undefined
}

function updatedOptionalText(
  value: string | null | undefined,
  current: string | undefined,
  field: string,
  required = false
) {
  if (value === undefined) return current
  if (value === null) return undefined
  return required ? boundedText(value, field, 240) : optionalBoundedText(value, field, 240)
}

function requireProject(state: WorkMapState, projectId: string): WorkMapProject {
  const project = state.projects.find((candidate) => candidate.id === projectId)
  if (!project) throw new TypeError(`Work Map project "${projectId}" was not found.`)
  return project
}

function requireTodo(state: WorkMapState, todoId: string): WorkMapTodo {
  const todo = state.todos.find((candidate) => candidate.id === todoId)
  if (!todo) throw new TypeError(`Work Map todo "${todoId}" was not found.`)
  return todo
}

function requireBot(state: WorkMapState, botId: string): WorkMapBot {
  const bot = state.bots.find((candidate) => candidate.id === botId)
  if (!bot) throw new TypeError(`Work Map bot "${botId}" was not found.`)
  return bot
}

function requireRoutine(state: WorkMapState, routineId: string): WorkMapRoutine {
  const routine = state.routines.find((candidate) => candidate.id === routineId)
  if (!routine) throw new TypeError(`Work Map routine "${routineId}" was not found.`)
  return routine
}

function requireInboxItem(state: WorkMapState, inboxId: string): WorkMapInboxItem {
  const item = state.inbox.find((candidate) => candidate.id === inboxId)
  if (!item) throw new TypeError(`Work Map inbox item "${inboxId}" was not found.`)
  return item
}

function assertUser(actor: WorkMapActor, action: string): void {
  if (actor.kind !== 'user') throw new TypeError(`Only the user can ${action}.`)
}

function assertSiblingNameAvailable(
  state: WorkMapState,
  name: string,
  parentId: string | undefined,
  exceptId?: string
): void {
  const duplicate = state.projects.find(
    (project) =>
      project.id !== exceptId &&
      project.parentId === parentId &&
      project.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
  )
  if (duplicate) throw new TypeError(`A sibling Work Map project named "${name}" already exists.`)
}

function assertAgentThread(actor: WorkMapActor, threadId: string): void {
  if (actor.kind !== 'agent' || !actor.currentThreadId) return
  if (threadId !== actor.currentThreadId && !actor.createdThreadIds?.includes(threadId)) {
    throw new TypeError('A Board worker can organize only its active chat.')
  }
}

function createProject(
  state: WorkMapState,
  operation: Operation<'create_project'>,
  now: string
): WorkMapOperationResult {
  const name = boundedText(operation.name, 'Project name', MAX_PROJECT_NAME)
  const parentId = operation.parent_id?.trim() || undefined
  if (parentId) {
    const parent = requireProject(state, parentId)
    if (parent.parentId) throw new TypeError('Work Map supports only one subproject level.')
  }
  assertSiblingNameAvailable(state, name, parentId)
  const id = operation.project_id?.trim() || `project:${randomUUID()}`
  if (state.projects.some((project) => project.id === id)) {
    throw new TypeError(`Work Map project "${id}" already exists.`)
  }
  state.projects.push({
    createdAt: now,
    id,
    name,
    ...(parentId ? { parentId } : {}),
    updatedAt: now
  })
  return { changed: true, id, op: operation.op }
}

function renameProject(
  state: WorkMapState,
  operation: Operation<'rename_project'>,
  now: string
): WorkMapOperationResult {
  const project = requireProject(state, operation.project_id.trim())
  const name = boundedText(operation.name, 'Project name', MAX_PROJECT_NAME)
  assertSiblingNameAvailable(state, name, project.parentId, project.id)
  const changed = project.name !== name
  if (changed) Object.assign(project, { name, updatedAt: now })
  return { changed, id: project.id, op: operation.op }
}

function assertProjectSpaceHierarchy(
  state: WorkMapState,
  project: WorkMapProject,
  frameId: string | undefined,
  pageId: string | undefined
): void {
  if (project.parentId && frameId && pageId) {
    const parent = requireProject(state, project.parentId)
    if (!parent.spaceFrameId || !parent.spacePageId) {
      throw new TypeError('A sub-bot Board space requires its parent Bot space to be bound first.')
    }
    if (parent.spacePageId !== pageId) {
      throw new TypeError(
        'A sub-bot Board space must use the same Board page as its parent Bot space.'
      )
    }
  }

  const boundSubBot = state.projects.find(
    (candidate) =>
      candidate.parentId === project.id && candidate.spaceFrameId && candidate.spacePageId
  )
  if (boundSubBot && (project.spaceFrameId !== frameId || project.spacePageId !== pageId)) {
    throw new TypeError(
      `Cannot change parent Bot space while sub-bot "${boundSubBot.id}" is still bound inside it.`
    )
  }
}

function setProjectSpace(
  state: WorkMapState,
  operation: Operation<'set_project_space'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const project = requireProject(state, boundedText(operation.project_id, 'Project ID', 240))
  const frameId =
    operation.frame_id === null
      ? undefined
      : boundedText(operation.frame_id, 'Project space frame ID', 240)
  const pageId =
    operation.page_id === null
      ? undefined
      : boundedText(operation.page_id, 'Project space page ID', 240)
  assertProjectSpaceHierarchy(state, project, frameId, pageId)

  if (actor.kind === 'agent') {
    if (!actor.currentThreadId) {
      throw new TypeError('A Board worker needs an active chat to bind a project space.')
    }
    const placement = state.placements.find(
      (candidate) => candidate.threadId === actor.currentThreadId
    )
    if (placement?.projectId !== project.id) {
      throw new TypeError('A Board worker can bind only its active chat project space.')
    }
    if (!frameId || !pageId) {
      throw new TypeError('Only the user can clear a project space.')
    }
    if (
      (project.spaceFrameId && project.spaceFrameId !== frameId) ||
      (project.spacePageId && project.spacePageId !== pageId)
    ) {
      throw new TypeError('A Board worker cannot replace an existing project space.')
    }
  }

  const changed = project.spaceFrameId !== frameId || project.spacePageId !== pageId
  if (changed) {
    Object.assign(project, { updatedAt: now })
    if (frameId && pageId) {
      project.spaceFrameId = frameId
      project.spacePageId = pageId
    } else {
      delete project.spaceFrameId
      delete project.spacePageId
    }
  }
  return { changed, id: project.id, op: operation.op }
}

function setProjectWorkspace(
  state: WorkMapState,
  operation: Operation<'set_project_workspace'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  assertUser(actor, 'change a project workspace')
  const project = requireProject(state, boundedText(operation.project_id, 'Project ID', 240))
  const suppliedRoot = operation.workspace_root?.trim()
  const workspaceRoot = suppliedRoot ? path.resolve(suppliedRoot) : undefined
  if (workspaceRoot) {
    if (!path.isAbsolute(suppliedRoot ?? '') || workspaceRoot === path.parse(workspaceRoot).root) {
      throw new TypeError(
        'A project workspace must be an absolute directory below the filesystem root.'
      )
    }
    const duplicate = state.projects.find(
      (candidate) => candidate.id !== project.id && candidate.workspaceRoot === workspaceRoot
    )
    if (duplicate) {
      throw new TypeError(
        `That workspace is already bound to Work Map project "${duplicate.name}".`
      )
    }
  }
  const changed = project.workspaceRoot !== workspaceRoot
  if (changed) {
    project.updatedAt = now
    if (workspaceRoot) project.workspaceRoot = workspaceRoot
    else delete project.workspaceRoot
  }
  return { changed, id: project.id, op: operation.op }
}

function placeChat(
  state: WorkMapState,
  operation: Operation<'place_chat'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const threadId = boundedText(operation.thread_id, 'Thread ID', 240)
  assertAgentThread(actor, threadId)
  const projectId = operation.project_id?.trim() || null
  if (projectId) requireProject(state, projectId)
  const existing = state.placements.find((placement) => placement.threadId === threadId)
  if (existing?.manual && actor.kind === 'agent' && existing.projectId !== projectId) {
    throw new TypeError('Manual chat placement is locked and cannot be changed by an agent.')
  }
  if (existing?.manual && actor.kind === 'system' && existing.projectId !== projectId) {
    return { changed: false, id: threadId, op: operation.op }
  }
  if (existing) {
    const manual = actor.kind === 'user' || existing.manual
    const changed = existing.projectId !== projectId || existing.manual !== manual
    if (changed) Object.assign(existing, { manual, projectId, updatedAt: now })
    return { changed, id: threadId, op: operation.op }
  }
  state.placements.push({
    manual: actor.kind === 'user',
    projectId,
    threadId,
    updatedAt: now
  })
  return { changed: true, id: threadId, op: operation.op }
}

function createBot(
  state: WorkMapState,
  operation: Operation<'create_bot'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const threadId = boundedText(operation.thread_id, 'Thread ID', 240)
  assertAgentThread(actor, threadId)
  const projectId = operation.project_id?.trim() || null
  const project = projectId ? requireProject(state, projectId) : null
  if (state.bots.some((bot) => bot.threadId === threadId)) {
    throw new TypeError('This chat is already a Bot.')
  }
  const id = operation.bot_id?.trim() || `bot:${randomUUID()}`
  if (state.bots.some((bot) => bot.id === id)) {
    throw new TypeError(`Work Map bot "${id}" already exists.`)
  }
  state.bots.push({
    avatarVariant: nextWorkMapBotAvatarVariant(state.bots),
    createdAt: now,
    id,
    projectId,
    threadId,
    updatedAt: now
  })
  if (project && !project.botId) Object.assign(project, { botId: id, updatedAt: now })
  return { changed: true, id, op: operation.op }
}

function deleteBot(
  state: WorkMapState,
  operation: Operation<'delete_bot'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  assertUser(actor, 'manage Bots')
  const botId = boundedText(operation.bot_id, 'Bot ID', 240)
  const index = state.bots.findIndex((bot) => bot.id === botId)
  if (index === -1) throw new TypeError(`Work Map bot "${botId}" was not found.`)
  const [removed] = state.bots.splice(index, 1)
  const project = removed?.projectId
    ? state.projects.find((candidate) => candidate.id === removed.projectId)
    : undefined
  if (project?.botId === botId) {
    delete project.botId
    project.updatedAt = now
  }
  state.routines = state.routines.filter((routine) => routine.botId !== botId)
  return { changed: true, id: botId, op: operation.op }
}

function createRoutine(
  state: WorkMapState,
  operation: Operation<'create_routine'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const botId = boundedText(operation.bot_id, 'Bot ID', 240)
  const bot = requireBot(state, botId)
  assertAgentThread(actor, bot.threadId)
  const prompt = boundedText(operation.prompt, 'Routine prompt', MAX_ROUTINE_PROMPT)
  const nextRunAt = boundedText(operation.next_run_at, 'Next run time', 80)
  if (!Number.isFinite(Date.parse(nextRunAt))) throw new TypeError('Next run time is invalid.')
  const everyMinutes = operation.every_minutes
  if (everyMinutes !== undefined && (everyMinutes < 1 || everyMinutes > 525_600)) {
    throw new TypeError('Routine interval must be between 1 minute and 1 year.')
  }
  const id = operation.routine_id?.trim() || `routine:${randomUUID()}`
  if (state.routines.some((routine) => routine.id === id)) {
    throw new TypeError(`Work Map routine "${id}" already exists.`)
  }
  state.routines.push({
    botId,
    ...(operation.create_briefing_object ? { briefingObject: true } : {}),
    createdAt: now,
    enabled: true,
    ...(everyMinutes ? { everyMinutes } : {}),
    id,
    nextRunAt: new Date(nextRunAt).toISOString(),
    prompt,
    updatedAt: now
  })
  return { changed: true, id, op: operation.op }
}

function updateRoutine(
  state: WorkMapState,
  operation: Operation<'update_routine'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const routine = requireRoutine(state, boundedText(operation.routine_id, 'Routine ID', 240))
  const bot = requireBot(state, routine.botId)
  assertAgentThread(actor, bot.threadId)
  const changed = Boolean(routine.briefingObject) !== operation.create_briefing_object
  if (changed) {
    if (operation.create_briefing_object) routine.briefingObject = true
    else delete routine.briefingObject
    routine.updatedAt = now
  }
  return { changed, id: routine.id, op: operation.op }
}

function deleteRoutine(
  state: WorkMapState,
  operation: Operation<'delete_routine'>,
  actor: WorkMapActor
): WorkMapOperationResult {
  assertUser(actor, 'manage Bot schedules')
  const routine = requireRoutine(state, boundedText(operation.routine_id, 'Routine ID', 240))
  state.routines.splice(state.routines.indexOf(routine), 1)
  return { changed: true, id: routine.id, op: operation.op }
}

function markInboxRead(
  state: WorkMapState,
  operation: Operation<'mark_inbox_read'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  assertUser(actor, 'manage the Inbox')
  const item = requireInboxItem(state, boundedText(operation.inbox_id, 'Inbox ID', 240))
  const changed = !item.readAt
  if (changed) {
    item.readAt = now
    item.updatedAt = now
  }
  return { changed, id: item.id, op: operation.op }
}

function archiveInbox(
  state: WorkMapState,
  operation: Operation<'archive_inbox'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  assertUser(actor, 'manage the Inbox')
  const item = requireInboxItem(state, boundedText(operation.inbox_id, 'Inbox ID', 240))
  const changed = !item.archivedAt
  if (changed) {
    item.archivedAt = now
    item.updatedAt = now
  }
  return { changed, id: item.id, op: operation.op }
}

function createTodo(
  state: WorkMapState,
  operation: Operation<'create_todo'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const title = boundedText(operation.title, 'Todo title', MAX_TODO_TITLE)
  const projectId = boundedText(operation.project_id, 'Project ID', 240)
  requireProject(state, projectId)
  const threadId = operation.thread_id?.trim() || undefined
  if (threadId) assertAgentThread(actor, threadId)
  const description = optionalBoundedText(
    operation.description,
    'Todo description',
    MAX_TODO_DESCRIPTION
  )
  const planObjectId = optionalBoundedText(operation.plan_object_id, 'Plan object ID', 240)
  const planPageId = optionalBoundedText(operation.plan_page_id, 'Plan page ID', 240)
  const id = operation.todo_id?.trim() || `todo:${randomUUID()}`
  if (state.todos.some((todo) => todo.id === id)) {
    throw new TypeError(`Work Map todo "${id}" already exists.`)
  }
  state.todos.push({
    createdAt: now,
    ...(description ? { description } : {}),
    id,
    ...(planObjectId ? { planObjectId } : {}),
    ...(planPageId ? { planPageId } : {}),
    projectId,
    status: 'todo',
    ...(threadId ? { threadId } : {}),
    title,
    updatedAt: now
  })
  return { changed: true, id, op: operation.op }
}

function deleteTodo(
  state: WorkMapState,
  operation: Operation<'delete_todo'>
): WorkMapOperationResult {
  const todoId = boundedText(operation.todo_id, 'Todo ID', 240)
  const index = state.todos.findIndex((todo) => todo.id === todoId)
  if (index === -1) throw new TypeError(`Work Map todo "${todoId}" does not exist.`)
  state.todos.splice(index, 1)
  return { changed: true, id: todoId, op: operation.op }
}

function setTodoArchived(
  state: WorkMapState,
  operation: Operation<'archive_todo'> | Operation<'restore_todo'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  if (actor.kind !== 'user') {
    throw new TypeError('Only the user can archive or restore a Work Map chat.')
  }
  const todo = requireTodo(state, boundedText(operation.todo_id, 'Todo ID', 240))
  const archived = operation.op === 'archive_todo'
  const changed = Boolean(todo.archivedAt) !== archived
  if (changed) {
    if (archived) todo.archivedAt = now
    else delete todo.archivedAt
    todo.updatedAt = now
  }
  return { changed, id: todo.id, op: operation.op }
}

function updateTodo(
  state: WorkMapState,
  operation: Operation<'update_todo'>,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  const todo = requireTodo(state, operation.todo_id.trim())
  if (
    actor.kind === 'agent' &&
    (!todo.threadId ||
      (todo.threadId !== actor.currentThreadId && !actor.createdThreadIds?.includes(todo.threadId)))
  ) {
    throw new TypeError('A Board worker can update only the Todo linked to its active chat.')
  }
  if (todo.archivedAt && actor.kind === 'agent') {
    throw new TypeError('Archived Work Map chats are outside the active agent directory.')
  }
  const title =
    operation.title === undefined
      ? todo.title
      : boundedText(operation.title, 'Todo title', MAX_TODO_TITLE)
  const projectId = operation.project_id?.trim() || todo.projectId
  requireProject(state, projectId)
  const description =
    operation.description === undefined
      ? todo.description
      : optionalBoundedText(operation.description, 'Todo description', MAX_TODO_DESCRIPTION)
  const planObjectId = updatedOptionalText(
    operation.plan_object_id,
    todo.planObjectId,
    'Plan object ID'
  )
  const planPageId = updatedOptionalText(operation.plan_page_id, todo.planPageId, 'Plan page ID')
  const threadId = updatedOptionalText(operation.thread_id, todo.threadId, 'Thread ID', true)
  if (threadId) assertAgentThread(actor, threadId)
  const status = operation.status ?? todo.status
  const changed = [
    title !== todo.title,
    projectId !== todo.projectId,
    description !== todo.description,
    planObjectId !== todo.planObjectId,
    planPageId !== todo.planPageId,
    threadId !== todo.threadId,
    status !== todo.status
  ].some(Boolean)
  if (changed) {
    Object.assign(todo, { projectId, status, title, updatedAt: now })
    if (description) todo.description = description
    else delete todo.description
    if (planObjectId) todo.planObjectId = planObjectId
    else delete todo.planObjectId
    if (planPageId) todo.planPageId = planPageId
    else delete todo.planPageId
    if (threadId) todo.threadId = threadId
    else delete todo.threadId
  }
  return { changed, id: todo.id, op: operation.op }
}

export function applyWorkMapOperation(
  state: WorkMapState,
  operation: WorkMapOperation,
  actor: WorkMapActor,
  now: string
): WorkMapOperationResult {
  if (operation.op === 'create_project') return createProject(state, operation, now)
  if (operation.op === 'rename_project') return renameProject(state, operation, now)
  if (operation.op === 'set_project_space') return setProjectSpace(state, operation, actor, now)
  if (operation.op === 'set_project_workspace') {
    return setProjectWorkspace(state, operation, actor, now)
  }
  if (operation.op === 'place_chat') return placeChat(state, operation, actor, now)
  if (operation.op === 'create_bot') return createBot(state, operation, actor, now)
  if (operation.op === 'delete_bot') return deleteBot(state, operation, actor, now)
  if (operation.op === 'create_routine') return createRoutine(state, operation, actor, now)
  if (operation.op === 'update_routine') return updateRoutine(state, operation, actor, now)
  if (operation.op === 'delete_routine') return deleteRoutine(state, operation, actor)
  if (operation.op === 'mark_inbox_read') return markInboxRead(state, operation, actor, now)
  if (operation.op === 'archive_inbox') return archiveInbox(state, operation, actor, now)
  if (operation.op === 'create_todo') return createTodo(state, operation, actor, now)
  if (operation.op === 'delete_todo') return deleteTodo(state, operation)
  if (operation.op === 'archive_todo' || operation.op === 'restore_todo') {
    return setTodoArchived(state, operation, actor, now)
  }
  return updateTodo(state, operation, actor, now)
}
