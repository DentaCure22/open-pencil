import type { AgentConversationThread } from './conversations'
import {
  agentConversationDisplayTitle,
  isAgentConversationArchived,
  sortAgentConversationThreads
} from './thread-preferences'
import type {
  AgentWorkMap,
  AgentWorkMapBot,
  AgentWorkMapProject,
  AgentWorkMapTodo,
  AgentWorkMapTodoStatus
} from './work-map'

const TODO_STATUSES = ['todo', 'in_motion'] as const satisfies AgentWorkMapTodoStatus[]

export type WorkMapViewGroup<T> = {
  items: T[]
  remaining: number
  total: number
}

export type WorkMapViewEntry = {
  bots: AgentWorkMapBot[]
  depth: number
  misc: boolean
  project: AgentWorkMapProject
  threads: WorkMapViewGroup<AgentConversationThread>
  todos: Record<AgentWorkMapTodoStatus, WorkMapViewGroup<AgentWorkMapTodo>>
}

export type AgentWorkMapView = {
  emptySearch: boolean
  entries: WorkMapViewEntry[]
  globalBots: AgentWorkMapBot[]
  inbox: AgentWorkMap['inbox']
  unreadInboxCount: number
}

type AgentWorkMapViewInput = {
  initialTodoCount: number
  miscVisibleCount: number
  query: string
  threads: AgentConversationThread[]
  todoVisibleCounts: Record<string, number>
  workMap: AgentWorkMap | null
}

type ProjectEntry = {
  depth: number
  project: AgentWorkMapProject
}

function page<T>(items: T[], count: number): WorkMapViewGroup<T> {
  const visible = items.slice(0, count)
  return { items: visible, remaining: items.length - visible.length, total: items.length }
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

function todoCountKey(projectId: string, status: AgentWorkMapTodoStatus): string {
  return `${projectId}:${status}`
}

export function buildAgentWorkMapView(input: AgentWorkMapViewInput): AgentWorkMapView {
  const query = input.query.trim().toLowerCase()
  const workMap = input.workMap
  const projects = workMap?.projects ?? []
  const threadByNativeId = new Map(
    input.threads.map((thread) => [thread.nativeThreadId, thread] as const)
  )
  const filteredThreads = input.threads.filter((thread) => {
    if (isAgentConversationArchived(thread)) return false
    if (!query) return true
    return [agentConversationDisplayTitle(thread), thread.task, thread.recentUpdate]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
  const todoThreadIds = new Set(
    (workMap?.todos ?? []).flatMap((todo) => (todo.threadId ? [todo.threadId] : []))
  )
  const botThreadIds = new Set((workMap?.bots ?? []).map((bot) => bot.threadId))
  const validProjectIds = new Set(projects.map((project) => project.id))
  const placementByThread = new Map(
    (workMap?.placements ?? []).map((placement) => [placement.threadId, placement] as const)
  )

  function threadForBot(bot: AgentWorkMapBot): AgentConversationThread | undefined {
    return threadByNativeId.get(bot.threadId)
  }

  function botsFor(projectId: string | null): AgentWorkMapBot[] {
    return (workMap?.bots ?? [])
      .filter((bot) => bot.projectId === projectId)
      .filter((bot) => {
        if (!query) return true
        const thread = threadForBot(bot)
        const title = thread ? agentConversationDisplayTitle(thread) : 'Unavailable Bot'
        return title.toLowerCase().includes(query)
      })
      .sort((left, right) => {
        const leftUpdated = threadForBot(left)?.updatedAt ?? left.updatedAt
        const rightUpdated = threadForBot(right)?.updatedAt ?? right.updatedAt
        return rightUpdated.localeCompare(leftUpdated)
      })
  }

  function threadsFor(projectId: string): AgentConversationThread[] {
    return sortAgentConversationThreads(
      filteredThreads.filter(
        (thread) =>
          !todoThreadIds.has(thread.nativeThreadId) &&
          !botThreadIds.has(thread.nativeThreadId) &&
          placementByThread.get(thread.nativeThreadId)?.projectId === projectId
      )
    )
  }

  function todosFor(projectId: string, status?: AgentWorkMapTodoStatus): AgentWorkMapTodo[] {
    return (workMap?.todos ?? [])
      .filter((todo) => {
        if (todo.projectId !== projectId || todo.archivedAt || (status && todo.status !== status)) {
          return false
        }
        const thread = todo.threadId ? threadByNativeId.get(todo.threadId) : undefined
        return !thread || !isAgentConversationArchived(thread)
      })
      .filter(
        (todo) =>
          !query || [todo.title, todo.description ?? ''].join(' ').toLowerCase().includes(query)
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  const allProjectEntries = projectEntries(projects)
  const matchingProjectIds = new Set<string>()
  if (query) {
    for (const entry of allProjectEntries) {
      const project = entry.project
      if (
        project.name.toLowerCase().includes(query) ||
        botsFor(project.id).length ||
        threadsFor(project.id).length ||
        todosFor(project.id).length
      ) {
        matchingProjectIds.add(project.id)
        if (project.parentId) matchingProjectIds.add(project.parentId)
      }
    }
  }
  const visibleProjects = query
    ? allProjectEntries.filter((entry) => matchingProjectIds.has(entry.project.id))
    : allProjectEntries
  const entries: WorkMapViewEntry[] = visibleProjects.map(({ depth, project }) => ({
    bots: botsFor(project.id),
    depth,
    misc: false,
    project,
    threads: page(threadsFor(project.id), Number.MAX_SAFE_INTEGER),
    todos: Object.fromEntries(
      TODO_STATUSES.map((status) => {
        const todos = todosFor(project.id, status)
        const visibleCount =
          input.todoVisibleCounts[todoCountKey(project.id, status)] ?? input.initialTodoCount
        return [status, page(todos, visibleCount)]
      })
    ) as Record<AgentWorkMapTodoStatus, WorkMapViewGroup<AgentWorkMapTodo>>
  }))

  const miscThreads = sortAgentConversationThreads(
    filteredThreads.filter((thread) => {
      if (todoThreadIds.has(thread.nativeThreadId) || botThreadIds.has(thread.nativeThreadId)) {
        return false
      }
      const placement = placementByThread.get(thread.nativeThreadId)
      return !placement?.projectId || !validProjectIds.has(placement.projectId)
    })
  )
  if (miscThreads.length || !allProjectEntries.length) {
    const emptyTodos = Object.fromEntries(
      TODO_STATUSES.map((status) => [status, page<AgentWorkMapTodo>([], 0)])
    ) as Record<AgentWorkMapTodoStatus, WorkMapViewGroup<AgentWorkMapTodo>>
    entries.push({
      bots: [],
      depth: 0,
      misc: true,
      project: { createdAt: '', id: '__misc__', name: 'Misc chats', updatedAt: '' },
      threads: page(miscThreads, input.miscVisibleCount),
      todos: emptyTodos
    })
  }

  const inbox = [...(workMap?.inbox ?? [])].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )
  return {
    emptySearch: Boolean(query && !filteredThreads.length && !visibleProjects.length),
    entries,
    globalBots: botsFor(null),
    inbox,
    unreadInboxCount: inbox.filter((item) => !item.readAt).length
  }
}
