import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const WORK_MAP_TODO_STATUSES = ['todo', 'in_motion', 'finished'] as const

export type WorkMapTodoStatus = (typeof WORK_MAP_TODO_STATUSES)[number]

export type WorkMapProject = {
  createdAt: string
  id: string
  name: string
  parentId?: string
  updatedAt: string
}

export type WorkMapPlacement = {
  manual: boolean
  projectId: string | null
  threadId: string
  updatedAt: string
}

export type WorkMapTodo = {
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
  placements: WorkMapPlacement[]
  projects: WorkMapProject[]
  revision: number
  todos: WorkMapTodo[]
  version: 1
}

export type WorkMapOperation =
  | { name: string; op: 'create_project'; parent_id?: string; project_id?: string }
  | { name: string; op: 'rename_project'; project_id: string }
  | { op: 'place_chat'; project_id: string | null; thread_id: string }
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

type StoredRequest = {
  hash: string
  requestId: string
  receipt: WorkMapApplyReceipt
}

type PersistedWorkMap = WorkMapSnapshot & {
  requests: StoredRequest[]
}

type LegacyWorkMapTodoStatus = 'needs_you' | 'review'
type StoredWorkMapTodo = Omit<WorkMapTodo, 'status'> & {
  status: LegacyWorkMapTodoStatus | WorkMapTodoStatus
}
type StoredWorkMap = Omit<PersistedWorkMap, 'todos'> & { todos: StoredWorkMapTodo[] }

const MAX_PROJECT_NAME = 120
const MAX_TODO_TITLE = 240
const MAX_TODO_DESCRIPTION = 4_000
const MAX_REQUESTS = 128

function initialState(): PersistedWorkMap {
  return { placements: [], projects: [], requests: [], revision: 0, todos: [], version: 1 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isTodoStatus(value: unknown): value is WorkMapTodoStatus {
  return WORK_MAP_TODO_STATUSES.includes(value as WorkMapTodoStatus)
}

function isStoredTodoStatus(value: unknown): value is LegacyWorkMapTodoStatus | WorkMapTodoStatus {
  return isTodoStatus(value) || value === 'needs_you' || value === 'review'
}

function isProject(value: unknown): value is WorkMapProject {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    isString(value.id) &&
    isString(value.name) &&
    isOptionalString(value.parentId) &&
    isString(value.updatedAt)
  )
}

function isPlacement(value: unknown): value is WorkMapPlacement {
  return (
    isRecord(value) &&
    typeof value.manual === 'boolean' &&
    (value.projectId === null || isString(value.projectId)) &&
    isString(value.threadId) &&
    isString(value.updatedAt)
  )
}

function isStoredTodo(value: unknown): value is StoredWorkMapTodo {
  return (
    isRecord(value) &&
    isString(value.createdAt) &&
    isOptionalString(value.description) &&
    isString(value.id) &&
    isOptionalString(value.planObjectId) &&
    isOptionalString(value.planPageId) &&
    isString(value.projectId) &&
    isStoredTodoStatus(value.status) &&
    isOptionalString(value.threadId) &&
    isString(value.title) &&
    isString(value.updatedAt)
  )
}

function isReceipt(value: unknown): value is WorkMapApplyReceipt {
  return (
    isRecord(value) &&
    Number.isInteger(value.previousRevision) &&
    Number.isInteger(value.revision) &&
    isOptionalString(value.requestId) &&
    Array.isArray(value.results) &&
    value.results.every(
      (result) =>
        isRecord(result) &&
        typeof result.changed === 'boolean' &&
        isString(result.id) &&
        isString(result.op)
    )
  )
}

function isStoredRequest(value: unknown): value is StoredRequest {
  return (
    isRecord(value) && isString(value.hash) && isString(value.requestId) && isReceipt(value.receipt)
  )
}

function parseState(value: unknown): { migrated: boolean; state: PersistedWorkMap } {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Array.isArray(value.projects) ||
    !value.projects.every(isProject) ||
    !Array.isArray(value.placements) ||
    !value.placements.every(isPlacement) ||
    !Array.isArray(value.todos) ||
    !value.todos.every(isStoredTodo) ||
    !Array.isArray(value.requests) ||
    !value.requests.every(isStoredRequest)
  ) {
    throw new TypeError('The persisted Work Map is invalid.')
  }
  const stored = value as StoredWorkMap
  const migrated = stored.todos.some(
    (todo) => todo.status === 'needs_you' || todo.status === 'review'
  )
  return {
    migrated,
    state: {
      ...stored,
      todos: stored.todos.map((todo) => ({
        ...todo,
        status: todo.status === 'needs_you' || todo.status === 'review' ? 'in_motion' : todo.status
      }))
    }
  }
}

