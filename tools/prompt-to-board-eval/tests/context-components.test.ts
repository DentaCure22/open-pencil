import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { asEvalContextInventory, contextComponentInventory } from '../src/context-components'
import { createEvaluationConfiguration } from '../src/evaluation-config'
import { campaignPromptParts } from '../src/request-identity'
import { configuration, scenario, target } from '../src/testing/campaign-support'

function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('campaign context component inventory', () => {
  test('hashes exact Unicode prompt segments without storing their bodies', () => {
    const exactTarget = target('page-🦷')
    const candidate = { ...scenario('UNICODE', 'fresh'), prompt: 'Build a café 🦷 card' }
    const parts = campaignPromptParts(candidate, exactTarget, {
      board_request_id: 'ptb-run:0123456789abcdef0123456789abcdef',
      recovery_of_run_id: null,
      request_scope_run_id: 'unicode-run'
    })
    const inventory = contextComponentInventory({
      configuration: configuration('fresh', exactTarget),
      parts,
      warmSessionId: null
    })

    expect(inventory.scenario_user_prompt).toEqual({
      availability: 'exact',
      sha256_utf8: sha256Utf8(candidate.prompt),
      utf8_bytes: Buffer.byteLength(candidate.prompt, 'utf8')
    })
    expect(inventory.full_dispatched_prompt.sha256_utf8).toBe(sha256Utf8(parts.full_prompt))
    expect(inventory.full_dispatched_prompt.utf8_bytes).toBe(
      Buffer.byteLength(parts.full_prompt, 'utf8')
    )
    expect(JSON.stringify(inventory)).not.toContain(candidate.prompt)
    expect(inventory.system_prompt.availability).toBe('unavailable')
    expect(inventory.developer_instructions.availability).toBe('unavailable')
    expect(inventory.project_rules.availability).toBe('provenance_only')
    expect(inventory.core_skill.availability).toBe('provenance_only')
    expect(inventory.tool_schemas.availability).toBe('provenance_only')
    expect(inventory.optional_modules.availability).toBe('unavailable')
    expect(inventory.provided_recipe.availability).toBe('not_applicable')
    expect(inventory.warm_session_history.availability).toBe('not_applicable')

    const recorderInventory = asEvalContextInventory(inventory)
    const byKind = new Map(
      recorderInventory.components.map((component) => [component.kind, component])
    )
    expect(byKind.get('user_prompt')).toMatchObject({
      availability: 'observed',
      bytes: Buffer.byteLength(candidate.prompt, 'utf8'),
      sha256: sha256Utf8(candidate.prompt)
    })
    expect(byKind.get('exact_target_packet')?.availability).toBe('observed')
    expect(byKind.get('execution_contract')?.availability).toBe('observed')
    expect(byKind.get('system_instructions')?.availability).toBe('unavailable')
    expect(byKind.get('warm_session_history')?.availability).toBe('unavailable')
  })

  test('binds a provided recipe fingerprint into context provenance', () => {
    const exactTarget = target('page-recipe')
    const base = configuration('fresh', exactTarget)
    const { config_id: _configId, schema_version: _schemaVersion, ...input } = base
    const recipeHash = 'b'.repeat(64)
    const configured = createEvaluationConfiguration({
      ...structuredClone(input),
      assistance: {
        ...input.assistance,
        provided_recipe_sha256: recipeHash,
        recipe: 'provided'
      }
    })
    const inventory = contextComponentInventory({
      configuration: configured,
      parts: campaignPromptParts(scenario('RECIPE', 'fresh'), exactTarget, null),
      warmSessionId: null
    })

    expect(inventory.provided_recipe).toEqual({
      availability: 'provenance_only',
      provenance_ref: recipeHash
    })
    expect(
      asEvalContextInventory(inventory).components.find(
        (component) => component.kind === 'provided_recipe'
      )
    ).toMatchObject({
      availability: 'provenance_only',
      provenance_hash: recipeHash
    })
  })

  test('marks target and contract absent when the campaign does not pre-scope them', () => {
    const exactTarget = target('page-A')
    const parts = campaignPromptParts(scenario('NO-TARGET', 'fresh'), null, null)
    const inventory = contextComponentInventory({
      configuration: configuration('fresh', exactTarget),
      parts,
      warmSessionId: 'warm-session-1'
    })

    expect(inventory.exact_target_packet.availability).toBe('not_applicable')
    expect(inventory.execution_contract.availability).toBe('not_applicable')
    expect(inventory.warm_session_history).toEqual({
      availability: 'provenance_only',
      provenance_ref: 'warm-session-1'
    })
  })
})
