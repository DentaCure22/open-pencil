import { computed, type Ref } from 'vue'

import { openAgentRightPanel } from '@/app/agent-chat/right-panel'
import { toast } from '@/app/shell/ui'

import type { AgentConversationHistory, AgentConversationThread } from './conversations'
import { agentConversationDisplayTitle } from './thread-preferences'
import {
  openAgentWorkMapProjectPage,
  type AgentWorkMap,
  type AgentWorkMapBot,
  type AgentWorkMapInboxItem,
  type AgentWorkMapProject,
  type AgentWorkMapTodo
} from './work-map'
import { useAgentWorkMapPersistence } from './work-map-persistence'

type WorkMapNavigationOptions = {
  history: Readonly<Ref<AgentConversationHistory | null>>
  openThreadChapter?: (thread: AgentConversationThread, chapterId: string) => Promise<void>
  openTodoObject: (todo: AgentWorkMapTodo, thread: AgentConversationThread) => void
  refresh: (fresh?: boolean) => Promise<void>
  selectThread: (thread: AgentConversationThread) => Promise<void>
}

export function latestWorkMapProjectPageId(
  workMap: AgentWorkMap | null,
  projectId: string
): string | null {
  return (
    [...(workMap?.todos ?? [])]
      .filter((todo) => todo.projectId === projectId && todo.planPageId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.planPageId ?? null
  )
}

export function useWorkMapNavigation(options: WorkMapNavigationOptions) {
  const { applyOperations, load, replace, workMap } = useAgentWorkMapPersistence()
  const threadByNativeId = computed(
    () =>
      new Map(
        (options.history.value?.threads ?? []).map(
          (thread) => [thread.nativeThreadId, thread] as const
        )
      )
  )

  function showProjectLayers(project: AgentWorkMapProject) {
    openAgentRightPanel('layers', { projectId: project.id, projectName: project.name })
  }

  function workMapProjectPageId(projectId: string): string | null {
    const project = workMap.value?.projects.find((candidate) => candidate.id === projectId)
    return project?.spacePageId ?? latestWorkMapProjectPageId(workMap.value, projectId)
  }

  async function revealWorkMapProject(project: AgentWorkMapProject) {
    const pageId = workMapProjectPageId(project.id)
    if (!pageId) {
      toast.info('This project has no Board workspace yet.')
      return
    }
    try {
      await openAgentWorkMapProjectPage(pageId)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Board workspace could not be opened')
    }
  }

  function botThread(bot: AgentWorkMapBot): AgentConversationThread | undefined {
    return threadByNativeId.value.get(bot.threadId)
  }

  function botTitle(bot: AgentWorkMapBot): string {
    const thread = botThread(bot)
    return thread ? agentConversationDisplayTitle(thread) : 'Unavailable Bot'
  }

  function updateWorkMap(nextWorkMap: AgentWorkMap) {
    replace(nextWorkMap)
  }

  async function openBot(bot: AgentWorkMapBot) {
    let thread = botThread(bot)
    if (!thread) {
      await options.refresh(true)
      thread = botThread(bot)
    }
    if (!thread) {
      toast.error('Bot chat unavailable')
      return
    }
    await options.selectThread(thread)
  }

  async function openInboxItem(item: AgentWorkMapInboxItem) {
    if (!item.readAt) await applyOperations([{ inbox_id: item.id, op: 'mark_inbox_read' }])
    const bot = workMap.value?.bots.find((candidate) => candidate.id === item.botId)
    let thread = bot ? botThread(bot) : threadByNativeId.value.get(item.threadId)
    if (!thread) {
      await options.refresh(true)
      thread = threadByNativeId.value.get(item.threadId)
    }
    if (!thread) {
      toast.error('Bot chat unavailable')
      return
    }
    if (item.messageId && options.openThreadChapter) {
      await options.openThreadChapter(thread, item.messageId)
    } else {
      await options.selectThread(thread)
    }
    showInboxBriefing(item)
  }

  function showInboxBriefing(item: AgentWorkMapInboxItem & { title?: string }) {
    if (!item.briefing) return
    const thread = threadByNativeId.value.get(item.threadId)
    const currentTitle = item.title ?? (thread ? agentConversationDisplayTitle(thread) : undefined)
    openAgentRightPanel('object', {
      inboxId: item.id,
      objectId: undefined,
      objectThreadId: item.threadId,
      objectTitle: currentTitle ? `${currentTitle} briefing` : item.briefing.title,
      objectTodoId: undefined,
      projectId: item.projectId ?? undefined
    })
  }

  async function openInboxBriefing(item: AgentWorkMapInboxItem & { title?: string }) {
    if (!item.briefing) return
    if (!item.readAt) await applyOperations([{ inbox_id: item.id, op: 'mark_inbox_read' }])
    showInboxBriefing(item)
  }

  async function archiveInboxItem(item: AgentWorkMapInboxItem) {
    await applyOperations([{ inbox_id: item.id, op: 'archive_inbox' }])
  }

  async function openWorkMapTodo(todo: AgentWorkMapTodo) {
    if (!todo.threadId) {
      toast.info('This older todo has no chat yet.')
      return
    }
    let thread = threadByNativeId.value.get(todo.threadId)
    if (!thread) {
      await options.refresh(true)
      thread = threadByNativeId.value.get(todo.threadId)
    }
    if (!thread) {
      toast.error('Todo chat unavailable')
      return
    }
    await options.selectThread(thread)
  }

  async function openWorkMapTodoObject(todo: AgentWorkMapTodo) {
    if (!todo.threadId) {
      toast.info('This older todo has no object yet.')
      return
    }
    let thread = threadByNativeId.value.get(todo.threadId)
    if (!thread) {
      await options.refresh(true)
      thread = threadByNativeId.value.get(todo.threadId)
    }
    if (!thread) {
      toast.error('Todo object unavailable')
      return
    }
    options.openTodoObject(todo, thread)
  }

  async function refreshWorkMap() {
    await load()
  }

  return {
    botThread,
    botTitle,
    archiveInboxItem,
    openBot,
    openInboxBriefing,
    openInboxItem,
    openWorkMapTodo,
    openWorkMapTodoObject,
    refreshWorkMap,
    revealWorkMapProject,
    showProjectLayers,
    threadByNativeId,
    updateWorkMap,
    workMapProjectPageId
  }
}
