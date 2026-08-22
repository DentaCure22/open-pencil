import { describe, expect, test } from 'bun:test'

import {
  boardBuildTraceContext,
  materializeBoardBuildTrace,
  parseBoardBuildPlan
} from '@open-pencil/core/rpc'

function preparedTrace(selectedObjectId?: string) {
  return {
    board_build_base: {
      content_document_id: 'content:1',
      context_token: 'context:1',
      contract: 'board-build/v1',
      document_id: 'tab:1',
      expected_revision: 12,
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    },
    contract: 'board-edit-context/v1',
    gesture_id: 'gesture:1',
    resolution: {
      candidate_object_ids: ['frame:card', 'frame:peer'],
      ...(selectedObjectId ? { selected_object_id: selectedObjectId } : {}),
      status: selectedObjectId ? 'resolved' : 'none'
    },
    trace_region: { height: 80, width: 160, x: 70, y: 50 }
  }
}

describe('Trace-targeted Board build materialization', () => {
  test('replaces selected-object and region placeholders before plan validation', () => {
    const context = boardBuildTraceContext(preparedTrace('frame:header'))
    const materialized = materializeBoardBuildTrace(
      {
        artifacts: [
          {
            alias: 'note',
            recipe: {
              body: 'Placed in the marked area.',
              kind: 'native_card',
              placement: { target: { kind: 'trace_region' } },
              title: 'Trace note'
            }
          }
        ],
        contract: 'board-build-plan/v1',
        operations: [{ kind: 'object.update', object_id: '$trace', patch: { opacity: 0.8 } }]
      },
      context
    )

    expect(materialized).toMatchObject({ objectReferenceCount: 1, regionReferenceCount: 1 })
    expect(materialized.value).toMatchObject({
      artifacts: [
        {
          recipe: {
            placement: {
              target: { height: 80, kind: 'near_region', width: 160, x: 70, y: 50 }
            }
          }
        }
      ],
      operations: [{ object_id: 'frame:header' }]
    })
  })

  test('allows region-only placement and fails closed when an unresolved object is requested', () => {
    const context = boardBuildTraceContext(preparedTrace())
    expect(
      materializeBoardBuildTrace({ placement: { target: { kind: 'trace_region' } } }, context)
    ).toMatchObject({ regionReferenceCount: 1 })
    expect(() => materializeBoardBuildTrace({ object_id: '$trace' }, context)).toThrow(
      'did not resolve one selected object'
    )
  })

  test('materializes a Trace region into a valid grouped layout anchor', () => {
    const materialized = materializeBoardBuildTrace(
      {
        artifacts: ['one', 'two'].map((alias) => ({
          alias,
          recipe: { body: alias, kind: 'native_card', title: alias }
        })),
        contract: 'board-build-plan/v1',
        layout: {
          anchor: { kind: 'trace_region' },
          columns: 2,
          kind: 'grid',
          members: ['one', 'two']
        }
      },
      boardBuildTraceContext(preparedTrace())
    )

    expect(materialized.regionReferenceCount).toBe(1)
    expect(parseBoardBuildPlan(materialized.value).layout?.anchor).toEqual({
      height: 80,
      kind: 'near_region',
      width: 160,
      x: 70,
      y: 50
    })
  })
})
