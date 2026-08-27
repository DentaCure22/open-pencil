import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import type { AgentWorkMap } from '@/app/agent-chat/work-map'
import { buildAgentWorkMapView } from '@/app/agent-chat/work-map-view'

function thread(id: string, task: string, updatedAt: string): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: updatedAt,
    effort: 'medium',
    id: `agent:${id}`,
    messages: [],
    model: 'gpt-5.6-sol',
    nativeThreadId: id,
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task,
    updatedAt
  }
}

const threads = [
  thread('bot-thread', 'Project Bot', '2026-08-26T12:05:00.000Z'),
  thread('todo-thread', 'Dentist Todo', '2026-08-26T12:04:00.000Z'),
  thread('project-chat', 'Project chat', '2026-08-26T12:03:00.000Z'),
  thread('misc-chat', 'Loose chat', '2026-08-26T12:02:00.000Z'),
  thread('orphan-chat', 'Orphan chat', '2026-08-26T12:01:00.000Z')
]

const workMap: AgentWorkMap = {
  bots: [
    {
      avatarVariant: 0,
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'project-bot',
      projectId: 'child',
      threadId: 'bot-thread',
      updatedAt: '2026-08-26T12:05:00.000Z'
    },
    {
      avatarVariant: 1,
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'global-bot',
      projectId: null,
      threadId: 'global-bot-thread',
      updatedAt: '2026-08-26T12:00:00.000Z'
    }
  ],
  inbox: [],
  placements: [
    {
      manual: true,
      projectId: 'child',
      threadId: 'project-chat',
      updatedAt: '2026-08-26T12:03:00.000Z'
    },
    {
      manual: true,
      projectId: 'missing-project',
      threadId: 'orphan-chat',
      updatedAt: '2026-08-26T12:01:00.000Z'
    }
  ],
  projects: [
    {
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'root',
      name: 'Practice',
      updatedAt: '2026-08-26T12:00:00.000Z'
    },
    {
      botId: 'project-bot',
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'child',
      name: 'Operations',
      parentId: 'root',
      updatedAt: '2026-08-26T12:00:00.000Z'
    }
  ],
  revision: 1,
  routines: [],
  todos: [
    {
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'todo-new',
      projectId: 'child',
      status: 'todo',
      threadId: 'todo-thread',
      title: 'Dentist follow-up',
      updatedAt: '2026-08-26T12:06:00.000Z'
    },
    {
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'todo-old',
      projectId: 'child',
      status: 'todo',
      title: 'Dentist paperwork',
      updatedAt: '2026-08-26T12:05:00.000Z'
    },
    {
      archivedAt: '2026-08-26T12:04:00.000Z',
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'todo-archived',
      projectId: 'child',
      status: 'todo',
      title: 'Dentist archived',
      updatedAt: '2026-08-26T12:04:00.000Z'
    }
  ]
}

function view(query = '') {
  return buildAgentWorkMapView({
    initialMiscCount: 2,
    initialTodoCount: 1,
    miscVisibleCount: 2,
    query,
    threads,
    todoVisibleCounts: {},
    workMap
  })
}