function cloneState(state: PersistedWorkMap): PersistedWorkMap {
  return structuredClone(state)
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

function requireProject(state: PersistedWorkMap, projectId: string): WorkMapProject {
  const project = state.projects.find((candidate) => candidate.id === projectId)
  if (!project) throw new TypeError(`Work Map project "${projectId}" was not found.`)
  return project
}

function requireTodo(state: PersistedWorkMap, todoId: string): WorkMapTodo {
  const todo = state.todos.find((candidate) => candidate.id === todoId)
  if (!todo) throw new TypeError(`Work Map todo "${todoId}" was not found.`)
  return todo
}

function assertSiblingNameAvailable(
  state: PersistedWorkMap,
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

function operationHash(actor: WorkMapActor, operations: readonly WorkMapOperation[]): string {
  return createHash('sha256').update(JSON.stringify({ actor, operations })).digest('hex')
}

function writeState(filePath: string, state: PersistedWorkMap): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`)
  renameSync(temporary, filePath)
}

export function parseWorkMapOperations(value: unknown): WorkMapOperation[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new TypeError('Work Map apply requires 1-100 operations.')
  }
  return value.map((operation) => {
    if (!isRecord(operation) || typeof operation.op !== 'string') {
      throw new TypeError('Every Work Map operation needs an op value.')
    }
    if (operation.op === 'create_project') {
      if (
        typeof operation.name !== 'string' ||
        !isOptionalString(operation.parent_id) ||
        !isOptionalString(operation.project_id)
      ) {
        throw new TypeError('create_project requires name and optional string IDs.')
      }
      return operation as WorkMapOperation
    }
    if (operation.op === 'rename_project') {
      if (typeof operation.name !== 'string' || typeof operation.project_id !== 'string') {
        throw new TypeError('rename_project requires project_id and name.')
      }
      return operation as WorkMapOperation
    }
    if (operation.op === 'place_chat') {
      if (
        typeof operation.thread_id !== 'string' ||
        (operation.project_id !== null && typeof operation.project_id !== 'string')
      ) {
        throw new TypeError('place_chat requires thread_id and a project_id or null.')
      }
      return operation as WorkMapOperation
    }
    if (operation.op === 'create_todo') {
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
      return operation as WorkMapOperation
    }
    if (operation.op === 'update_todo') {
      if (
        typeof operation.todo_id !== 'string' ||
        !isOptionalString(operation.description) ||
        !(
          operation.plan_object_id === undefined ||
          operation.plan_object_id === null ||
          typeof operation.plan_object_id === 'string'
        ) ||
        !(
          operation.plan_page_id === undefined ||
          operation.plan_page_id === null ||
          typeof operation.plan_page_id === 'string'
        ) ||
        !isOptionalString(operation.project_id) ||
        !isOptionalString(operation.title) ||
        !(
          operation.thread_id === undefined ||
          operation.thread_id === null ||
          typeof operation.thread_id === 'string'
        ) ||
        !(operation.status === undefined || isTodoStatus(operation.status))
      ) {
        throw new TypeError('update_todo contains invalid fields.')
      }
      if (
        operation.description === undefined &&
        operation.plan_object_id === undefined &&
        operation.plan_page_id === undefined &&
        operation.project_id === undefined &&
        operation.status === undefined &&
        operation.thread_id === undefined &&
        operation.title === undefined
      ) {
        throw new TypeError('update_todo needs at least one change.')
      }
      return operation as WorkMapOperation
    }
    throw new TypeError(`Unknown Work Map operation "${operation.op}".`)
  })
}

export class WorkMapStore {
  private state: PersistedWorkMap

  constructor(private readonly filePath?: string) {
    if (!filePath || !existsSync(filePath)) this.state = initialState()
    else {
      const parsed = parseState(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
      this.state = parsed.state
      if (parsed.migrated) writeState(filePath, this.state)
    }
  }

  snapshot(): WorkMapSnapshot {
    const { requests: _requests, ...snapshot } = cloneState(this.state)
    return snapshot
  }

  apply(input: {
    actor: WorkMapActor
    expectedRevision: number
    operations: readonly WorkMapOperation[]
    requestId?: string
  }): WorkMapApplyReceipt {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new TypeError('expectedRevision must be a non-negative integer.')
    }
    if (!input.operations.length || input.operations.length > 100) {
      throw new TypeError('Work Map apply requires 1-100 operations.')
    }
    const requestId = input.requestId?.trim()
    const hash = operationHash(input.actor, input.operations)
    if (requestId) {
      const previous = this.state.requests.find((request) => request.requestId === requestId)
      if (previous) {
        if (previous.hash !== hash) {
          throw new TypeError(`Work Map request "${requestId}" was reused with different input.`)
        }
        return structuredClone(previous.receipt)
      }
    }
    if (input.expectedRevision !== this.state.revision) {
      throw new Error(
        `Work Map revision conflict: expected ${String(input.expectedRevision)}, current ${String(this.state.revision)}.`
      )
    }

    const next = cloneState(this.state)
    const now = new Date().toISOString()
    const results = input.operations.map((operation) =>
      this.applyOperation(next, operation, input.actor, now)
    )
    const previousRevision = next.revision
    next.revision += 1
    const receipt: WorkMapApplyReceipt = {
      previousRevision,
      ...(requestId ? { requestId } : {}),
      results,
      revision: next.revision
    }
    if (requestId) {
      next.requests.push({ hash, receipt, requestId })
      next.requests = next.requests.slice(-MAX_REQUESTS)
    }
    if (this.filePath) writeState(this.filePath, next)
    this.state = next
    return structuredClone(receipt)
  }

  private applyOperation(
    state: PersistedWorkMap,
    operation: WorkMapOperation,
    actor: WorkMapActor,
    now: string
  ): WorkMapOperationResult {
    if (operation.op === 'create_project') {
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

    if (operation.op === 'rename_project') {
      const project = requireProject(state, operation.project_id.trim())
      const name = boundedText(operation.name, 'Project name', MAX_PROJECT_NAME)
      assertSiblingNameAvailable(state, name, project.parentId, project.id)
      const changed = project.name !== name
      if (changed) {
        project.name = name
        project.updatedAt = now
      }
      return { changed, id: project.id, op: operation.op }
    }

    if (operation.op === 'place_chat') {
      const threadId = boundedText(operation.thread_id, 'Thread ID', 240)
      assertAgentThread(actor, threadId)
      const projectId = operation.project_id?.trim() || null
      if (projectId) requireProject(state, projectId)
      const existing = state.placements.find((placement) => placement.threadId === threadId)
      if (existing?.manual && actor.kind === 'agent' && existing.projectId !== projectId) {
        throw new TypeError('Manual chat placement is locked and cannot be changed by an agent.')
      }
      if (existing) {
        const manual = actor.kind === 'user' || existing.manual
        const changed = existing.projectId !== projectId || existing.manual !== manual
        if (changed) Object.assign(existing, { manual, projectId, updatedAt: now })
        return { changed, id: threadId, op: operation.op }
      }
      state.placements.push({ manual: actor.kind === 'user', projectId, threadId, updatedAt: now })
      return { changed: true, id: threadId, op: operation.op }
    }

    if (operation.op === 'create_todo') {
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

    const todo = requireTodo(state, operation.todo_id.trim())
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
    const planObjectId =
      operation.plan_object_id === undefined
        ? todo.planObjectId
        : operation.plan_object_id === null
          ? undefined
          : optionalBoundedText(operation.plan_object_id, 'Plan object ID', 240)
    const planPageId =
      operation.plan_page_id === undefined
        ? todo.planPageId
        : operation.plan_page_id === null
          ? undefined
          : optionalBoundedText(operation.plan_page_id, 'Plan page ID', 240)
    const threadId =
      operation.thread_id === undefined
        ? todo.threadId
        : operation.thread_id === null
          ? undefined
          : boundedText(operation.thread_id, 'Thread ID', 240)
    if (threadId) assertAgentThread(actor, threadId)
    const status = operation.status ?? todo.status
    const changed =
      title !== todo.title ||
      projectId !== todo.projectId ||
      description !== todo.description ||
      planObjectId !== todo.planObjectId ||
      planPageId !== todo.planPageId ||
      threadId !== todo.threadId ||
      status !== todo.status
    if (changed) {
      todo.title = title
      todo.projectId = projectId
      todo.status = status
      todo.updatedAt = now
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
}
