import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import type { AgentWorkMap } from '@/app/agent-chat/work-map'
import { useWorkMapDrag, type WorkMapDropEvent } from '@/app/agent-chat/work-map-drag'

function dragEvent() {
  const recorded = new Map<string, string>()
  const state = { prevented: 0, stopped: 0 }
  const dataTransfer = {
    dropEffect: 'none',
    effectAllowed: 'none',
    get types() {
      return [...recorded.keys()]
    },
    getData(type: string) {
      return recorded.get(type) ?? ''
    },
    setData(type: string, value: string) {
      recorded.set(type, value)
    }
  }
  const event: WorkMapDropEvent = {
    dataTransfer,
    preventDefault() {
      state.prevented += 1
    },
    stopPropagation() {
      state.stopped += 1
    }
  }
  return { dataTransfer, event, recorded, state }
}

function workMap(): AgentWorkMap {
  return {
    bots: [],
    inbox: [],
    placements: [],
    projects: [],
    revision: 1,
    routines: [],
    todos: [
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'todo-1',
        projectId: 'project-1',
        status: 'todo',
        title: 'Deepen the Work Map',
        updatedAt: '2026-08-26T12:00:00.000Z'
      }
    ]
  }
}

describe('Work Map drag controller', () => {
  test('accepts todo moves only within their project and clears the drag state', async () => {
    const statusChanges: Array<{ status: string; todoId: string }> = []
    let contentDropClears = 0
    const drag = useWorkMapDrag({
      clearContentDrop: () => {
        contentDropClears += 1
      },
      createChat: async () => undefined,
      createProject: () => undefined,
      placeChat: async () => {
        throw new Error('Chat placement was not expected')
      },
      setTodoStatus: async (todoId, status) => {
        statusChanges.push({ status, todoId })
      },
      workMap: ref(workMap())
    })
    const todo = workMap().todos[0]
    if (!todo) throw new Error('Todo fixture missing')

    const started = dragEvent()
    drag.beginWorkMapTodoDrag(started.event, todo)
    expect(started.recorded.get('application/x-openpencil-work-map-todo')).toBe(todo.id)
    expect(drag.draggedWorkMapTodoId.value).toBe(todo.id)

    const foreign = dragEvent()
    drag.showWorkMapTodoDrop(foreign.event, 'project-2', 'in_motion')
    expect(foreign.state.prevented).toBe(0)
    expect(drag.workMapDropTodoStatus.value).toBeNull()

    const accepted = dragEvent()
    drag.showWorkMapTodoDrop(accepted.event, 'project-1', 'in_motion')
    expect(accepted.state.prevented).toBe(1)
    expect(accepted.dataTransfer.dropEffect).toBe('move')
    expect(drag.workMapDropTodoStatus.value).toBe('project-1:in_motion')
    await drag.dropWorkMapTodo(accepted.event, 'project-1', 'in_motion')

    expect(statusChanges).toEqual([{ status: 'in_motion', todoId: 'todo-1' }])
    expect(drag.draggedWorkMapTodoId.value).toBeNull()
    expect(drag.workMapDropTodoStatus.value).toBeNull()
    expect(contentDropClears).toBe(1)
  })

  test('places a dragged chat and clears the project target', async () => {
    const placements: Array<{ projectId: string | null; threadId: string }> = []
    const drag = useWorkMapDrag({
      clearContentDrop: () => undefined,
      createChat: async () => undefined,
      createProject: () => undefined,
      placeChat: async (threadId, projectId) => {
        placements.push({ projectId, threadId })
      },
      setTodoStatus: async () => {
        throw new Error('Todo status update was not expected')
      },
      workMap: ref(workMap())
    })
    drag.draggedWorkMapThreadId.value = 'native-thread-1'
    const event = dragEvent()

    drag.showWorkMapProjectDrop(event.event, null)
    expect(drag.workMapDropProjectId.value).toBeNull()
    await drag.dropWorkMapThread(event.event, null)

    expect(placements).toEqual([{ projectId: null, threadId: 'native-thread-1' }])
    expect(drag.draggedWorkMapThreadId.value).toBeNull()
    expect(drag.workMapDropProjectId.value).toBeUndefined()
  })

  test('drops new Bot and chat templates into the selected directory', async () => {
    const projects: Array<string | undefined> = []
    const chats: Array<string | null> = []
    const state = workMap()
    state.projects = [
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'project-1',
        name: 'Dental Chart',
        updatedAt: '2026-08-26T12:00:00.000Z'
      },
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'project-child',
        name: 'History',
        parentId: 'project-1',
        updatedAt: '2026-08-26T12:00:00.000Z'
      }
    ]
    const drag = useWorkMapDrag({
      clearContentDrop: () => undefined,
      createChat: async (projectId) => {
        chats.push(projectId)
      },
      createProject: (parentId) => {
        projects.push(parentId)
      },
      placeChat: async () => undefined,
      setTodoStatus: async () => undefined,
      workMap: ref(state)
    })

    drag.draggedWorkMapCreationKind.value = 'bot'
    const botTarget = dragEvent()
    drag.showWorkMapProjectDrop(botTarget.event, 'project-1')
    expect(botTarget.dataTransfer.dropEffect).toBe('copy')
    await drag.dropWorkMapThread(botTarget.event, 'project-1')
    expect(projects).toEqual(['project-1'])

    drag.draggedWorkMapCreationKind.value = 'bot'
    const nestedTarget = dragEvent()
    drag.showWorkMapProjectDrop(nestedTarget.event, 'project-child')
    expect(nestedTarget.state.prevented).toBe(0)

    drag.draggedWorkMapCreationKind.value = 'chat'
    const chatTarget = dragEvent()
    drag.showWorkMapProjectDrop(chatTarget.event, 'project-child')
    await drag.dropWorkMapThread(chatTarget.event, 'project-child')
    expect(chats).toEqual(['project-child'])
  })
})
