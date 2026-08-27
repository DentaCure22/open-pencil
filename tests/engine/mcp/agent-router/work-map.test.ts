import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { WorkMapStore } from '#mcp/agent-router/work-map'

describe('Work Map store', () => {
  test('persists one-level project structure and rejects deeper nesting', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-work-map-'))
    const filePath = path.join(root, 'work-map.json')
    try {
      const store = new WorkMapStore(filePath)
      store.apply({
        actor: { kind: 'user' },
        expectedRevision: 0,
        operations: [
          {
            name: 'Treatment plan',
            op: 'create_project',
            project_id: 'project:treatment'
          },
          {
            name: 'Plan editor',
            op: 'create_project',
            parent_id: 'project:treatment',
            project_id: 'project:editor'
          }
        ]
      })

      expect(() =>
        store.apply({
          actor: { kind: 'user' },
          expectedRevision: 1,
          operations: [
            {
              name: 'Too deep',
              op: 'create_project',
              parent_id: 'project:editor'
            }
          ]
        })
      ).toThrow('only one subproject level')

      expect(new WorkMapStore(filePath).snapshot()).toMatchObject({
        projects: [
          { id: 'project:treatment', name: 'Treatment plan' },
          {
            id: 'project:editor',
            name: 'Plan editor',
            parentId: 'project:treatment'
          }
        ],
        revision: 1
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('keeps root Bot and sub-bot Board spaces absent until the first object is placed', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        },
        {
          name: 'Patient history',
          op: 'create_project',
          parent_id: 'project:dental',
          project_id: 'project:history'
        },
        {
          bot_id: 'bot:dental',
          op: 'create_bot',
          project_id: 'project:dental',
          thread_id: 'thread:dental'
        },
        {
          bot_id: 'bot:history',
          op: 'create_bot',
          project_id: 'project:history',
          thread_id: 'thread:history'
        },
        {
          op: 'place_chat',
          project_id: 'project:history',
          thread_id: 'thread:history'
        }
      ]
    })

    const [rootBot, subBot] = store.snapshot().projects
    expect(rootBot?.botId).toBe('bot:dental')
    expect(subBot?.botId).toBe('bot:history')
    expect(rootBot).not.toHaveProperty('spaceFrameId')
    expect(rootBot).not.toHaveProperty('spacePageId')
    expect(subBot).not.toHaveProperty('spaceFrameId')
    expect(subBot).not.toHaveProperty('spacePageId')

    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:history', kind: 'agent' },
        expectedRevision: 1,
        operations: [
          {
            frame_id: 'frame:history-space',
            op: 'set_project_space',
            page_id: 'page:dental',
            project_id: 'project:history'
          }
        ]
      })
    ).toThrow('parent Bot space')

    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 1,
      operations: [
        {
          frame_id: 'frame:dental-space',
          op: 'set_project_space',
          page_id: 'page:dental',
          project_id: 'project:dental'
        }
      ]
    })

    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:history', kind: 'agent' },
        expectedRevision: 2,
        operations: [
          {
            frame_id: 'frame:history-space',
            op: 'set_project_space',
            page_id: 'page:other',
            project_id: 'project:history'
          }
        ]
      })
    ).toThrow('same Board page')

    store.apply({
      actor: { currentThreadId: 'thread:history', kind: 'agent' },
      expectedRevision: 2,
      operations: [
        {
          frame_id: 'frame:history-space',
          op: 'set_project_space',
          page_id: 'page:dental',
          project_id: 'project:history'
        }
      ]
    })

    expect(store.snapshot().projects).toEqual([
      expect.objectContaining({
        id: 'project:dental',
        spaceFrameId: 'frame:dental-space',
        spacePageId: 'page:dental'
      }),
      expect.objectContaining({
        id: 'project:history',
        spaceFrameId: 'frame:history-space',
        spacePageId: 'page:dental'
      })
    ])

    expect(() =>
      store.apply({
        actor: { kind: 'user' },
        expectedRevision: 3,
        operations: [
          {
            frame_id: null,
            op: 'set_project_space',
            page_id: null,
            project_id: 'project:dental'
          }
        ]
      })
    ).toThrow('sub-bot "project:history" is still bound inside it')
  })

  test('manual chat placement wins over agent organization', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Patient data',
          op: 'create_project',
          project_id: 'project:patient'
        },
        {
          op: 'place_chat',
          project_id: 'project:patient',
          thread_id: 'thread:current'
        }
      ]
    })

    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:current', kind: 'agent' },
        expectedRevision: 1,
        operations: [{ op: 'place_chat', project_id: null, thread_id: 'thread:current' }]
      })
    ).toThrow('Manual chat placement is locked')
    expect(store.snapshot().placements[0]).toMatchObject({
      manual: true,
      projectId: 'project:patient'
    })
  })

  test('binds a project workspace and resolves chats from nested directories', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        },
        {
          op: 'set_project_workspace',
          project_id: 'project:dental',
          workspace_root: '/tmp/smylr-elite'
        }
      ]
    })

    expect(store.projectForWorkspaceRoot('/tmp/smylr-elite/src/dental-chart')).toMatchObject({
      id: 'project:dental',
      workspaceRoot: '/tmp/smylr-elite'
    })
    expect(store.projectForWorkspaceRoot('/tmp/unrelated')).toBeNull()

    store.apply({
      actor: { kind: 'system' },
      expectedRevision: 1,
      operations: [
        {
          op: 'place_chat',
          project_id: 'project:dental',
          thread_id: 'thread:launched'
        }
      ]
    })
    expect(store.snapshot().placements).toContainEqual(
      expect.objectContaining({
        manual: false,
        projectId: 'project:dental',
        threadId: 'thread:launched'
      })
    )
  })

  test('binds one exact Board space to the active project without agent replacement', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        }
      ]
    })
    store.apply({
      actor: { currentThreadId: 'thread:current', kind: 'agent' },
      expectedRevision: 1,
      operations: [
        {
          op: 'place_chat',
          project_id: 'project:dental',
          thread_id: 'thread:current'
        },
        {
          frame_id: 'frame:dental-space',
          op: 'set_project_space',
          page_id: 'page:product',
          project_id: 'project:dental'
        }
      ]
    })

    expect(store.snapshot().projects[0]).toMatchObject({
      id: 'project:dental',
      spaceFrameId: 'frame:dental-space',
      spacePageId: 'page:product'
    })
    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:current', kind: 'agent' },
        expectedRevision: 2,
        operations: [
          {
            frame_id: 'frame:other',
            op: 'set_project_space',
            page_id: 'page:other',
            project_id: 'project:dental'
          }
        ]
      })
    ).toThrow('cannot replace an existing project space')

    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 2,
      operations: [
        {
          frame_id: null,
          op: 'set_project_space',
          page_id: null,
          project_id: 'project:dental'
        }
      ]
    })
    expect(store.snapshot().projects[0]?.spaceFrameId).toBeUndefined()
    expect(store.snapshot().projects[0]?.spacePageId).toBeUndefined()
  })

  test('lets an agent advance linked work while only the user can archive it', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Treatment plan',
          op: 'create_project',
          project_id: 'project:treatment'
        },
        {
          op: 'create_todo',
          project_id: 'project:treatment',
          thread_id: 'thread:other',
          title: 'Unrelated work',
          todo_id: 'todo:other'
        }
      ]
    })
    store.apply({
      actor: { currentThreadId: 'thread:current', kind: 'agent' },
      expectedRevision: 1,
      operations: [
        {
          op: 'create_todo',
          project_id: 'project:treatment',
          thread_id: 'thread:current',
          title: 'Validate the saved treatment workflow',
          todo_id: 'todo:validate'
        },
        { op: 'update_todo', status: 'in_motion', todo_id: 'todo:validate' }
      ]
    })

    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:current', kind: 'agent' },
        expectedRevision: 2,
        operations: [{ op: 'update_todo', status: 'in_motion', todo_id: 'todo:other' }]
      })
    ).toThrow('only the Todo linked to its active chat')

    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:current', kind: 'agent' },
        expectedRevision: 2,
        operations: [{ op: 'archive_todo', todo_id: 'todo:validate' }]
      })
    ).toThrow('Only the user can archive')

    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 2,
      operations: [{ op: 'archive_todo', todo_id: 'todo:validate' }]
    })
    expect(store.snapshot().todos.find((todo) => todo.id === 'todo:validate')).toMatchObject({
      archivedAt: expect.any(String),
      status: 'in_motion',
      threadId: 'thread:current'
    })

    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 3,
      operations: [{ op: 'restore_todo', todo_id: 'todo:validate' }]
    })
    expect(
      store.snapshot().todos.find((todo) => todo.id === 'todo:validate')?.archivedAt
    ).toBeUndefined()
  })

  test('deletes a Todo without deleting its underlying chat', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Treatment plan',
          op: 'create_project',
          project_id: 'project:treatment'
        },
        {
          op: 'create_todo',
          project_id: 'project:treatment',
          thread_id: 'thread:prepared',
          title: 'Prepared chat',
          todo_id: 'todo:prepared'
        }
      ]
    })

    const receipt = store.apply({
      actor: { kind: 'user' },
      expectedRevision: 1,
      operations: [{ op: 'delete_todo', todo_id: 'todo:prepared' }]
    })

    expect(receipt.results).toEqual([{ changed: true, id: 'todo:prepared', op: 'delete_todo' }])
    expect(store.snapshot().todos).toEqual([])
  })

  test('keeps the Work Map title synchronized with its Todo Code Object chat', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        },
        {
          op: 'create_todo',
          project_id: 'project:dental',
          thread_id: 'todo-chat:responsive',
          title: 'A long provisional title',
          todo_id: 'todo:responsive'
        }
      ]
    })

    expect(store.syncTodoTitleForThread('todo-chat:responsive', 'Responsive Todo')).toBe(true)
    expect(store.snapshot()).toMatchObject({
      revision: 2,
      todos: [{ id: 'todo:responsive', title: 'Responsive Todo' }]
    })
    expect(store.syncTodoTitleForThread('todo-chat:responsive', 'Responsive Todo')).toBe(false)
  })

  test('migrates legacy statuses into the two-state active lifecycle', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-work-map-legacy-'))
    const filePath = path.join(root, 'work-map.json')
    const timestamp = '2026-08-25T12:00:00.000Z'
    try {
      await writeFile(
        filePath,
        `${JSON.stringify({
          placements: [],
          projects: [
            {
              createdAt: timestamp,
              id: 'project:dental-chart',
              name: 'Dental Chart',
              updatedAt: timestamp
            }
          ],
          requests: [],
          revision: 4,
          todos: [
            {
              createdAt: timestamp,
              id: 'todo:input',
              projectId: 'project:dental-chart',
              status: 'needs_you',
              title: 'Choose the chart default',
              updatedAt: timestamp
            },
            {
              createdAt: timestamp,
              id: 'todo:verify',
              projectId: 'project:dental-chart',
              status: 'review',
              title: 'Verify the chart flow',
              updatedAt: timestamp
            },
            {
              createdAt: timestamp,
              id: 'todo:finished',
              projectId: 'project:dental-chart',
              status: 'finished',
              title: 'Previously finished work',
              updatedAt: timestamp
            }
          ],
          version: 1
        })}\n`
      )

      expect(new WorkMapStore(filePath).snapshot().todos).toMatchObject([
        { id: 'todo:input', status: 'in_motion' },
        { id: 'todo:verify', status: 'in_motion' },
        { archivedAt: timestamp, id: 'todo:finished', status: 'in_motion' }
      ])
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
        bots: [],
        inbox: [],
        revision: 4,
        routines: [],
        todos: [
          { id: 'todo:input', status: 'in_motion' },
          { id: 'todo:verify', status: 'in_motion' },
          { archivedAt: timestamp, id: 'todo:finished', status: 'in_motion' }
        ]
      })
      expect(JSON.parse(await readFile(filePath, 'utf8')).version).toBe(2)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('randomizes among the least-used avatar variants for new Bots', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: Array.from({ length: 7 }, (_, index) => ({
        bot_id: `bot:${String(index)}`,
        op: 'create_bot' as const,
        project_id: null,
        thread_id: `thread:${String(index)}`
      }))
    })

    const variants = store.snapshot().bots.map((bot) => bot.avatarVariant)
    expect(variants.slice(0, 6).sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(variants[6]).toBeWithin(0, 6)
  })

  test('migrates an unassigned legacy Bot and its Inbox receipts into a full directory', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:weekly-calendar',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:weekly-calendar'
        },
        {
          bot_id: 'bot:weekly-calendar',
          next_run_at: '2026-08-26T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review the weekly calendar',
          routine_id: 'routine:weekly-calendar'
        }
      ]
    })
    store.beginRoutineRun('routine:weekly-calendar', {
      now: new Date('2026-08-26T12:00:00.000Z')
    })

    expect(
      store.ensureBotDirectories((threadId) =>
        threadId === 'thread:weekly-calendar' ? 'Weekly calendar' : undefined
      )
    ).toBe(true)
    expect(store.ensureBotDirectories(() => undefined)).toBe(false)
    expect(store.snapshot()).toMatchObject({
      bots: [
        {
          id: 'bot:weekly-calendar',
          projectId: 'project:weekly-calendar',
          threadId: 'thread:weekly-calendar'
        }
      ],
      inbox: [{ projectId: 'project:weekly-calendar' }],
      placements: [
        {
          projectId: 'project:weekly-calendar',
          threadId: 'thread:weekly-calendar'
        }
      ],
      projects: [
        {
          botId: 'bot:weekly-calendar',
          id: 'project:weekly-calendar',
          name: 'Weekly calendar'
        }
      ]
    })
  })

  test('keeps the first project Bot as its charter and clears only that link on delete', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        { name: 'Dental Chart', op: 'create_project', project_id: 'project:dental' },
        {
          bot_id: 'bot:charter',
          op: 'create_bot',
          project_id: 'project:dental',
          thread_id: 'thread:charter'
        },
        {
          bot_id: 'bot:morning-email',
          op: 'create_bot',
          project_id: 'project:dental',
          thread_id: 'thread:morning-email'
        }
      ]
    })

    expect(store.snapshot().projects[0]?.botId).toBe('bot:charter')
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 1,
      operations: [{ bot_id: 'bot:morning-email', op: 'delete_bot' }]
    })
    expect(store.snapshot().projects[0]?.botId).toBe('bot:charter')

    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 2,
      operations: [{ bot_id: 'bot:charter', op: 'delete_bot' }]
    })
    expect(store.snapshot().projects[0]).not.toHaveProperty('botId')
  })

  test('backfills only a unique exact legacy charter title', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-work-map-charter-'))
    const filePath = path.join(root, 'work-map.json')
    const timestamp = '2026-08-26T12:00:00.000Z'
    try {
      await writeFile(
        filePath,
        `${JSON.stringify({
          bots: [
            {
              avatarVariant: 0,
              createdAt: timestamp,
              id: 'bot:morning-email',
              projectId: 'project:dental',
              threadId: 'thread:morning-email',
              updatedAt: timestamp
            },
            {
              avatarVariant: 1,
              createdAt: timestamp,
              id: 'bot:operations',
              projectId: 'project:operations',
              threadId: 'thread:operations',
              updatedAt: timestamp
            }
          ],
          inbox: [],
          placements: [],
          projects: [
            {
              createdAt: timestamp,
              id: 'project:dental',
              name: 'Dental Chart',
              updatedAt: timestamp
            },
            {
              createdAt: timestamp,
              id: 'project:operations',
              name: 'Operations',
              updatedAt: timestamp
            }
          ],
          requests: [],
          revision: 1,
          routines: [],
          todos: [],
          version: 2
        })}\n`
      )
      const store = new WorkMapStore(filePath)

      expect(
        store.ensureBotDirectories((threadId) =>
          threadId === 'thread:morning-email' ? 'Morning Email Check Assistant' : 'Operations'
        )
      ).toBe(true)
      expect(store.snapshot().projects).toMatchObject([
        { id: 'project:dental' },
        { botId: 'bot:operations', id: 'project:operations' }
      ])
      expect(store.snapshot().projects[0]).not.toHaveProperty('botId')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('migrates missing and removed Bot avatar variants into the approved family', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-work-map-bot-avatar-'))
    const filePath = path.join(root, 'work-map.json')
    const timestamp = '2026-08-26T12:00:00.000Z'
    const storedBot = (id: string, avatarVariant?: number) => ({
      ...(avatarVariant === undefined ? {} : { avatarVariant }),
      createdAt: timestamp,
      id: `bot:${id}`,
      projectId: null,
      threadId: `thread:${id}`,
      updatedAt: timestamp
    })
    try {
      await writeFile(
        filePath,
        `${JSON.stringify({
          bots: [storedBot('first'), storedBot('existing', 6), storedBot('second')],
          inbox: [],
          placements: [],
          projects: [],
          requests: [],
          revision: 3,
          routines: [],
          todos: [],
          version: 2
        })}\n`
      )

      const migrated = new WorkMapStore(filePath).snapshot()

      const variants = migrated.bots.map((bot) => bot.avatarVariant)
      expect(variants.every((variant) => variant >= 0 && variant < 6)).toBe(true)
      expect(new Set(variants).size).toBe(3)
      expect(JSON.parse(await readFile(filePath, 'utf8')).bots).toMatchObject(
        migrated.bots.map((bot) => ({
          avatarVariant: bot.avatarVariant,
          id: bot.id
        }))
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('marks a persisted running routine as interrupted after the authority restarts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-work-map-restart-'))
    const filePath = path.join(root, 'work-map.json')
    try {
      const store = new WorkMapStore(filePath)
      store.apply({
        actor: { kind: 'user' },
        expectedRevision: 0,
        operations: [
          {
            bot_id: 'bot:daily',
            op: 'create_bot',
            project_id: null,
            thread_id: 'thread:daily'
          },
          {
            bot_id: 'bot:daily',
            every_minutes: 1_440,
            next_run_at: '2026-08-26T12:00:00.000Z',
            op: 'create_routine',
            prompt: 'Review the latest work',
            routine_id: 'routine:daily'
          }
        ]
      })
      store.beginRoutineRun('routine:daily', {
        now: new Date('2026-08-26T12:00:00.000Z')
      })

      const restarted = new WorkMapStore(filePath)

      expect(restarted.snapshot()).toMatchObject({
        inbox: [
          {
            status: 'failed',
            summary: 'Run interrupted when the local authority stopped.'
          }
        ],
        routines: [{ nextRunAt: '2026-08-27T12:00:00.000Z' }]
      })
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
        inbox: [{ status: 'failed' }]
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('returns the same receipt for an idempotent retry', () => {
    const store = new WorkMapStore()
    const input = {
      actor: { kind: 'user' as const },
      expectedRevision: 0,
      operations: [
        {
          name: 'Imaging',
          op: 'create_project' as const,
          project_id: 'project:imaging'
        }
      ],
      requestId: 'request:create-imaging'
    }
    const first = store.apply(input)
    const retry = store.apply(input)

    expect(retry).toEqual(first)
    expect(store.snapshot()).toMatchObject({ revision: 1 })
    expect(store.snapshot().projects).toHaveLength(1)
  })

  test('keeps Bot identity separate from its optional routine and Inbox receipts', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:global',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:global'
        },
        {
          bot_id: 'bot:global',
          next_run_at: '2026-08-26T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review open work',
          routine_id: 'routine:review'
        }
      ]
    })

    expect(store.snapshot()).toMatchObject({
      bots: [{ id: 'bot:global', projectId: null, threadId: 'thread:global' }],
      inbox: [],
      routines: [
        {
          botId: 'bot:global',
          enabled: true,
          id: 'routine:review',
          prompt: 'Review open work'
        }
      ],
      version: 2
    })
    expect(store.dueRoutineIds(new Date('2026-08-26T12:00:00.000Z'))).toEqual(['routine:review'])

    const running = store.beginRoutineRun('routine:review', {
      now: new Date('2026-08-26T12:00:00.000Z')
    })
    expect(running).toMatchObject({
      projectId: null,
      routineId: 'routine:review',
      status: 'running',
      threadId: 'thread:global'
    })
    expect(store.snapshot().routines[0]).toMatchObject({ enabled: false })
    expect(store.snapshot().routines[0]?.nextRunAt).toBeUndefined()

    store.completeRoutineRun(
      running.id,
      'completed',
      'Three items need attention.',
      new Date('2026-08-26T12:05:00.000Z')
    )
    const receipt = store.apply({
      actor: { kind: 'user' },
      expectedRevision: 3,
      operations: [{ inbox_id: running.id, op: 'mark_inbox_read' }]
    })
    expect(receipt.revision).toBe(4)
    expect(store.snapshot().inbox[0]).toMatchObject({
      readAt: expect.any(String),
      status: 'completed',
      summary: 'Three items need attention.'
    })

    const archived = store.apply({
      actor: { kind: 'user' },
      expectedRevision: 4,
      operations: [{ inbox_id: running.id, op: 'archive_inbox' }]
    })
    expect(archived.revision).toBe(5)
    expect(store.snapshot().inbox[0]).toMatchObject({
      archivedAt: expect.any(String)
    })
    expect(store.snapshot().inbox).toHaveLength(1)
  })

  test('enables briefing objects on an existing routine without recreating its schedule', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:daily',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:daily'
        },
        {
          bot_id: 'bot:daily',
          every_minutes: 1_440,
          next_run_at: '2026-08-27T13:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review the morning inbox',
          routine_id: 'routine:daily'
        }
      ]
    })
    const before = store.snapshot().routines[0]

    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 1,
      operations: [
        {
          create_briefing_object: true,
          op: 'update_routine',
          routine_id: 'routine:daily'
        }
      ]
    })

    expect(store.snapshot().routines[0]).toEqual({
      ...before,
      briefingObject: true,
      updatedAt: expect.any(String)
    })
  })

  test('lets an agent make only its active chat a scheduled Bot', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { currentThreadId: 'thread:current', kind: 'agent' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:current',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:current'
        },
        {
          bot_id: 'bot:current',
          every_minutes: 1_440,
          next_run_at: '2026-08-27T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Run the daily review',
          routine_id: 'routine:daily'
        }
      ]
    })

    expect(store.snapshot()).toMatchObject({
      bots: [{ id: 'bot:current', threadId: 'thread:current' }],
      routines: [{ botId: 'bot:current', everyMinutes: 1_440, id: 'routine:daily' }]
    })
    expect(() =>
      store.apply({
        actor: { currentThreadId: 'thread:current', kind: 'agent' },
        expectedRevision: 1,
        operations: [
          {
            op: 'create_bot',
            project_id: null,
            thread_id: 'thread:someone-else'
          }
        ]
      })
    ).toThrow('only its active chat')
  })

  test('removes Bot schedules without deleting its chat or Inbox history', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:one',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:one'
        },
        {
          bot_id: 'bot:one',
          next_run_at: '2026-08-26T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Check status',
          routine_id: 'routine:one'
        }
      ]
    })
    const item = store.beginRoutineRun('routine:one', {
      now: new Date('2026-08-26T12:00:00.000Z')
    })
    store.completeRoutineRun(item.id, 'completed', 'Done')
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 3,
      operations: [{ bot_id: 'bot:one', op: 'delete_bot' }]
    })

    expect(store.snapshot().bots).toEqual([])
    expect(store.snapshot().routines).toEqual([])
    expect(store.snapshot().inbox).toHaveLength(1)
    expect(store.snapshot().inbox[0]?.threadId).toBe('thread:one')
  })
})
