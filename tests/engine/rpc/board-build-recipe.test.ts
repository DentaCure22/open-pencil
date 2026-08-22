import { describe, expect, test } from 'bun:test'

import {
  BOARD_BUILD_PLAN_CONTRACT,
  BOARD_BUILD_RECIPE_REGISTRY_VERSION,
  BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
  compileBoardBuildRecipeRequest,
  parseBoardBuildPlan
} from '@open-pencil/core/rpc'

function structuredCardsRequest() {
  return {
    contract: BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
    params: {
      cards: [
        { body: 'Confirm scope.', title: 'Discover' },
        { body: 'Create the smallest useful artifact.', title: 'Build' },
        { body: 'Check the durable result.', title: 'Verify' }
      ],
      direction: 'horizontal' as const,
      heading: 'Delivery loop'
    },
    recipe_id: 'structured_cards',
    recipe_version: 1
  }
}

function processFlowRequest() {
  return {
    contract: BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
    params: {
      heading: 'Delivery workflow',
      steps: [
        { body: 'Confirm the request.', title: 'Discover' },
        { body: 'Create the useful artifact.', title: 'Build' },
        { body: 'Check the durable result.', title: 'Verify' },
        { body: 'Share the outcome.', title: 'Release' }
      ]
    },
    recipe_id: 'process_flow',
    recipe_version: 1
  }
}

describe('Board build recipe compiler', () => {
  test('compiles structured_cards deterministically to one semantic composition', async () => {
    const first = await compileBoardBuildRecipeRequest(structuredCardsRequest())
    const second = await compileBoardBuildRecipeRequest(structuredClone(structuredCardsRequest()))

    expect(first).toEqual(second)
    expect(first.metadata).toEqual({
      artifact_aliases: ['heading', 'card_01', 'card_02', 'card_03'],
      expanded_plan_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      recipe_id: 'structured_cards',
      recipe_version: 1,
      registry_version: BOARD_BUILD_RECIPE_REGISTRY_VERSION
    })
    expect(first.plan).toEqual({
      artifacts: [
        {
          alias: 'heading',
          recipe: {
            kind: 'native_text',
            placement: { target: { kind: 'auto' } },
            text: 'Delivery loop'
          }
        },
        {
          alias: 'card_01',
          recipe: { body: 'Confirm scope.', kind: 'native_card', title: 'Discover' }
        },
        {
          alias: 'card_02',
          recipe: {
            body: 'Create the smallest useful artifact.',
            kind: 'native_card',
            title: 'Build'
          }
        },
        {
          alias: 'card_03',
          recipe: { body: 'Check the durable result.', kind: 'native_card', title: 'Verify' }
        }
      ],
      composition: {
        anchor: { alias: 'heading' },
        geography: 'preserve',
        members: [{ alias: 'card_01' }, { alias: 'card_02' }, { alias: 'card_03' }],
        placement: 'below',
        preferences: { density: 'balanced', direction: 'horizontal' }
      },
      contract: BOARD_BUILD_PLAN_CONTRACT
    })
    expect(parseBoardBuildPlan(first.plan)).toEqual(first.plan)
    expect(JSON.stringify(first.plan)).not.toMatch(/"(?:x|y)":/u)
  })

  test('changes the expanded-plan digest when normalized content changes', async () => {
    const first = await compileBoardBuildRecipeRequest(structuredCardsRequest())
    const changed = structuredCardsRequest()
    changed.params.cards[1] = { body: 'Build a different artifact.', title: 'Build' }
    const second = await compileBoardBuildRecipeRequest(changed)

    expect(second.metadata.expanded_plan_digest).not.toBe(first.metadata.expanded_plan_digest)
  })

  test('compiles process_flow to one semantic composition', async () => {
    const compilation = await compileBoardBuildRecipeRequest(processFlowRequest())

    expect(compilation.metadata).toEqual({
      artifact_aliases: ['heading', 'step_01', 'step_02', 'step_03', 'step_04'],
      expanded_plan_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      recipe_id: 'process_flow',
      recipe_version: 1,
      registry_version: BOARD_BUILD_RECIPE_REGISTRY_VERSION
    })
    expect(compilation.plan.artifacts.map(({ alias }) => alias)).toEqual([
      'heading',
      'step_01',
      'step_02',
      'step_03',
      'step_04'
    ])
    expect(compilation.plan.composition).toMatchObject({
      anchor: { alias: 'heading' },
      members: [
        { alias: 'step_01' },
        { alias: 'step_02' },
        { alias: 'step_03' },
        { alias: 'step_04' }
      ],
      preferences: { direction: 'horizontal' }
    })
    expect(parseBoardBuildPlan(compilation.plan)).toEqual(compilation.plan)
    expect(JSON.stringify(compilation.plan)).not.toMatch(/"(?:x|y)":/u)
  })

  test('rejects unsupported contracts, recipe IDs, and versions before compilation', async () => {
    await expect(
      compileBoardBuildRecipeRequest({
        ...structuredCardsRequest(),
        contract: 'board-build-recipe/v2'
      })
    ).rejects.toThrow(BOARD_BUILD_RECIPE_REQUEST_CONTRACT)
    await expect(
      compileBoardBuildRecipeRequest({ ...structuredCardsRequest(), recipe_id: 'dashboard' })
    ).rejects.toThrow('Unsupported Board build recipe dashboard@1')
    await expect(
      compileBoardBuildRecipeRequest({ ...structuredCardsRequest(), recipe_version: 2 })
    ).rejects.toThrow('Unsupported Board build recipe structured_cards@2')
  })

  test('rejects unknown fields and malformed or oversized params', async () => {
    await expect(
      compileBoardBuildRecipeRequest({ ...structuredCardsRequest(), authority: 'writer' })
    ).rejects.toThrow('unsupported fields: authority')
    await expect(
      compileBoardBuildRecipeRequest({
        ...structuredCardsRequest(),
        params: { ...structuredCardsRequest().params, spacing: 24 }
      })
    ).rejects.toThrow('unsupported fields: spacing')
    await expect(
      compileBoardBuildRecipeRequest({
        ...structuredCardsRequest(),
        params: { ...structuredCardsRequest().params, direction: 'diagonal' }
      })
    ).rejects.toThrow('direction must be horizontal or vertical')
    await expect(
      compileBoardBuildRecipeRequest({
        ...structuredCardsRequest(),
        params: { ...structuredCardsRequest().params, cards: [] }
      })
    ).rejects.toThrow('cards must contain 1 to 12 cards')
    await expect(
      compileBoardBuildRecipeRequest({
        ...structuredCardsRequest(),
        params: {
          ...structuredCardsRequest().params,
          cards: [{ body: 'x'.repeat(551), title: 'Too long' }]
        }
      })
    ).rejects.toThrow('body must contain at most 550 characters')
    await expect(
      compileBoardBuildRecipeRequest({
        ...structuredCardsRequest(),
        params: {
          ...structuredCardsRequest().params,
          cards: [{ body: 'Valid', subtitle: 'No extension', title: 'Card' }]
        }
      })
    ).rejects.toThrow('unsupported fields: subtitle')
    await expect(
      compileBoardBuildRecipeRequest({
        ...processFlowRequest(),
        params: {
          ...processFlowRequest().params,
          steps: processFlowRequest().params.steps.slice(0, 1)
        }
      })
    ).rejects.toThrow('steps must contain 2 to 8 steps')
    await expect(
      compileBoardBuildRecipeRequest({
        ...processFlowRequest(),
        params: { ...processFlowRequest().params, route: 'horizontal' }
      })
    ).rejects.toThrow('unsupported fields: route')
  })
})
