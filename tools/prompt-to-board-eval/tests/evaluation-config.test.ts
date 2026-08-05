import { describe, expect, test } from 'bun:test'

import {
  createEvaluationConfiguration,
  evaluationConfigIdentity,
  measurementSession,
  parseEvaluationConfiguration,
  type EvaluationConfigurationInput
} from '../src/evaluation-config'

function input(
  overrides: Partial<EvaluationConfigurationInput> = {}
): EvaluationConfigurationInput {
  return {
    agent: { model: 'gpt-test', reasoning_effort: 'medium', service_tier: 'priority' },
    assistance: {
      context: 'pre_scoped',
      modality: 'agent_selected',
      placement: 'pre_resolved',
      prompt: 'natural',
      provided_recipe_sha256: null,
      recipe: 'none',
      target: 'provided_exact'
    },
    board: {
      content_document_id: 'content-1',
      density: 'sparse',
      document_id: 'document-1',
      fixture_hash: 'fixture-hash',
      page_id: 'page-1',
      reset_policy: 'restore-fixture-v1',
      revision: 10,
      runtime_instance_id: 'runtime-1',
      workspace_id: 'workspace-1'
    },
    browser: {
      engine: 'chromium',
      profile_state: 'fresh',
      required: true,
      version: '123',
      viewport: { height: 900, width: 1200 }
    },
    context: {
      cwd_mode: 'isolated-eval',
      ignore_rules: false,
      ignore_user_config: true,
      rules_hash: 'rules-hash',
      user_config_hash: 'ignored-config-hash'
    },
    evaluator: { grader_version: 'pixel-grader/v1', version: 'evaluator/v3' },
    measurement_class: 'assisted_cold',
    prompt_tooling: {
      prompt_template_hash: 'prompt-hash',
      skill_bundle_hash: 'skill-hash',
      tool_build_hash: 'tool-build-hash',
      tool_contract_version: 'board-tools/v3'
    },
    retry: { agent_turn_limit: 8, board_retry_policy: 'same-request-id', max_retries: 1 },
    source: {
      commit: 'abc123',
      dirty: true,
      dirty_diff_hash: 'diff-hash',
      dirty_files: ['z.ts', 'a.ts']
    },
    ...overrides
  }
}

describe('immutable evaluation configuration', () => {
  test('content-addresses every frozen run input and normalizes dirty file order', () => {
    const first = createEvaluationConfiguration(input())
    const second = createEvaluationConfiguration(
      input({ source: { ...input().source, dirty_files: ['a.ts', 'z.ts'] } })
    )
    expect(first.config_id).toBe(second.config_id)
    expect(first.config_id).toMatch(/^[a-f0-9]{64}$/)
    expect(first.source.dirty_files).toEqual(['a.ts', 'z.ts'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.source.dirty_files)).toBe(true)
    expect(evaluationConfigIdentity(first)).toEqual({
      config_id: first.config_id,
      measurement_class: 'assisted_cold'
    })
  })

  test('hashes every configuration category that makes runs incomparable', () => {
    const baseline = input()
    const variants: EvaluationConfigurationInput[] = [
      { ...baseline, agent: { ...baseline.agent, model: 'different-model' } },
      {
        ...baseline,
        assistance: { ...baseline.assistance, modality: 'preselected' }
      },
      { ...baseline, board: { ...baseline.board, runtime_instance_id: 'runtime-2' } },
      { ...baseline, browser: { ...baseline.browser, version: '124' } },
      { ...baseline, context: { ...baseline.context, rules_hash: 'different-rules' } },
      {
        ...baseline,
        evaluator: { ...baseline.evaluator, grader_version: 'pixel-grader/v2' }
      },
      {
        ...baseline,
        prompt_tooling: { ...baseline.prompt_tooling, skill_bundle_hash: 'different-skill' }
      },
      { ...baseline, retry: { ...baseline.retry, max_retries: 2 } },
      {
        ...baseline,
        source: { ...baseline.source, dirty_diff_hash: 'different-diff' }
      }
    ]
    const ids = [baseline, ...variants].map(
      (candidate) => createEvaluationConfiguration(candidate).config_id
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('rejects a tampered snapshot and contradictory assistance labels', () => {
    const config = createEvaluationConfiguration(input())
    expect(() =>
      parseEvaluationConfiguration({ ...config, evaluator: { ...config.evaluator, version: 'v4' } })
    ).toThrow('does not match')
    expect(() =>
      createEvaluationConfiguration(
        input({
          assistance: {
            context: 'pre_scoped',
            modality: 'agent_selected',
            placement: 'agent_selected',
            prompt: 'natural',
            provided_recipe_sha256: null,
            recipe: 'none',
            target: 'agent_discovered'
          },
          measurement_class: 'open_ended_cold'
        })
      )
    ).toThrow('open-ended')
  })

  test('keeps cold and warm as explicit measurement dimensions', () => {
    expect(measurementSession('rpc_cold')).toBe('cold')
    expect(measurementSession('assisted_warm')).toBe('warm')
    expect(measurementSession('open_ended_warm')).toBe('warm')
  })

  test('requires an exact frozen fingerprint for every provided recipe treatment', () => {
    const recipeHash = 'a'.repeat(64)
    const provided = createEvaluationConfiguration(
      input({
        assistance: {
          ...input().assistance,
          provided_recipe_sha256: recipeHash,
          recipe: 'provided'
        }
      })
    )
    expect(provided.assistance.provided_recipe_sha256).toBe(recipeHash)
    expect(() =>
      createEvaluationConfiguration(
        input({ assistance: { ...input().assistance, recipe: 'provided' } })
      )
    ).toThrow('provided_recipe_sha256')
    expect(() =>
      createEvaluationConfiguration(
        input({
          assistance: { ...input().assistance, provided_recipe_sha256: recipeHash }
        })
      )
    ).toThrow('must set provided_recipe_sha256 to null')
  })
})
