import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import type {
  AgentConversationHistory,
  AgentConversationThread
} from '@/app/agent-chat/conversations'
import { agentRightPanelState } from '@/app/agent-chat/right-panel'
import type { AgentWorkMap } from '@/app/agent-chat/work-map'
import {
  latestWorkMapProjectPageId,
  useWorkMapNavigation
} from '@/app/agent-chat/work-map-navigation'
import { useAgentWorkMapPersistence } from '@/app/agent-chat/work-map-persistence'

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-26T12:00:00.000Z',
    effort: 'medium',
    id: 'agent:bot-thread',
    messages: [],
    model: 'gpt-5.6-sol',
    nativeThreadId: 'bot-thread',
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task: 'Routine Bot',
    title: 'Routine Bot',
    updatedAt: '2026-08-26T12:00:00.000Z'
  }
}

function workMap(): AgentWorkMap {
  return {
    bots: [
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'bot-1',
        projectId: null,
        threadId: 'bot-thread',
        updatedAt: '2026-08-26T12:00:00.000Z'
      }
    ],
    inbox: [],
    placements: [],
    projects: [
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'project-1',
        name: 'Dental Chart',
        spaceFrameId: 'frame-project-1',
        spacePageId: 'page-project-1',
        updatedAt: '2026-08-26T12:00:00.000Z'
      }
    ],
    revision: 1,
    routines: [],
    todos: [
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'older-plan',
        planPageId: 'page-old',
        projectId: 'project-1',
        status: 'todo',
        title: 'Old plan',
        updatedAt: '2026-08-26T12:00:00.000Z'
      },
      {
        createdAt: '2026-08-26T13:00:00.000Z',
        id: 'newer-plan',
        planPageId: 'page-new',
        projectId: 'project-1',
        status: 'todo',
        title: 'New plan',
        updatedAt: '2026-08-26T13:00:00.000Z'
      }
    ]
  }
}

describe('Work Map navigation', () => {
  test('resolves the newest Board page for a project', () => {
    expect(latestWorkMapProjectPageId(workMap(), 'project-1')).toBe('page-new')
    expect(latestWorkMapProjectPageId(workMap(), 'project-2')).toBeNull()
  })

  test('opens a Bot through its thread identity', async () => {
    const selected: string[] = []
    const history = ref<AgentConversationHistory | null>({ threads: [thread()] })
    useAgentWorkMapPersistence().replace(workMap())
    const navigation = useWorkMapNavigation({
      history,
      openTodoObject: () => undefined,
      refresh: async () => undefined,
      selectThread: async (candidate) => {
        selected.push(candidate.id)
      }
    })
    const bot = workMap().bots[0]
    if (!bot) throw new Error('Bot fixture missing')

    await navigation.openBot(bot)

    expect(selected).toEqual(['agent:bot-thread'])
    expect(navigation.botTitle(bot)).toBe('Routine Bot')
    expect(navigation.workMapProjectPageId('project-1')).toBe('page-project-1')
  })

  test('opens the exact scheduled message with its briefing Object', async () => {
    const history = ref<AgentConversationHistory | null>({ threads: [thread()] })
    const state = workMap()
    const item = {
      botId: 'bot-1',
      briefing: {
        content: 'Two tasks need attention.',
        id: 'briefing:run-1',
        title: 'Routine Bot briefing'
      },
      createdAt: '2026-08-26T13:00:00.000Z',
      id: 'inbox:run-1',
      messageId: 'message:routine-prompt',
      projectId: null,
      readAt: '2026-08-26T13:01:00.000Z',
      routineId: 'routine-1',
      status: 'completed' as const,
      summary: 'Two tasks need attention.',
      threadId: 'bot-thread',
      title: 'Morning Email Check Assistant',
      updatedAt: '2026-08-26T13:01:00.000Z'
    }
    state.inbox.push(item)
    useAgentWorkMapPersistence().replace(state)
    const opened: Array<[string, string]> = []
    const navigation = useWorkMapNavigation({
      history,
      openThreadChapter: async (candidate, chapterId) => {
        opened.push([candidate.id, chapterId])
      },
      openTodoObject: () => undefined,
      refresh: async () => undefined,
      selectThread: async () => undefined
    })

    await navigation.openInboxItem(item)
    expect(opened).toEqual([['agent:bot-thread', 'message:routine-prompt']])
    expect(agentRightPanelState.value).toMatchObject({
      inboxId: 'inbox:run-1',
      objectThreadId: 'bot-thread',
      objectTitle: 'Morning Email Check Assistant briefing',
      open: true,
      surface: 'object'
    })

    await navigation.openInboxBriefing(item)
    expect(agentRightPanelState.value).toMatchObject({
      inboxId: 'inbox:run-1',
      objectThreadId: 'bot-thread',
      objectTitle: 'Morning Email Check Assistant briefing',
      open: true,
      surface: 'object'
    })
  })
})
