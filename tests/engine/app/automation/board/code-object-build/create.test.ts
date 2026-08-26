import { describe, expect, test } from 'bun:test'

import { parseBoardBuildInput } from '@/app/automation/bridge/board-build/parse'

import {
  ANCHOR_ID,
  args,
  BOARD_REVISION,
  createHarness,
  OBJECT_KEY,
  OWNER_ID,
  recipe,
  recordStoredReceipt,
  REQUEST_ID,
  semanticReadback,
  SOURCE,
  target
} from './helpers'

describe('board_build Code Object create recipe', () => {
  test('parses only a create-only TSX recipe with bounded plain JSON input', () => {
    expect(parseBoardBuildInput(args())).toMatchObject({
      anchorId: ANCHOR_ID,
      recipe: {
        initialState: { count: 0 },
        kind: 'code_object',
        objectKey: OBJECT_KEY,
        operation: 'create',
        props: { accent: 'violet' },
        source: SOURCE,
        sourceFormat: 'tsx'
      }
    })

    for (const unsupported of [
      { owner: 'node:existing' },
      { permissions: ['write'] },
      { persist: true },
      { update: true },
      { x: 20 },
      { y: 40 },
      { connections: [] }
    ]) {
      expect(() => parseBoardBuildInput(args(recipe(unsupported)))).toThrow('unsupported fields')
    }
    expect(() => parseBoardBuildInput(args(recipe({ operation: 'update' })))).toThrow(
      'operation must be create'
    )
    expect(() => parseBoardBuildInput(args(recipe({ source_format: 'javascript' })))).toThrow(
      'source_format must be tsx'
    )
    expect(() => parseBoardBuildInput(args(recipe({ props: { bad: undefined } })))).toThrow(
      'plain JSON object'
    )
    expect(() => parseBoardBuildInput(args(recipe({ initial_state: new Date() })))).toThrow(
      'plain JSON object'
    )
    expect(() => parseBoardBuildInput(args(recipe({ width: 239 })))).toThrow(
      'width must be between 240 and 1600'
    )
    expect(() => parseBoardBuildInput(args(recipe({ height: 1_201 })))).toThrow(
      'height must be between 160 and 1200'
    )
    expect(() => parseBoardBuildInput({ ...args(), anchor_id: undefined })).toThrow(
      'exactly one of anchor_id or placement.target'
    )
    const freePlacement = parseBoardBuildInput({
      ...args(recipe({ placement: { target: { kind: 'auto' } } })),
      anchor_id: undefined
    })
    expect(freePlacement).toMatchObject({
      recipe: { placement: { target: { kind: 'auto' } } }
    })
    expect(freePlacement).not.toHaveProperty('anchorId')

    const sourcePrefix = 'export default function Maximum() { return <main /> } // '
    const maximumSource = sourcePrefix.padEnd(100_000, 'x')
    expect(parseBoardBuildInput(args(recipe({ source: maximumSource }))).recipe).toMatchObject({
      source: maximumSource
    })
    expect(() => parseBoardBuildInput(args(recipe({ source: maximumSource.concat('x') })))).toThrow(
      'at most 100000 characters'
    )
  })

  test('delegates once with normalized placement, then reads, presents, and persists', async () => {
    const { calls, handler } = createHarness()
    const result = await handler(target(), args())

    expect(calls.creates).toEqual([
      {
        anchor_id: ANCHOR_ID,
        height: 520,
        mutation: {
          expected_revision: BOARD_REVISION,
          request_id: REQUEST_ID,
          task_id: 'task:code-object-build',
          trace_id: 'trace:code-object-build'
        },
        name: 'Idea dashboard',
        object_key: OBJECT_KEY,
        persist: false,
        placement: {
          clearance: 48,
          preferred_directions: ['right', 'below', 'left', 'above']
        },
        props: { accent: 'violet' },
        source: SOURCE,
        state: { count: 0 },
        width: 720,
        zoom: false
      }
    ])
    expect(calls.reads).toEqual([
      { context_token: 'context:code-object-build', scope: 'selection' },
      { object_key: OBJECT_KEY }
    ])
    expect(calls.contexts).toBe(1)
    expect(calls.presentations).toEqual([
      { context_token: 'context:code-object-present', object_ids: [OWNER_ID] }
    ])
    expect(calls.persistence).toHaveLength(1)
    expect(result).toMatchObject({
      build: {
        extension: {
          authority: 'none',
          profile_id: 'calm-technical',
          skill_id: 'optional-design-taste',
          used: true
        },
        recipe_kind: 'code_object',
        route: { id: 'code-object/tsx-create/v1', semantic_owner: 'upsert_code_object' }
      },
      owner_id: OWNER_ID,
      persistence: { status: 'durable', target: 'local_workspace_authority' },
      readback: { code_object: { frame: { id: OWNER_ID, type: 'FRAME' } } },
      status: { command: 'completed', mutation: 'applied' },
      timing: {
        contract: 'automation-stage-timing/v1',
        stages: {
          context_read_ms: expect.any(Number),
          operation_ms: expect.any(Number),
          persistence_ms: 1
        },
        total_ms: expect.any(Number)
      }
    })
    expect(result).not.toHaveProperty('readback.code_object.component.source')
    expect(result).not.toHaveProperty('readback.code_object.component.props')
    expect(result).not.toHaveProperty('readback.code_object.component.state')
  })

  test('delegates an unanchored create with explicit collision-free placement', async () => {
    const { calls, handler } = createHarness()
    const input = {
      ...args(recipe({ placement: { target: { kind: 'auto' } } })),
      anchor_id: undefined
    }
    await handler(target(), input)

    expect(calls.creates).toEqual([
      expect.objectContaining({
        placement: {
          clearance: 48,
          preferred_directions: ['right', 'below', 'left', 'above'],
          target: { kind: 'auto' }
        }
      })
    ])
    expect(calls.creates[0]).not.toHaveProperty('anchor_id')
  })

  test('delegates relative object placement without requiring UI selection', async () => {
    const { calls, handler } = createHarness()
    const input = {
      ...args(
        recipe({
          placement: {
            preferred_directions: ['right', 'left', 'below', 'above'],
            target: { kind: 'relative', object_id: 'node:release-readiness' }
          }
        })
      ),
      anchor_id: undefined
    }
    await handler(target(), input)

    expect(calls.creates).toEqual([
      expect.objectContaining({
        placement: {
          clearance: 48,
          preferred_directions: ['right', 'left', 'below', 'above'],
          target: { kind: 'relative', objectId: 'node:release-readiness' }
        }
      })
    ])
    expect(calls.creates[0]).not.toHaveProperty('anchor_id')
  })

  test('reports unknown durability without losing the applied receipt', async () => {
    const { calls, handler } = createHarness({
      persistence: {
        duration_ms: 2_500,
        reason: 'persistence_timeout',
        requested_scene_revision: BOARD_REVISION + 1,
        status: 'unknown'
      }
    })
    const result = await handler(target(), args())

    expect(calls.creates).toHaveLength(1)
    expect(calls.persistence).toHaveLength(1)
    expect(result).toMatchObject({
      persistence: { reason: 'persistence_timeout', status: 'unknown' },
      receipt: { requestId: REQUEST_ID, status: 'applied' },
      status: {
        command: 'unavailable',
        mutation: 'applied',
        reason: 'persistence_not_acknowledged'
      }
    })
  })

  test('recovers a stored same request despite stale context without a duplicate', async () => {
    const exactTarget = target()
    recordStoredReceipt(exactTarget, 'upsert_code_object', 'sha256:stored-code-object-build', [
      `${exactTarget.pageId}:*`
    ])
    const { calls, handler } = createHarness({
      boardRead: {
        board_revision: BOARD_REVISION + 9,
        nodes: [{ id: OWNER_ID }],
        scope: 'selection'
      },
      createResult: {
        owner_id: OWNER_ID,
        receipt: { idempotentReplay: true, requestId: REQUEST_ID, status: 'applied' },
        semantic_owner: 'upsert_code_object',
        status: { attention_required: false, command: 'completed', mutation: 'replayed' }
      }
    })

    const result = await handler(exactTarget, args())

    expect(calls.creates).toHaveLength(1)
    expect(calls.persistence).toHaveLength(1)
    expect(result).toMatchObject({
      owner_id: OWNER_ID,
      receipt: { idempotentReplay: true, requestId: REQUEST_ID },
      status: { command: 'completed', mutation: 'replayed' }
    })
  })

  test('keeps readback and presentation failures explicit while preserving durability', async () => {
    const scenarios = [
      {
        options: {
          semanticRead: {
            ...semanticReadback(),
            component: { ...semanticReadback().component, source: 'export default null' }
          }
        },
        reason: 'code_object_readback_mismatch',
        stage: 'readback'
      },
      {
        options: { presentation: { presentation: { acknowledged: false } } },
        reason: 'presentation_not_acknowledged',
        stage: 'presentation'
      }
    ]

    for (const scenario of scenarios) {
      const { calls, handler } = createHarness(scenario.options)
      const result = await handler(target(), args())
      expect(calls.creates).toHaveLength(1)
      expect(calls.persistence).toHaveLength(1)
      expect(result).toMatchObject({
        owner_id: OWNER_ID,
        persistence: { status: 'durable' },
        proof: { reason: scenario.reason, stage: scenario.stage, status: 'partial' },
        receipt: { requestId: REQUEST_ID },
        status: { command: 'unavailable', mutation: 'applied', reason: scenario.reason }
      })
    }
  })

  test('rejects stale revision or a changed anchor before semantic delegation', async () => {
    const scenarios = [
      {
        boardRead: {
          board_revision: BOARD_REVISION + 1,
          nodes: [{ id: ANCHOR_ID }],
          scope: 'selection'
        },
        message: 'revision is stale'
      },
      {
        boardRead: {
          board_revision: BOARD_REVISION,
          nodes: [{ id: 'node:different-anchor' }],
          scope: 'selection'
        },
        message: 'singleton Board selection'
      }
    ]

    for (const scenario of scenarios) {
      const { calls, handler } = createHarness({ boardRead: scenario.boardRead })
      expect(handler(target(), args())).rejects.toThrow(scenario.message)
      expect(calls.creates).toHaveLength(0)
      expect(calls.persistence).toHaveLength(0)
    }
  })
})
