import type { AgentConversationThread } from './conversations'
import {
  agentConversationDisplayTitle,
  isAgentConversationArchived,
  sortAgentConversationThreads
} from './thread-preferences'
import type {
  AgentWorkMap,
  AgentWorkMapBot,
  AgentWorkMapBotAvatarVariant,
  AgentWorkMapInboxItem,
  AgentWorkMapProject,
  AgentWorkMapTodo,
  AgentWorkMapTodoStatus
} from './work-map'

const TODO_STATUSES = ['todo', 'in_motion'] as const satisfies AgentWorkMapTodoStatus[]
const AVATAR_VARIANTS = [
  0, 1, 2, 3, 4, 5
] as const satisfies readonly AgentWorkMapBotAvatarVariant[]

export type WorkMapViewGroup<T> = {
  allItems: T[]
  items: T[]
  remaining: number
  total: number
}

export type WorkMapViewEntry = {
  avatarVariant: AgentWorkMapBotAvatarVariant
  bots: AgentWorkMapBot[]
  depth: number
  directoryBot: AgentWorkMapBot | null
  inMotion: {
    remaining: number
    total: number
  }
  project: AgentWorkMapProject
  threads: WorkMapViewGroup<AgentConversationThread>
  todos: Record<AgentWorkMapTodoStatus, WorkMapViewGroup<AgentWorkMapTodo>>
}

export type AgentWorkMapView = {
  emptySearch: boolean
  entries: WorkMapViewEntry[]
  globalBots: AgentWorkMapBot[]
  inbox: Array<AgentWorkMapInboxItem & { title: string }>
  misc: WorkMapViewGroup<AgentConversationThread>
  unreadInboxCount: number
}

type AgentWorkMapViewInput = {
  initialMiscCount: number
  initialProjectInMotionCount?: number
  initialTodoCount: number
  miscVisibleCount: number
  projectInMotionVisibleCounts?: Record<string, number>
  query: string
  threads: AgentConversationThread[]
  todoVisibleCounts: Record<string, number>
  workMap: AgentWorkMap | null
}

type ProjectEntry = {
  depth: number
  project: AgentWorkMapProject
}

type ProjectionContext = {
  fallbackAvatarVariants: Map<string, AgentWorkMapBotAvatarVariant>
  input: AgentWorkMapViewInput
  projects: AgentWorkMapProject[]
  query: string
  threadByNativeId: Map<string, AgentConversationThread>
  workMap: AgentWorkMap | null
}

function page<T>(items: T[], count: number): WorkMapViewGroup<T> {
  const visible = items.slice(0, count)
  return {
    allItems: items,
    items: visible,
    remaining: items.length - visible.length,
    total: items.length
  }
}

function projectEntries(projects: AgentWorkMapProject[]): ProjectEntry[] {
  const byId = new Map(projects.map((project) => [project.id, project] as const))
  const roots = projects.filter((project) => !project.parentId || !byId.has(project.parentId))
  return roots.flatMap((project) => [
    { depth: 0, project },
    ...projects
      .filter((candidate) => candidate.parentId === project.id)
      .map((candidate) => ({ depth: 1, project: candidate }))
  ])
}

function createProjectionContext(input: AgentWorkMapViewInput): ProjectionContext {
  const query = input.query.trim().toLowerCase()
  const projects = input.workMap?.projects ?? []
  return {
    fallbackAvatarVariants: fallbackAvatarVariants(input.workMap),
    input,
    projects,
    query,
    threadByNativeId: new Map(
      input.threads.map((thread) => [thread.nativeThreadId, thread] as const)
    ),
    workMap: input.workMap
  }
}

function botThread(
  context: ProjectionContext,
  bot: AgentWorkMapBot
): AgentConversationThread | undefined {
  return context.threadByNativeId.get(bot.threadId)
}