describe('Work Map view projection', () => {
  test('places project chats in their project and keeps loose chats in Misc', () => {
    const result = view()
    expect(result.entries.map((entry) => entry.project.id)).toEqual(['root', 'child'])
    expect(new Set(result.entries.map((entry) => entry.avatarVariant)).size).toBe(2)
    expect(result.globalBots.map((bot) => bot.id)).toEqual(['global-bot'])
    expect(result.misc.items.map((thread) => thread.nativeThreadId)).toEqual([
      'misc-chat',
      'orphan-chat'
    ])
    expect(result.misc.allItems.map((thread) => thread.nativeThreadId)).toEqual([
      'misc-chat',
      'orphan-chat'
    ])
    expect(result.misc).toMatchObject({ remaining: 0, total: 2 })

    const child = result.entries.find((entry) => entry.project.id === 'child')
    if (!child) throw new Error('Child project missing')
    expect(child.depth).toBe(1)
    expect(child.directoryBot?.id).toBe('project-bot')
    expect(child.avatarVariant).toBe(0)
    expect(child.bots.map((bot) => bot.id)).toEqual(['project-bot'])
    expect(child.threads.items.map((thread) => thread.nativeThreadId)).toEqual(['project-chat'])
    expect(child.todos.todo.items.map((todo) => todo.id)).toEqual(['todo-new'])
    expect(child.todos.todo).toMatchObject({ remaining: 1, total: 2 })
  })

  test('keeps a matching child with its parent and reports an empty search', () => {
    const matched = view('dentist')
    expect(matched.entries.map((entry) => entry.project.id)).toEqual(['root', 'child'])
    expect(matched.emptySearch).toBe(false)

    const empty = view('definitely absent')
    expect(empty.entries).toEqual([])
    expect(empty.emptySearch).toBe(true)
  })

  test('uses only the explicit charter Bot even when a scheduled Bot is newer', () => {
    const scheduledThread = thread(
      'scheduled-thread',
      'Morning Email Check Assistant',
      '2026-08-26T12:10:00.000Z'
    )
    const result = buildAgentWorkMapView({
      initialMiscCount: 2,
      initialTodoCount: 1,
      miscVisibleCount: 2,
      query: '',
      threads: [...threads, scheduledThread],
      todoVisibleCounts: {},
      workMap: {
        ...workMap,
        bots: [
          ...workMap.bots,
          {
            avatarVariant: 2,
            createdAt: scheduledThread.createdAt,
            id: 'scheduled-bot',
            projectId: 'child',
            threadId: scheduledThread.nativeThreadId,
            updatedAt: scheduledThread.updatedAt
          }
        ]
      }
    })

    const child = result.entries.find((entry) => entry.project.id === 'child')
    expect(child?.bots.map((bot) => bot.id)).toEqual(['scheduled-bot', 'project-bot'])
    expect(child?.directoryBot?.id).toBe('project-bot')
  })

  test('does not promote a directory member when no charter Bot is linked', () => {
    const result = buildAgentWorkMapView({
      initialMiscCount: 2,
      initialTodoCount: 1,
      miscVisibleCount: 2,
      query: '',
      threads,
      todoVisibleCounts: {},
      workMap: {
        ...workMap,
        projects: workMap.projects.map((project) => {
          if (project.id !== 'child') return project
          const { botId: _botId, ...unlinked } = project
          return unlinked
        })
      }
    })

    const child = result.entries.find((entry) => entry.project.id === 'child')
    expect(child?.bots.map((bot) => bot.id)).toEqual(['project-bot'])
    expect(child?.directoryBot).toBeNull()
  })

  test('matches projects from placed chats while loose chats stay in Misc', () => {
    const placedChatSearch = view('project chat')
    expect(placedChatSearch.entries.map((entry) => entry.project.id)).toEqual(['root', 'child'])
    expect(placedChatSearch.misc.items).toEqual([])
    expect(
      placedChatSearch.entries
        .find((entry) => entry.project.id === 'child')
        ?.threads.items.map((thread) => thread.nativeThreadId)
    ).toEqual(['project-chat'])
    expect(placedChatSearch.emptySearch).toBe(false)

    const looseChatSearch = view('loose chat')
    expect(looseChatSearch.entries).toEqual([])
    expect(looseChatSearch.misc.items.map((thread) => thread.nativeThreadId)).toEqual(['misc-chat'])
    expect(looseChatSearch.emptySearch).toBe(false)
  })

  test('shows only finished Inbox checks and names them from the linked chat', () => {
    const titledBot = {
      ...thread('bot-thread', 'Check the morning email', '2026-08-26T12:05:00.000Z'),
      title: 'Morning email check'
    }
    const result = buildAgentWorkMapView({
      initialMiscCount: 2,
      initialTodoCount: 1,
      miscVisibleCount: 2,
      query: '',
      threads: [titledBot],
      todoVisibleCounts: {},
      workMap: {
        ...workMap,
        inbox: [
          {
            botId: 'project-bot',
            createdAt: '2026-08-26T12:06:00.000Z',
            id: 'inbox:finished',
            projectId: 'child',
            routineId: 'routine:morning',
            status: 'completed',
            summary: '**Done** Gmail connected as `person@example.test`.',
            threadId: 'bot-thread',
            updatedAt: '2026-08-26T12:07:00.000Z'
          },
          {
            botId: 'project-bot',
            createdAt: '2026-08-26T12:08:00.000Z',
            id: 'inbox:running',
            projectId: 'child',
            routineId: 'routine:morning',
            status: 'running',
            summary: 'Scheduled work is running.',
            threadId: 'bot-thread',
            updatedAt: '2026-08-26T12:08:00.000Z'
          },
          {
            archivedAt: '2026-08-26T12:09:00.000Z',
            botId: 'project-bot',
            createdAt: '2026-08-26T12:09:00.000Z',
            id: 'inbox:archived',
            projectId: 'child',
            routineId: 'routine:morning',
            status: 'completed',
            summary: 'Older result.',
            threadId: 'bot-thread',
            updatedAt: '2026-08-26T12:09:00.000Z'
          }
        ]
      }
    })

    expect(result.inbox).toHaveLength(1)
    expect(result.inbox[0]).toMatchObject({
      id: 'inbox:finished',
      summary: '**Done** Gmail connected as `person@example.test`.',
      title: 'Morning email check'
    })
    expect(result.unreadInboxCount).toBe(1)
  })

  test('uses one visibility budget for every row under In motion', () => {
    const projectChats = Array.from({ length: 5 }, (_, index) =>
      thread(
        `project-chat-${index}`,
        `Project chat ${index}`,
        `2026-08-26T12:0${9 - index}:00.000Z`
      )
    )
    const input = {
      initialMiscCount: 2,
      initialProjectInMotionCount: 5,
      initialTodoCount: 5,
      miscVisibleCount: 2,
      query: '',
      threads: projectChats,
      todoVisibleCounts: {},
      workMap: {
        bots: [],
        inbox: [],
        placements: projectChats.map((chat) => ({
          manual: true,
          projectId: 'project',
          threadId: chat.nativeThreadId,
          updatedAt: chat.updatedAt
        })),
        projects: [
          {
            createdAt: '2026-08-26T12:00:00.000Z',
            id: 'project',
            name: 'Project',
            updatedAt: '2026-08-26T12:00:00.000Z'
          }
        ],
        revision: 1,
        routines: [],
        todos: Array.from({ length: 3 }, (_, index) => ({
          createdAt: '2026-08-26T12:00:00.000Z',
          id: `in-motion-${index}`,
          projectId: 'project',
          status: 'in_motion' as const,
          title: `In motion Todo ${index}`,
          updatedAt: `2026-08-26T11:0${9 - index}:00.000Z`
        }))
      }
    }
    const result = buildAgentWorkMapView(input)
    const project = result.entries[0]
    if (!project) throw new Error('Project missing')

    expect(project.threads.items.length + project.todos.in_motion.items.length).toBe(5)
    expect(project.inMotion).toEqual({ remaining: 3, total: 8 })
  })
})
