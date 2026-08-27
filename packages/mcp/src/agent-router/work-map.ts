import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createInboxBriefingReport, isInboxBriefingReport } from '@open-pencil/core/code-object'

import {
  isWorkMapBotAvatarVariant,
  nextWorkMapBotAvatarVariant,
  WORK_MAP_TODO_STATUSES,
  type WorkMapActor,
  type WorkMapApplyReceipt,
  type WorkMapBot,
  type WorkMapBotAvatarVariant,
  type WorkMapInboxBriefing,
  type WorkMapInboxItem,
  type WorkMapInboxStatus,
  type WorkMapOperation,
  type WorkMapPlacement,
  type WorkMapProject,
  type WorkMapRoutine,
  type WorkMapSnapshot,
  type WorkMapTodo,
  type WorkMapTodoStatus
} from './work-map-contract'
import { applyWorkMapOperation } from './work-map-operations'

export * from './work-map-contract'
export { parseWorkMapOperations } from './work-map-operations'

type StoredRequest = {
  hash: string
  requestId: string
  receipt: WorkMapApplyReceipt
}

type PersistedWorkMap = WorkMapSnapshot & {
  requests: StoredRequest[]
}

type LegacyWorkMapTodoStatus = 'finished' | 'needs_you' | 'review'
type StoredWorkMapTodo = Omit<WorkMapTodo, 'status'> & {
  status: LegacyWorkMapTodoStatus | WorkMapTodoStatus
}
type StoredWorkMapBot = Omit<WorkMapBot, 'avatarVariant'> & {
  avatarVariant?: WorkMapBotAvatarVariant | 6
}
type StoredWorkMap = Omit<PersistedWorkMap, 'bots' | 'todos'> & {
  bots: StoredWorkMapBot[]
  todos: StoredWorkMapTodo[]
}
type LegacyStoredWorkMap = Omit<StoredWorkMap, 'bots' | 'inbox' | 'routines' | 'version'> & {
  version: 1
}

const MAX_REQUESTS = 128
const MAX_INBOX_ITEMS = 200

function initialState(): PersistedWorkMap {
  return {
    bots: [],
    inbox: [],
    placements: [],
    projects: [],
    requests: [],
    revision: 0,
    routines: [],
    todos: [],
    version: 2
  }
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
  return isTodoStatus(value) || value === 'finished' || value === 'needs_you' || value === 'review'
}

