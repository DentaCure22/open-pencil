import { describe, expect, test } from 'bun:test'

import {
  BOARD_BUILD_PLAN_CONTRACT,
  compileBoardBuildPlanGridLayout,
  parseBoardBuildPlan
} from '@open-pencil/core/rpc/board-build-plan'
import {
  BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
  compileBoardBuildRecipeRequest
} from '@open-pencil/core/rpc/board-build-recipe'

function nativeCard(alias: string) {
  return {
    alias,
    recipe: {
      body: `${alias} body`,
      kind: 'native_card',
      placement: { target: { kind: 'auto' } },
      title: `${alias} title`
    }
  }
}

describe('Board build plan boundary', () => {
  test('accepts the version alias and returns the canonical contract', () => {
    expect(
      parseBoardBuildPlan({
        artifacts: [nativeCard('summary')],
        version: BOARD_BUILD_PLAN_CONTRACT
      })
    ).toEqual({
      artifacts: [nativeCard('summary')],
      contract: BOARD_BUILD_PLAN_CONTRACT
    })
  })

  test('rejects duplicate artifact aliases', () => {
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [nativeCard('summary'), nativeCard('summary')],
        contract: BOARD_BUILD_PLAN_CONTRACT
      })
    ).toThrow('plan alias "summary" is duplicated')
  })

  test('rejects effects that target an object after deleting it', () => {
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT,
        operations: [
          { kind: 'object.delete', object_id: 'object:1' },
          { kind: 'object.update', object_id: 'object:1', patch: { name: 'Too late' } }
        ]
      })
    ).toThrow('targets an object after deleting it')
  })

  test('keeps transaction rollback isolated from every other effect', () => {
    expect(() =>
      parseBoardBuildPlan({
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT,
        operations: [
          { kind: 'transaction.revert', transaction_id: 'transaction:1' },
          { kind: 'object.delete', object_id: 'object:1' }
        ]
      })
    ).toThrow('transaction.revert must be the only effect')
  })

  test('keeps recipe expansion behind the plan boundary', async () => {
    const result = await compileBoardBuildRecipeRequest({
      contract: BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
      params: {
        cards: [
          { body: 'First body', title: 'First' },
          { body: 'Second body', title: 'Second' }
        ],
        direction: 'horizontal',
        heading: 'Comparison'
      },
      recipe_id: 'structured_cards',
      recipe_version: 1
    })

    expect(result.metadata.artifact_aliases).toEqual(['heading', 'card_01', 'card_02'])
    expect(result.metadata.expanded_plan_digest).toStartWith('sha256:')
    expect(result.plan.composition?.preferences?.direction).toBe('horizontal')
  })

  test('compiles grid geometry independently from plan parsing', () => {
    expect(
      compileBoardBuildPlanGridLayout(
        {
          align: 'center',
          anchor: { height: 1, kind: 'region', width: 1, x: 0, y: 0 },
          column_gap: 10,
          columns: 2,
          kind: 'grid',
          members: ['first', 'second'],
          row_gap: 10
        },
        {
          first: { height: 50, width: 100 },
          second: { height: 100, width: 50 }
        }
      )
    ).toEqual({
      aliases: {
        first: { height: 50, width: 100, x: 0, y: 25 },
        second: { height: 100, width: 50, x: 110, y: 0 }
      },
      footprint: { height: 100, width: 160 }
    })
  })
})