function botsFor(context: ProjectionContext, projectId: string | null): AgentWorkMapBot[] {
  return (context.workMap?.bots ?? [])
    .filter((bot) => bot.projectId === projectId)
    .filter((bot) => {
      if (!context.query) return true
      const thread = botThread(context, bot)
      const title = thread ? agentConversationDisplayTitle(thread) : 'Unavailable Bot'
      return title.toLowerCase().includes(context.query)
    })
    .sort((left, right) => {
      const leftUpdated = botThread(context, left)?.updatedAt ?? left.updatedAt
      const rightUpdated = botThread(context, right)?.updatedAt ?? right.updatedAt
      return rightUpdated.localeCompare(leftUpdated)
    })
}

function directoryBotFor(
  context: ProjectionContext,
  project: AgentWorkMapProject
): AgentWorkMapBot | null {
  if (!project.botId) return null
  return (
    context.workMap?.bots.find((bot) => bot.id === project.botId && bot.projectId === project.id) ??
    null
  )
}

function todosFor(
  context: ProjectionContext,
  projectId: string,
  status?: AgentWorkMapTodoStatus
): AgentWorkMapTodo[] {
  return (context.workMap?.todos ?? [])
    .filter((todo) => {
      if (todo.projectId !== projectId || todo.archivedAt || (status && todo.status !== status)) {
        return false
      }
      const thread = todo.threadId ? context.threadByNativeId.get(todo.threadId) : undefined
      return !thread || !isAgentConversationArchived(thread)
    })
    .filter(
      (todo) =>
        !context.query ||
        [todo.title, todo.description ?? ''].join(' ').toLowerCase().includes(context.query)
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function projectIdForThread(
  context: ProjectionContext,
  thread: AgentConversationThread
): string | null {
  const placement = context.workMap?.placements.find(
    (candidate) => candidate.threadId === thread.nativeThreadId
  )
  if (placement) return placement.projectId
  const bot = context.workMap?.bots.find(
    (candidate) => candidate.threadId === thread.nativeThreadId
  )
  return bot?.projectId ?? thread.projectId ?? null
}

function linkedThreadIds(context: ProjectionContext): Set<string> {
  return new Set([
    ...(context.workMap?.bots ?? []).map((bot) => bot.threadId),
    ...(context.workMap?.todos ?? []).flatMap((todo) => (todo.threadId ? [todo.threadId] : []))
  ])
}

function threadsFor(context: ProjectionContext, projectId: string): AgentConversationThread[] {
  const linked = linkedThreadIds(context)
  return sortAgentConversationThreads(
    context.input.threads
      .filter(
        (thread) =>
          !thread.todoDraft &&
          !linked.has(thread.nativeThreadId) &&
          !isAgentConversationArchived(thread) &&
          projectIdForThread(context, thread) === projectId
      )
      .filter(
        (thread) =>
          !context.query ||
          agentConversationDisplayTitle(thread).toLowerCase().includes(context.query)
      )
  )
}

function miscThreadsFor(context: ProjectionContext): AgentConversationThread[] {
  const linked = linkedThreadIds(context)
  const validProjectIds = new Set(context.projects.map((project) => project.id))
  return sortAgentConversationThreads(
    context.input.threads
      .filter(
        (thread) =>
          !thread.todoDraft &&
          !linked.has(thread.nativeThreadId) &&
          !isAgentConversationArchived(thread) &&
          !validProjectIds.has(projectIdForThread(context, thread) ?? '')
      )
      .filter(
        (thread) =>
          !context.query ||
          agentConversationDisplayTitle(thread).toLowerCase().includes(context.query)
      )
  )
}

function visibleProjectEntries(context: ProjectionContext): ProjectEntry[] {
  const entries = projectEntries(context.projects)
  if (!context.query) return entries
  const matchingProjectIds = new Set<string>()
  for (const entry of entries) {
    const project = entry.project
    if (
      project.name.toLowerCase().includes(context.query) ||
      botsFor(context, project.id).length ||
      threadsFor(context, project.id).length ||
      todosFor(context, project.id).length
    ) {
      matchingProjectIds.add(project.id)
      if (project.parentId) matchingProjectIds.add(project.parentId)
    }
  }
  return entries.filter((entry) => matchingProjectIds.has(entry.project.id))
}

function todoCountKey(projectId: string, status: AgentWorkMapTodoStatus): string {
  return `${projectId}:${status}`
}

function fallbackAvatarVariant(projectId: string): AgentWorkMapBotAvatarVariant {
  let hash = 0
  for (const character of projectId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return AVATAR_VARIANTS[hash % AVATAR_VARIANTS.length] ?? AVATAR_VARIANTS[0]
}

function fallbackAvatarVariants(
  workMap: AgentWorkMap | null
): Map<string, AgentWorkMapBotAvatarVariant> {
  const assigned = new Set((workMap?.bots ?? []).map((bot) => bot.avatarVariant))
  const botProjectIds = new Set(
    (workMap?.bots ?? []).flatMap((bot) => (bot.projectId ? [bot.projectId] : []))
  )
  const result = new Map<string, AgentWorkMapBotAvatarVariant>()

  for (const entry of projectEntries(workMap?.projects ?? [])) {
    if (botProjectIds.has(entry.project.id)) continue
    const preferred = fallbackAvatarVariant(entry.project.id)
    const start = AVATAR_VARIANTS.indexOf(preferred)
    const variant =
      Array.from(
        { length: AVATAR_VARIANTS.length },
        (_, offset) => AVATAR_VARIANTS[(start + offset) % AVATAR_VARIANTS.length]!
      ).find((candidate) => !assigned.has(candidate)) ?? preferred
    result.set(entry.project.id, variant)
    assigned.add(variant)
  }
  return result
}

function projectView(context: ProjectionContext, entry: ProjectEntry): WorkMapViewEntry {
  const bots = botsFor(context, entry.project.id)
  const directoryBot = directoryBotFor(context, entry.project)
  const threads = threadsFor(context, entry.project.id)
  const todosByStatus = Object.fromEntries(
    TODO_STATUSES.map((status) => [status, todosFor(context, entry.project.id, status)])
  ) as Record<AgentWorkMapTodoStatus, AgentWorkMapTodo[]>
  const inMotionVisibleCount =
    context.input.projectInMotionVisibleCounts?.[entry.project.id] ??
    context.input.initialProjectInMotionCount ??
    5
  const visibleThreadCount = Math.min(threads.length, inMotionVisibleCount)
  const visibleInMotionTodoCount = Math.max(0, inMotionVisibleCount - visibleThreadCount)
  const inMotionTotal = threads.length + todosByStatus.in_motion.length

  return {
    avatarVariant:
      directoryBot?.avatarVariant ??
      context.fallbackAvatarVariants.get(entry.project.id) ??
      fallbackAvatarVariant(entry.project.id),
    bots,
    depth: entry.depth,
    directoryBot,
    inMotion: {
      remaining: Math.max(0, inMotionTotal - inMotionVisibleCount),
      total: inMotionTotal
    },
    project: entry.project,
    threads: page(threads, visibleThreadCount),
    todos: Object.fromEntries(
      TODO_STATUSES.map((status) => {
        const visibleCount =
          status === 'in_motion'
            ? visibleInMotionTodoCount
            : (context.input.todoVisibleCounts[todoCountKey(entry.project.id, status)] ??
              context.input.initialTodoCount)
        return [status, page(todosByStatus[status], visibleCount)]
      })
    ) as Record<AgentWorkMapTodoStatus, WorkMapViewGroup<AgentWorkMapTodo>>
  }
}

export function buildAgentWorkMapView(input: AgentWorkMapViewInput): AgentWorkMapView {
  const context = createProjectionContext(input)
  const visibleProjects = visibleProjectEntries(context)
  const entries = visibleProjects.map((entry) => projectView(context, entry))
  const globalBots = botsFor(context, null)
  const misc = page(miscThreadsFor(context), input.miscVisibleCount || input.initialMiscCount)
  const inbox = [...(context.workMap?.inbox ?? [])]
    .filter((item) => item.status !== 'running' && !item.archivedAt)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((item) => {
      const thread = context.threadByNativeId.get(item.threadId)
      return {
        ...item,
        title: thread ? agentConversationDisplayTitle(thread) : 'Scheduled check'
      }
    })
  return {
    emptySearch: Boolean(
      context.query && !visibleProjects.length && !globalBots.length && !misc.total
    ),
    entries,
    globalBots,
    inbox,
    misc,
    unreadInboxCount: inbox.filter((item) => !item.readAt).length
  }
}
