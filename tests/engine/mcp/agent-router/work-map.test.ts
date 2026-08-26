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
          { name: 'Treatment plan', op: 'create_project', project_id: 'project:treatment' },
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
          { id: 'project:editor', name: 'Plan editor', parentId: 'project:treatment' }
        ],
        revision: 1
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('manual chat placement wins over agent organization', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        { name: 'Patient data', op: 'create_project', project_id: 'project:patient' },
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

  test('lets an agent finish linked work after moving it through In motion', () => {
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        { name: 'Treatment plan', op: 'create_project', project_id: 'project:treatment' }
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

    store.apply({
      actor: { currentThreadId: 'thread:current', kind: 'agent' },
      expectedRevision: 2,
      operations: [{ op: 'update_todo', status: 'finished', todo_id: 'todo:validate' }]
    })
    expect(store.snapshot().todos[0]).toMatchObject({
      status: 'finished',
      threadId: 'thread:current'
    })
  })

  test('migrates legacy Needs you and Review todos back to In motion', async () => {
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
            }
          ],
          version: 1
        })}\n`
      )

      expect(new WorkMapStore(filePath).snapshot().todos).toMatchObject([
        { id: 'todo:input', status: 'in_motion' },
        { id: 'todo:verify', status: 'in_motion' }
      ])
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
        revision: 4,
        todos: [
          { id: 'todo:input', status: 'in_motion' },
          { id: 'todo:verify', status: 'in_motion' }
        ]
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
        { name: 'Imaging', op: 'create_project' as const, project_id: 'project:imaging' }
      ],
      requestId: 'request:create-imaging'
    }
    const first = store.apply(input)
    const retry = store.apply(input)

    expect(retry).toEqual(first)
    expect(store.snapshot()).toMatchObject({ revision: 1 })
    expect(store.snapshot().projects).toHaveLength(1)
  })
})
