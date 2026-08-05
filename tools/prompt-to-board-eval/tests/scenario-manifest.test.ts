import { describe, expect, test } from 'bun:test'

import {
  parseScenarioManifest,
  scenarioFingerprint,
  validateScenarioManifest
} from '../src/scenario-manifest'

function scenario(
  scenarioId: string,
  split: 'adversarial' | 'dev' | 'held_out' | 'probe' | 'validation',
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const protectedSplit = split === 'held_out' || split === 'adversarial' || split === 'probe'
  return {
    expected_outcome: 'artifact_success',
    lineage: {
      family_id: `family-${scenarioId}`,
      optimization_exposure: protectedSplit ? 'forbidden' : 'allowed',
      origin: 'human',
      parent_scenario_ids: [],
      source_record_ids: [`source-${scenarioId}`],
      transform: null
    },
    modalities: ['native_card'],
    prompt: `Build useful artifact ${scenarioId}`,
    rubric: { rubric_id: 'scenario-test-rubric', version: '1' },
    scenario_id: scenarioId,
    session_mode: 'fresh',
    split,
    target_policy: {
      fixture_ref: `fixture-${scenarioId}`,
      kind: 'exact_fixture',
      target_substitution: 'forbidden'
    },
    visibility: 'required',
    ...overrides
  }
}

function manifest(scenarios: Record<string, unknown>[]): Record<string, unknown> {
  return {
    manifest_id: 'prompt-to-board-core-v1',
    revision: 1,
    scenarios,
    schema_version: 'prompt-to-board-scenario-manifest/v1'
  }
}

describe('scenario manifest', () => {
  test('accepts every split, modality, target policy, session mode, and visibility policy', () => {
    const parsed = parseScenarioManifest(
      manifest([
        scenario('DEV-1', 'dev', { modalities: ['native_text'], session_mode: 'warm' }),
        scenario('VAL-1', 'validation', {
          modalities: ['native_diagram'],
          target_policy: {
            kind: 'current_visible',
            target_substitution: 'forbidden',
            writer_requirement: 'exactly_one'
          }
        }),
        scenario('HOLD-1', 'held_out', {
          modalities: ['code_object', 'object_connection'],
          visibility: 'optional'
        }),
        scenario('ADV-1', 'adversarial', {
          expected_outcome: 'safe_stop',
          modalities: ['none'],
          target_policy: {
            failure_class: 'wrong_target',
            kind: 'invalid_target',
            target_substitution: 'forbidden'
          },
          visibility: 'forbidden'
        }),
        scenario('PROBE-1', 'probe', {
          modalities: ['native_card'],
          target_policy: {
            editor_required: false,
            fixture_ref: 'saved-workspace-fixture',
            kind: 'persisted_authority',
            target_substitution: 'forbidden'
          }
        })
      ])
    )

    expect(parsed.scenarios.map(({ split }) => split)).toEqual([
      'dev',
      'validation',
      'held_out',
      'adversarial',
      'probe'
    ])
    expect(parsed.scenarios[2]?.modalities).toEqual(['code_object', 'object_connection'])
    expect(validateScenarioManifest(parsed)).toMatchObject({ errors: [], valid: true })
  })

  test('rejects cross-split family, source-record, prompt, and parent leakage', () => {
    const crossFamily = scenario('HOLD-1', 'held_out')
    Reflect.set(Reflect.get(crossFamily, 'lineage'), 'family_id', 'shared-family')
    const devFamily = scenario('DEV-1', 'dev')
    Reflect.set(Reflect.get(devFamily, 'lineage'), 'family_id', 'shared-family')
    expect(() => parseScenarioManifest(manifest([devFamily, crossFamily]))).toThrow('crosses')

    const crossSource = scenario('HOLD-2', 'held_out')
    Reflect.set(Reflect.get(crossSource, 'lineage'), 'source_record_ids', ['shared-source'])
    const devSource = scenario('DEV-2', 'dev')
    Reflect.set(Reflect.get(devSource, 'lineage'), 'source_record_ids', ['shared-source'])
    expect(() => parseScenarioManifest(manifest([devSource, crossSource]))).toThrow('Source record')

    expect(() =>
      parseScenarioManifest(
        manifest([
          scenario('DEV-3', 'dev', { prompt: '  Build   the CARD ' }),
          scenario('HOLD-3', 'held_out', { prompt: 'build the card' })
        ])
      )
    ).toThrow('Normalized prompt leakage')

    const derived = scenario('HOLD-4B', 'held_out', {
      lineage: {
        family_id: 'hold-family',
        optimization_exposure: 'forbidden',
        origin: 'derived',
        parent_scenario_ids: ['DEV-4A'],
        source_record_ids: ['hold-source'],
        transform: { name: 'paraphrase', version: '1' }
      }
    })
    expect(() => parseScenarioManifest(manifest([scenario('DEV-4A', 'dev'), derived]))).toThrow(
      'share its split and family'
    )
  })

  test('keeps protected split contents out of optimization', () => {
    const exposed = scenario('HOLD-1', 'held_out')
    Reflect.set(Reflect.get(exposed, 'lineage'), 'optimization_exposure', 'allowed')
    expect(() => parseScenarioManifest(manifest([exposed]))).toThrow(
      'optimization_exposure must be forbidden'
    )

    const hiddenDevelopment = scenario('DEV-1', 'dev')
    Reflect.set(Reflect.get(hiddenDevelopment, 'lineage'), 'optimization_exposure', 'forbidden')
    expect(() => parseScenarioManifest(manifest([hiddenDevelopment]))).toThrow(
      'optimization_exposure must be allowed'
    )
  })

  test('enforces safe-stop, target-substitution, and derivation invariants', () => {
    expect(() =>
      parseScenarioManifest(
        manifest([scenario('ADV-1', 'adversarial', { expected_outcome: 'safe_stop' })])
      )
    ).toThrow('safe_stop requires forbidden visibility')

    expect(() =>
      parseScenarioManifest(
        manifest([
          scenario('DEV-1', 'dev', {
            target_policy: {
              fixture_ref: 'fixture',
              kind: 'exact_fixture',
              target_substitution: 'allowed'
            }
          })
        ])
      )
    ).toThrow('target_substitution must be forbidden')

    expect(() =>
      parseScenarioManifest(
        manifest([
          scenario('DEV-2', 'dev', {
            lineage: {
              family_id: 'derived-family',
              optimization_exposure: 'allowed',
              origin: 'derived',
              parent_scenario_ids: [],
              source_record_ids: ['derived-source'],
              transform: null
            }
          })
        ])
      )
    ).toThrow('derived origin requires a parent and transform')
  })

  test('fingerprints semantic scenario identity with stable key order and prompt spacing', () => {
    const parsed = parseScenarioManifest(manifest([scenario('DEV-1', 'dev')])).scenarios[0]
    expect(parsed).toBeDefined()
    if (!parsed) return

    const equivalent = {
      ...parsed,
      prompt: '  BUILD useful   artifact DEV-1  ',
      target_policy: {
        target_substitution: 'forbidden' as const,
        kind: 'exact_fixture' as const,
        fixture_ref: 'fixture-DEV-1'
      }
    }
    expect(scenarioFingerprint(equivalent)).toBe(scenarioFingerprint(parsed))
  })
})
