import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import type { AgentConversationHistory } from '@/app/agent-chat/conversations'
import { useAgentWorkMapPersistence } from '@/app/agent-chat/work-map-persistence'
import { useWorkMapSurfaceState } from '@/app/agent-chat/work-map-surface-state'

describe('Work Map surface state', () => {
  test('closes Inbox on each fresh surface and remembers its state outside search', () => {
    const persistence = useAgentWorkMapPersistence()
    persistence.openProjects.value = {}
    const surface = useWorkMapSurfaceState(ref<AgentConversationHistory | null>({ threads: [] }))

    expect(surface.isWorkMapInboxOpen()).toBeFalse()
    surface.toggleWorkMapInbox()
    expect(surface.isWorkMapInboxOpen()).toBeTrue()
    surface.toggleWorkMapInbox()
    expect(surface.isWorkMapInboxOpen()).toBeFalse()

    surface.search.value = 'scheduled'
    expect(surface.isWorkMapInboxOpen()).toBeTrue()
    surface.search.value = ''
    expect(surface.isWorkMapInboxOpen()).toBeFalse()

    surface.toggleWorkMapInbox()
    expect(persistence.openProjects.value).not.toHaveProperty('__inbox__')
    const freshSurface = useWorkMapSurfaceState(
      ref<AgentConversationHistory | null>({ threads: [] })
    )
    expect(freshSurface.isWorkMapInboxOpen()).toBeFalse()
  })

  test('shows only finished scheduled updates and counts the unopened results', () => {
    useAgentWorkMapPersistence().replace({
      bots: [],
      inbox: [
        {
          botId: 'bot-1',
          createdAt: '2026-08-26T12:00:00.000Z',
          id: 'inbox-unopened',
          projectId: null,
          routineId: 'routine-1',
          status: 'completed',
          summary: 'Unopened update',
          threadId: 'thread-1',
          updatedAt: '2026-08-26T12:00:00.000Z'
        },
        {
          botId: 'bot-1',
          createdAt: '2026-08-26T11:00:00.000Z',
          id: 'inbox-opened',
          projectId: null,
          readAt: '2026-08-26T11:30:00.000Z',
          routineId: 'routine-1',
          status: 'completed',
          summary: 'Opened update',
          threadId: 'thread-1',
          updatedAt: '2026-08-26T11:00:00.000Z'
        },
        {
          botId: 'bot-1',
          createdAt: '2026-08-26T13:00:00.000Z',
          id: 'inbox-running',
          projectId: null,
          routineId: 'routine-1',
          status: 'running',
          summary: 'Still running',
          threadId: 'thread-1',
          updatedAt: '2026-08-26T13:00:00.000Z'
        },
        {
          botId: 'bot-1',
          createdAt: '2026-08-26T12:30:00.000Z',
          id: 'inbox-failed',
          projectId: null,
          routineId: 'routine-1',
          status: 'failed',
          summary: 'Failed update',
          threadId: 'thread-1',
          updatedAt: '2026-08-26T12:30:00.000Z'
        }
      ],
      placements: [],
      projects: [],
      revision: 1,
      routines: [],
      todos: []
    })
    const surface = useWorkMapSurfaceState(ref<AgentConversationHistory | null>({ threads: [] }))

    expect(surface.workMapView.value.inbox.map((item) => item.status)).toEqual([
      'failed',
      'completed',
      'completed'
    ])
    expect(surface.workMapView.value.unreadInboxCount).toBe(2)
  })

  test('pages Todo groups and keeps search-driven project visibility together', () => {
    useAgentWorkMapPersistence().replace({
      bots: [],
      inbox: [],
      placements: [],
      projects: [
        {
          createdAt: '2026-08-26T12:00:00.000Z',
          id: 'project-1',
          name: 'OpenPencil',
          updatedAt: '2026-08-26T12:00:00.000Z'
        }
      ],
      revision: 1,
      routines: [],
      todos: Array.from({ length: 6 }, (_, index) => ({
        createdAt: `2026-08-26T12:00:0${String(index)}.000Z`,
        id: `todo-${String(index)}`,
        projectId: 'project-1',
        status: 'todo' as const,
        title: `Cleanup ${String(index)}`,
        updatedAt: `2026-08-26T12:00:0${String(index)}.000Z`
      }))
    })
    const history = ref<AgentConversationHistory | null>({ threads: [] })
    const surface = useWorkMapSurfaceState(history)
    const entry = surface.workMapView.value.entries[0]
    if (!entry) throw new Error('Project fixture missing')

    expect(surface.workMapTodoGroup(entry, 'todo')).toMatchObject({ remaining: 1, total: 6 })
    surface.showMoreProjectTodos('project-1', 'todo')
    expect(surface.workMapView.value.entries[0]?.todos.todo.remaining).toBe(0)

    surface.search.value = 'missing'
    expect(surface.workMapView.value.emptySearch).toBeTrue()
    surface.search.value = 'openpencil'
    expect(surface.isWorkMapProjectOpen('project-1')).toBeTrue()
  })
})