function isProject(value: unknown): value is WorkMapProject {
  const hasSpaceFrame = isRecord(value) && isString(value.spaceFrameId)
  const hasSpacePage = isRecord(value) && isString(value.spacePageId)
  return (
    isRecord(value) &&
    isOptionalString(value.botId) &&
    isString(value.createdAt) &&
    isString(value.id) &&
    isString(value.name) &&
    isOptionalString(value.parentId) &&
    isOptionalString(value.spaceFrameId) &&
    isOptionalString(value.spacePageId) &&
    isOptionalString(value.workspaceRoot) &&
    hasSpaceFrame === hasSpacePage &&
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
    isOptionalString(value.archivedAt) &&
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

function isStoredBot(value: unknown): value is StoredWorkMapBot {
  return (
    isRecord(value) &&
    (value.avatarVariant === undefined ||
      value.avatarVariant === 6 ||
      isWorkMapBotAvatarVariant(value.avatarVariant)) &&
    isString(value.createdAt) &&
    isString(value.id) &&
    (value.projectId === null || isString(value.projectId)) &&
    isString(value.threadId) &&
    isString(value.updatedAt)
  )
}

function isRoutine(value: unknown): value is WorkMapRoutine {
  return (
    isRecord(value) &&
    isString(value.botId) &&
    (value.briefingObject === undefined || typeof value.briefingObject === 'boolean') &&
    isString(value.createdAt) &&
    typeof value.enabled === 'boolean' &&
    (value.everyMinutes === undefined ||
      (Number.isInteger(value.everyMinutes) && Number(value.everyMinutes) > 0)) &&
    isString(value.id) &&
    isOptionalString(value.lastRunAt) &&
    isOptionalString(value.nextRunAt) &&
    isString(value.prompt) &&
    isString(value.updatedAt)
  )
}

function isInboxBriefing(value: unknown): value is WorkMapInboxBriefing {
  return (
    isRecord(value) &&
    isString(value.content) &&
    isString(value.id) &&
    (value.report === undefined || isInboxBriefingReport(value.report)) &&
    isString(value.title)
  )
}

function isInboxStatus(value: unknown): value is WorkMapInboxStatus {
  return value === 'completed' || value === 'failed' || value === 'running' || value === 'stopped'
}

function isInboxItem(value: unknown): value is WorkMapInboxItem {
  return (
    isRecord(value) &&
    isOptionalString(value.archivedAt) &&
    isString(value.botId) &&
    (value.briefing === undefined || isInboxBriefing(value.briefing)) &&
    isString(value.createdAt) &&
    isString(value.id) &&
    (value.projectId === null || isString(value.projectId)) &&
    isOptionalString(value.readAt) &&
    isString(value.routineId) &&
    isOptionalString(value.messageId) &&
    isInboxStatus(value.status) &&
    isString(value.summary) &&
    isString(value.threadId) &&
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

function isStoredWorkMapBase(value: Record<string, unknown>): boolean {
  return (
    (value.version === 1 || value.version === 2) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    Array.isArray(value.projects) &&
    value.projects.every(isProject) &&
    Array.isArray(value.placements) &&
    value.placements.every(isPlacement) &&
    Array.isArray(value.todos) &&
    value.todos.every(isStoredTodo) &&
    Array.isArray(value.requests) &&
    value.requests.every(isStoredRequest)
  )
}

function isStoredAutomationState(value: Record<string, unknown>): boolean {
  if (value.version === 1) return true
  return (
    Array.isArray(value.bots) &&
    value.bots.every(isStoredBot) &&
    Array.isArray(value.routines) &&
    value.routines.every(isRoutine) &&
    Array.isArray(value.inbox) &&
    value.inbox.every(isInboxItem)
  )
}

function parseState(value: unknown): {
  migrated: boolean
  state: PersistedWorkMap
} {
  if (!isRecord(value) || !isStoredWorkMapBase(value)) {
    throw new TypeError('The persisted Work Map is invalid.')
  }
  if (!isStoredAutomationState(value)) {
    throw new TypeError('The persisted Work Map automation state is invalid.')
  }
  const stored = value as StoredWorkMap | LegacyStoredWorkMap
  const storedBots = stored.version === 2 ? stored.bots : []
  const assignedBots = storedBots.flatMap((bot) =>
    isWorkMapBotAvatarVariant(bot.avatarVariant) ? [{ avatarVariant: bot.avatarVariant }] : []
  )
  const bots = storedBots.map((bot): WorkMapBot => {
    if (isWorkMapBotAvatarVariant(bot.avatarVariant)) {
      return { ...bot, avatarVariant: bot.avatarVariant }
    }
    const avatarVariant = nextWorkMapBotAvatarVariant(assignedBots)
    assignedBots.push({ avatarVariant })
    return { ...bot, avatarVariant }
  })
  const routines = stored.version === 2 ? stored.routines : []
  const storedInbox = stored.version === 2 ? stored.inbox : []
  const interruptedAt = new Date().toISOString()
  const migrated =
    stored.version === 1 ||
    storedBots.some((bot) => !isWorkMapBotAvatarVariant(bot.avatarVariant)) ||
    stored.todos.some((todo) => !isTodoStatus(todo.status)) ||
    storedInbox.some((item) => item.briefing && !item.briefing.report) ||
    storedInbox.some((item) => item.status === 'running')
  return {
    migrated,
    state: {
      bots,
      inbox: storedInbox.map((item) => {
        const normalized =
          item.status === 'running'
            ? {
                ...item,
                status: 'failed' as const,
                summary: 'Run interrupted when the local authority stopped.',
                updatedAt: interruptedAt
              }
            : item
        const briefing = normalized.briefing
        if (!briefing || briefing.report) return normalized
        const fallbackTitle =
          briefing.title.replace(/\s+briefing$/i, '').trim() || 'Scheduled briefing'
        return {
          ...normalized,
          briefing: {
            ...briefing,
            report: createInboxBriefingReport(briefing.content, {
              generatedAt: normalized.updatedAt,
              title: fallbackTitle
            })
          }
        }
      }),
      placements: stored.placements,
      projects: stored.projects,
      requests: stored.requests,
      revision: stored.revision,
      routines,
      todos: stored.todos.map((todo) => ({
        ...todo,
        ...(todo.status === 'finished' && !todo.archivedAt ? { archivedAt: todo.updatedAt } : {}),
        status: isTodoStatus(todo.status) ? todo.status : 'in_motion'
      })),
      version: 2
    }
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
    const { requests: _requests, ...snapshot } = structuredClone(this.state)
    return snapshot
  }

  ensureBotDirectories(
    titleForThread: (threadId: string) => string | undefined,
    now = new Date()
  ): boolean {
    const next = structuredClone(this.state)
    const updatedAt = now.toISOString()
    let changed = false
    for (const bot of next.bots.filter((candidate) => !candidate.projectId)) {
      const idSuffix = bot.id.replace(/^bot:/, '').slice(0, 180) || randomUUID()
      let projectId = `project:${idSuffix}`
      if (next.projects.some((project) => project.id === projectId)) {
        projectId = `project:${randomUUID()}`
      }

      const requestedName = titleForThread(bot.threadId)?.trim() || 'Untitled Bot'
      let name = requestedName.slice(0, 120)
      let suffix = 2
      while (
        next.projects.some(
          (project) =>
            !project.parentId &&
            project.name.localeCompare(name, undefined, {
              sensitivity: 'accent'
            }) === 0
        )
      ) {
        const label = ` (${String(suffix)})`
        name = `${requestedName.slice(0, 120 - label.length)}${label}`
        suffix += 1
      }

      next.projects.push({
        botId: bot.id,
        createdAt: bot.createdAt,
        id: projectId,
        name,
        updatedAt
      })
      bot.projectId = projectId
      bot.updatedAt = updatedAt

      const placement = next.placements.find((candidate) => candidate.threadId === bot.threadId)
      if (placement) Object.assign(placement, { projectId, updatedAt })
      else {
        next.placements.push({
          manual: false,
          projectId,
          threadId: bot.threadId,
          updatedAt
        })
      }
      for (const item of next.inbox) {
        if (item.botId === bot.id) item.projectId = projectId
      }
      changed = true
    }

    for (const project of next.projects) {
      const linked = project.botId
        ? next.bots.find(
            (candidate) => candidate.id === project.botId && candidate.projectId === project.id
          )
        : undefined
      if (project.botId && !linked) {
        delete project.botId
        project.updatedAt = updatedAt
        changed = true
      }
      if (linked) continue

      const matching = next.bots.filter((candidate) => {
        if (candidate.projectId !== project.id) return false
        const title = titleForThread(candidate.threadId)?.trim()
        return title?.localeCompare(project.name, undefined, { sensitivity: 'accent' }) === 0
      })
      if (matching.length !== 1) continue
      project.botId = matching[0]!.id
      project.updatedAt = updatedAt
      changed = true
    }

    if (!changed) return false
    next.revision += 1
    if (this.filePath) writeState(this.filePath, next)
    this.state = next
    return true
  }

  project(projectId: string): WorkMapProject | null {
    const project = this.state.projects.find((candidate) => candidate.id === projectId)
    return project ? structuredClone(project) : null
  }

  projectForWorkspaceRoot(workspaceRoot: string): WorkMapProject | null {
    const resolved = path.resolve(workspaceRoot)
    const project = this.state.projects
      .filter((candidate) => {
        if (!candidate.workspaceRoot) return false
        const relative = path.relative(candidate.workspaceRoot, resolved)
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
      })
      .sort(
        (left, right) => (right.workspaceRoot?.length ?? 0) - (left.workspaceRoot?.length ?? 0)
      )[0]
    return project ? structuredClone(project) : null
  }

  syncTodoTitleForThread(threadId: string, title: string, now = new Date()): boolean {
    const canonicalTitle = title.trim().slice(0, 240)
    if (!threadId.trim() || !canonicalTitle) return false
    const current = this.state.todos.find((todo) => todo.threadId === threadId)
    if (!current || current.title === canonicalTitle) return false
    const next = structuredClone(this.state)
    const todo = next.todos.find((candidate) => candidate.id === current.id)
    if (!todo) return false
    todo.title = canonicalTitle
    todo.updatedAt = now.toISOString()
    next.revision += 1
    if (this.filePath) writeState(this.filePath, next)
    this.state = next
    return true
  }

  dueRoutineIds(now = new Date()): string[] {
    const timestamp = now.getTime()
    return this.state.routines
      .filter(
        (routine) =>
          routine.enabled &&
          Boolean(routine.nextRunAt) &&
          Date.parse(routine.nextRunAt ?? '') <= timestamp &&
          !this.state.inbox.some(
            (item) => item.routineId === routine.id && item.status === 'running'
          )
      )
      .map((routine) => routine.id)
  }

  beginRoutineRun(
    routineId: string,
    options: { force?: boolean; now?: Date } = {}
  ): WorkMapInboxItem {
    const next = structuredClone(this.state)
    const routine = next.routines.find((candidate) => candidate.id === routineId)
    if (!routine) throw new TypeError(`Work Map routine "${routineId}" was not found.`)
    const bot = next.bots.find((candidate) => candidate.id === routine.botId)
    if (!bot) throw new TypeError(`Work Map bot "${routine.botId}" was not found.`)
    if (next.inbox.some((item) => item.routineId === routineId && item.status === 'running')) {
      throw new Error('This Bot routine is already running.')
    }
    const now = options.now ?? new Date()
    const nowMs = now.getTime()
    if (!options.force) {
      if (!routine.enabled || !routine.nextRunAt || Date.parse(routine.nextRunAt) > nowMs) {
        throw new Error('This Bot routine is not due yet.')
      }
      if (routine.everyMinutes) {
        const intervalMs = routine.everyMinutes * 60_000
        let nextRunMs = Date.parse(routine.nextRunAt)
        while (nextRunMs <= nowMs) nextRunMs += intervalMs
        routine.nextRunAt = new Date(nextRunMs).toISOString()
      } else {
        routine.enabled = false
        delete routine.nextRunAt
      }
    }
    const timestamp = now.toISOString()
    routine.lastRunAt = timestamp
    routine.updatedAt = timestamp
    const item: WorkMapInboxItem = {
      botId: bot.id,
      createdAt: timestamp,
      id: `inbox:${randomUUID()}`,
      projectId: bot.projectId,
      routineId: routine.id,
      status: 'running',
      summary: 'Scheduled work is running.',
      threadId: bot.threadId,
      updatedAt: timestamp
    }
    next.inbox.push(item)
    next.inbox = next.inbox.slice(-MAX_INBOX_ITEMS)
    next.revision += 1
    if (this.filePath) writeState(this.filePath, next)
    this.state = next
    return structuredClone(item)
  }

  completeRoutineRun(
    inboxId: string,
    status: Exclude<WorkMapInboxStatus, 'running'>,
    summary: string,
    now = new Date(),
    details: { briefing?: WorkMapInboxBriefing; messageId?: string } = {}
  ): WorkMapInboxItem {
    const next = structuredClone(this.state)
    const item = next.inbox.find((candidate) => candidate.id === inboxId)
    if (!item) throw new TypeError(`Work Map inbox item "${inboxId}" was not found.`)
    if (item.status !== 'running') return structuredClone(item)
    item.status = status
    item.summary = summary.trim().slice(0, 4_000) || `Scheduled work ${status}.`
    const messageId = details.messageId?.trim().slice(0, 240)
    if (messageId) item.messageId = messageId
    if (details.briefing) {
      item.briefing = {
        content: details.briefing.content.trim().slice(0, 100_000),
        id: details.briefing.id.trim().slice(0, 240),
        ...(details.briefing.report ? { report: structuredClone(details.briefing.report) } : {}),
        title: details.briefing.title.trim().slice(0, 240)
      }
    }
    item.updatedAt = now.toISOString()
    next.revision += 1
    if (this.filePath) writeState(this.filePath, next)
    this.state = next
    return structuredClone(item)
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

    const next = structuredClone(this.state)
    const now = new Date().toISOString()
    const results = input.operations.map((operation) =>
      applyWorkMapOperation(next, operation, input.actor, now)
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
}
