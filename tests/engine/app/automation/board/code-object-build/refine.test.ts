import { describe, expect, test } from 'bun:test'

import { parseBoardBuildInput } from '@/app/automation/bridge/board-build/parse'

import {
  ANCHOR_ID,
  BOARD_REVISION,
  createHarness,
  OBJECT_KEY,
  OWNER_ID,
  recordStoredReceipt,
  refineBuildArgs,
  refineRecipe,
  REQUEST_ID,
  semanticReadback,
  SOURCE,
  SOURCE_HASH,
  target
} from './helpers'

describe('board_build Code Object refine recipe', () => {
  test('parses guarded refinement without an anchor and rejects missing source identity', () => {
    expect(parseBoardBuildInput(refineBuildArgs())).toMatchObject({
      recipe: {
        expectedSourceHash: SOURCE_HASH,
        kind: 'code_object',
        objectKey: OBJECT_KEY,
        operation: 'refine',
        ownerId: OWNER_ID
      }
    })
    expect(() =>
      parseBoardBuildInput(refineBuildArgs(refineRecipe({ expected_source_hash: undefined })))
    ).toThrow('expected_source_hash')
    expect(() =>
      parseBoardBuildInput(
        refineBuildArgs(refineRecipe({ expected_source_hash: `sha256:${'Z'.repeat(64)}` }))
      )
    ).toThrow('lowercase SHA-256')
    expect(() => parseBoardBuildInput({ ...refineBuildArgs(), anchor_id: ANCHOR_ID })).toThrow(
      'uses recipe.owner_id'
    )
  })

  test('delegates exact refinement, then reads, presents, and persists', async () => {
    const refinedSource = `${SOURCE}\n// refined`
    const { calls, handler } = createHarness({
      boardRead: { board_revision: BOARD_REVISION, nodes: [{ id: OWNER_ID }], scope: 'selection' },
      semanticRead: {
        component: {
          definition_id: OBJECT_KEY,
          name: 'Idea dashboard v2',
          props: { accent: 'cyan' },
          source: refinedSource,
          state: { count: 9 }
        },
        frame: { ...semanticReadback().frame, name: 'Idea dashboard v2' }
      }
    })
    const result = await handler(target(), refineBuildArgs())

    expect(calls.creates).toHaveLength(0)
    expect(calls.refines).toEqual([
      {
        expected_source_hash: SOURCE_HASH,
        mutation: {
          expected_revision: BOARD_REVISION,
          request_id: REQUEST_ID,
          task_id: 'task:code-object-build',
          trace_id: 'trace:code-object-build'
        },
        name: 'Idea dashboard v2',
        object_key: OBJECT_KEY,
        owner_id: OWNER_ID,
        persist: false,
        props: { accent: 'cyan' },
        source: refinedSource,
        zoom: false
      }
    ])
    expect(calls.persistence).toHaveLength(1)
    expect(calls.presentations).toHaveLength(1)
    expect(calls.reads).toEqual([
      { context_token: 'context:code-object-build', scope: 'selection' },
      { owner_id: OWNER_ID }
    ])
    expect(result).toMatchObject({
      build: { route: { id: 'code-object/tsx-refine/v1', semantic_owner: 'refine_code_object' } },
      owner_id: OWNER_ID,
      readback: {
        code_object: {
          component: {
            definition_id: OBJECT_KEY,
            name: 'Idea dashboard v2',
            source_length: refinedSource.length
          }
        }
      },
      status: { command: 'completed', mutation: 'applied' }
    })
    expect(result).not.toHaveProperty('readback.code_object.component.source')
    expect(result).not.toHaveProperty('readback.code_object.component.props')
    expect(result).not.toHaveProperty('readback.code_object.component.state')
  })

  test('refines an exact owner without requiring it to remain selected', async () => {
    const refinedSource = `${SOURCE}\n// refined`
    const { calls, handler } = createHarness({
      boardRead: {
        board_revision: BOARD_REVISION,
        nodes: [{ id: 'node:other-selection' }],
        scope: 'selection'
      },
      semanticRead: {
        component: {
          definition_id: OBJECT_KEY,
          name: 'Idea dashboard v2',
          props: { accent: 'cyan' },
          source: refinedSource,
          state: { count: 9 }
        },
        frame: { ...semanticReadback().frame, name: 'Idea dashboard v2' }
      }
    })

    await expect(handler(target(), refineBuildArgs())).resolves.toMatchObject({
      owner_id: OWNER_ID,
      status: { command: 'completed', mutation: 'applied' }
    })
    expect(calls.refines).toHaveLength(1)
  })

  test('proves refinement by exact owner even when legacy key lookup is ambiguous', async () => {
    const refinedSource = `${SOURCE}\n// refined`
    const { calls, handler } = createHarness({
      boardRead: { board_revision: BOARD_REVISION, nodes: [{ id: OWNER_ID }], scope: 'selection' },
      semanticRead: {
        component: {
          definition_id: OBJECT_KEY,
          name: 'Idea dashboard v2',
          props: { accent: 'cyan' },
          source: refinedSource,
          state: { count: 9 }
        },
        frame: { ...semanticReadback().frame, name: 'Idea dashboard v2' }
      },
      semanticReadRejectsKeyLookup: true
    })

    const result = await handler(target(), refineBuildArgs())

    expect(calls.reads.at(-1)).toEqual({ owner_id: OWNER_ID })
    expect(result).toMatchObject({
      owner_id: OWNER_ID,
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
  })

  test('persists a durable refinement no-change receipt without extra proof calls', async () => {
    const { calls, handler } = createHarness({
      boardRead: { board_revision: BOARD_REVISION, nodes: [{ id: OWNER_ID }], scope: 'selection' },
      refineResult: {
        owner_id: OWNER_ID,
        receipt: {
          appliedRevision: BOARD_REVISION,
          idempotent_replay: false,
          no_history: true,
          outcome: 'no_change'
        },
        status: { attention_required: false, command: 'completed', mutation: 'no_change' }
      }
    })

    const result = await handler(target(), refineBuildArgs())

    expect(calls.refines).toHaveLength(1)
    expect(calls.presentations).toHaveLength(0)
    expect(calls.persistence).toHaveLength(1)
    expect(calls.contexts).toBe(1)
    expect(result).toMatchObject({
      connect_objects_base: {
        context_token: 'context:code-object-present',
        expected_revision: BOARD_REVISION
      },
      persistence: { status: 'durable' },
      receipt: { no_history: true, outcome: 'no_change' },
      status: { command: 'completed', mutation: 'no_change' }
    })
  })

  test('keeps the canonical owner ID on a replayed refinement', async () => {
    const exactTarget = target()
    const refinedSource = `${SOURCE}\n// refined`
    recordStoredReceipt(exactTarget, 'refine_code_object', 'sha256:stored-code-object-refinement', [
      `${OWNER_ID}:code_object`
    ])
    const { handler } = createHarness({
      boardRead: {
        board_revision: BOARD_REVISION + 9,
        nodes: [{ id: 'node:selection-changed-after-refine' }],
        scope: 'selection'
      },
      refineResult: {
        owner_id: OWNER_ID,
        preservation: {
          board_permissions: true,
          geometry: true,
          legacy_connections: true,
          object_graph_connections: true,
          other_plugin_data: true,
          state: true
        },
        readback: { code_object: { reconciliation: { reasons: [], status: 'current' } } },
        receipt: { idempotentReplay: true, requestId: REQUEST_ID, status: 'applied' },
        semantic_owner: { owner_id: OWNER_ID, root_object_id: OWNER_ID },
        status: { attention_required: false, command: 'completed', mutation: 'replayed' }
      },
      semanticRead: {
        component: {
          definition_id: OBJECT_KEY,
          name: 'Idea dashboard v2',
          props: { accent: 'cyan' },
          source: refinedSource,
          state: { count: 9 }
        },
        frame: { ...semanticReadback().frame, name: 'Idea dashboard v2' }
      }
    })

    await expect(handler(exactTarget, refineBuildArgs())).resolves.toMatchObject({
      owner_id: OWNER_ID,
      receipt: { idempotentReplay: true, requestId: REQUEST_ID },
      status: { command: 'completed', mutation: 'replayed' }
    })
  })
})
