import { describe, expect, test } from 'bun:test'

import {
  BOARD_BUILD_INTENT_COMPILATION_CONTRACT,
  BOARD_BUILD_INTENT_REGISTRY_VERSION,
  BOARD_BUILD_INTENT_REQUEST_CONTRACT,
  compileBoardBuildIntentRequest,
  parseBoardBuildPlan
} from '@open-pencil/core/rpc'

function intentRequest(intent: string) {
  return {
    contract: BOARD_BUILD_INTENT_REQUEST_CONTRACT,
    heading: 'Delivery loop',
    intent,
    items: [
      { body: 'Confirm the request.', title: 'Discover' },
      { body: 'Create the useful artifact.', title: 'Build' },
      { body: 'Check the durable result.', title: 'Verify' }
    ]
  }
}

describe('Board build intent compiler', () => {
  test('routes a process intent through one authority-free capability into one plan', async () => {
    const compilation = await compileBoardBuildIntentRequest(
      intentRequest('Show this workflow as a process with connected steps')
    )

    expect(compilation.metadata).toMatchObject({
      capability_results: [
        {
          authority: 'none',
          capability_id: 'process_modeling',
          effect: 'compute',
          output_contract: 'board-build-recipe-request/v1',
          provider_id: 'builtin.board-recipe.process-flow',
          provider_version: 1
        }
      ],
      contract: BOARD_BUILD_INTENT_COMPILATION_CONTRACT,
      recipe_compilation: {
        artifact_aliases: ['heading', 'step_01', 'step_02', 'step_03'],
        expanded_plan_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        recipe_id: 'process_flow',
        recipe_version: 1
      },
      registry_version: BOARD_BUILD_INTENT_REGISTRY_VERSION,
      representation_plan: {
        capability_requests: [{ capability_id: 'process_modeling', effect: 'compute' }],
        dominant_representation: 'process_flow',
        outcome: 'process',
        routing_source: 'intent_keyword',
        supporting_representations: []
      }
    })
    expect(parseBoardBuildPlan(compilation.plan)).toEqual(compilation.plan)
  })

  test('chooses comparison or structured brief without provider-specific input', async () => {
    const comparison = await compileBoardBuildIntentRequest(
      intentRequest('Compare these options side by side')
    )
    const brief = await compileBoardBuildIntentRequest(
      intentRequest('Explain these findings clearly')
    )

    expect(comparison.metadata.representation_plan).toMatchObject({
      dominant_representation: 'comparison',
      outcome: 'compare',
      routing_source: 'intent_keyword'
    })
    expect(comparison.plan.composition).toMatchObject({
      preferences: { direction: 'horizontal' }
    })
    expect(brief.metadata.representation_plan).toMatchObject({
      dominant_representation: 'structured_brief',
      outcome: 'explain',
      routing_source: 'default'
    })
    expect(brief.plan.composition).toMatchObject({
      preferences: { direction: 'vertical' }
    })
  })

  test('compiles deterministically from the same frozen intent input', async () => {
    const request = intentRequest('Map this workflow')
    const first = await compileBoardBuildIntentRequest(request)
    const second = await compileBoardBuildIntentRequest(structuredClone(request))

    expect(second).toEqual(first)
  })

  test('requires one explicit outcome when intent signals materially different routes', async () => {
    const ambiguous = intentRequest('Compare the workflow options')
    await expect(compileBoardBuildIntentRequest(ambiguous)).rejects.toThrow(
      'matches both process and comparison'
    )

    const explicit = await compileBoardBuildIntentRequest({ ...ambiguous, outcome: 'process' })
    expect(explicit.metadata.representation_plan).toMatchObject({
      outcome: 'process',
      routing_source: 'explicit'
    })
  })

  test('rejects authority fields before mutation', async () => {
    await expect(
      compileBoardBuildIntentRequest({ ...intentRequest('Explain this'), authority: 'writer' })
    ).rejects.toThrow('unsupported fields: authority')
  })
})
