import { createHash } from 'node:crypto'

import type { EvaluationConfiguration } from './evaluation-config'
import type { CampaignPromptParts } from './request-identity'
import {
  EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION,
  type EvalContextComponent,
  type EvalContextComponentKind,
  type EvalContextInventory
} from './schema'

export const CONTEXT_COMPONENTS_SCHEMA_VERSION = 'prompt-to-board-context-components/v2' as const

export interface ExactContextComponent {
  availability: 'exact'
  sha256_utf8: string
  utf8_bytes: number
}

export interface ProvenanceContextComponent {
  availability: 'provenance_only'
  provenance_ref: string
  version?: string
}

export interface UnavailableContextComponent {
  availability: 'unavailable'
}

export interface NotApplicableContextComponent {
  availability: 'not_applicable'
}

export interface ContextComponentInventory {
  core_skill: ProvenanceContextComponent | UnavailableContextComponent
  developer_instructions: UnavailableContextComponent
  exact_target_packet: ExactContextComponent | NotApplicableContextComponent
  execution_contract: ExactContextComponent | NotApplicableContextComponent
  full_dispatched_prompt: ExactContextComponent
  optional_modules: ProvenanceContextComponent | UnavailableContextComponent
  project_rules: ProvenanceContextComponent | UnavailableContextComponent
  provided_recipe: NotApplicableContextComponent | ProvenanceContextComponent
  scenario_user_prompt: ExactContextComponent
  schema_version: typeof CONTEXT_COMPONENTS_SCHEMA_VERSION
  system_prompt: UnavailableContextComponent
  tool_schemas: ProvenanceContextComponent | UnavailableContextComponent
  warm_session_history: ProvenanceContextComponent | NotApplicableContextComponent
}

const NO_EXACT_CONTEXT_TOKENS =
  'Codex JSONL does not attribute input tokens to individual context components.'

function exact(text: string): ExactContextComponent {
  return {
    availability: 'exact',
    sha256_utf8: createHash('sha256').update(text, 'utf8').digest('hex'),
    utf8_bytes: Buffer.byteLength(text, 'utf8')
  }
}

const unavailable = (): UnavailableContextComponent => ({ availability: 'unavailable' })
const notApplicable = (): NotApplicableContextComponent => ({ availability: 'not_applicable' })

export function contextComponentInventory(options: {
  configuration: EvaluationConfiguration
  parts: CampaignPromptParts
  warmSessionId: string | null
}): ContextComponentInventory {
  const { configuration, parts, warmSessionId } = options
  return {
    core_skill: {
      availability: 'provenance_only',
      provenance_ref: configuration.prompt_tooling.skill_bundle_hash
    },
    developer_instructions: unavailable(),
    exact_target_packet: parts.exact_target_packet
      ? exact(parts.exact_target_packet)
      : notApplicable(),
    execution_contract: parts.execution_contract
      ? exact(parts.execution_contract)
      : notApplicable(),
    full_dispatched_prompt: exact(parts.full_prompt),
    optional_modules: unavailable(),
    project_rules: configuration.context.ignore_rules
      ? unavailable()
      : {
          availability: 'provenance_only',
          provenance_ref: configuration.context.rules_hash
        },
    provided_recipe: configuration.assistance.provided_recipe_sha256
      ? {
          availability: 'provenance_only',
          provenance_ref: configuration.assistance.provided_recipe_sha256
        }
      : notApplicable(),
    scenario_user_prompt: exact(parts.scenario_user_prompt),
    schema_version: CONTEXT_COMPONENTS_SCHEMA_VERSION,
    system_prompt: unavailable(),
    tool_schemas: {
      availability: 'provenance_only',
      provenance_ref: configuration.prompt_tooling.tool_build_hash,
      version: configuration.prompt_tooling.tool_contract_version
    },
    warm_session_history: warmSessionId
      ? { availability: 'provenance_only', provenance_ref: warmSessionId }
      : notApplicable()
  }
}

function evalComponent(
  kind: EvalContextComponentKind,
  source: string,
  component:
    | ExactContextComponent
    | NotApplicableContextComponent
    | ProvenanceContextComponent
    | UnavailableContextComponent
): EvalContextComponent {
  if (component.availability === 'exact') {
    return {
      availability: 'observed',
      availability_reason: null,
      bytes: component.utf8_bytes,
      kind,
      provenance_hash: null,
      sha256: component.sha256_utf8,
      source,
      token_count: null,
      token_count_availability_reason: NO_EXACT_CONTEXT_TOKENS
    }
  }
  if (component.availability === 'provenance_only') {
    return {
      availability: 'provenance_only',
      availability_reason: 'The frozen run records provenance but not the exact injected bytes.',
      bytes: null,
      kind,
      provenance_hash: component.provenance_ref,
      sha256: null,
      source,
      token_count: null,
      token_count_availability_reason: NO_EXACT_CONTEXT_TOKENS
    }
  }
  return {
    availability: 'unavailable',
    availability_reason:
      component.availability === 'not_applicable'
        ? 'This context component is not applicable to the run.'
        : 'The evaluator cannot observe this context component.',
    bytes: null,
    kind,
    provenance_hash: null,
    sha256: null,
    source,
    token_count: null,
    token_count_availability_reason: NO_EXACT_CONTEXT_TOKENS
  }
}

export function asEvalContextInventory(inventory: ContextComponentInventory): EvalContextInventory {
  return {
    components: [
      evalComponent('full_dispatched_prompt', 'campaign.prompt', inventory.full_dispatched_prompt),
      evalComponent('user_prompt', 'scenario.prompt', inventory.scenario_user_prompt),
      evalComponent('exact_target_packet', 'campaign.target', inventory.exact_target_packet),
      evalComponent('execution_contract', 'campaign.contract', inventory.execution_contract),
      evalComponent('system_instructions', 'codex_protocol', inventory.system_prompt),
      evalComponent('developer_instructions', 'codex_protocol', inventory.developer_instructions),
      evalComponent('project_instructions', 'evaluation.context', inventory.project_rules),
      evalComponent(
        'provided_recipe',
        'evaluation.assistance.provided_recipe_sha256',
        inventory.provided_recipe
      ),
      evalComponent('skill_bundle', 'evaluation.prompt_tooling', inventory.core_skill),
      evalComponent('optional_modules', 'codex_protocol', inventory.optional_modules),
      evalComponent('tool_schemas', 'evaluation.prompt_tooling', inventory.tool_schemas),
      evalComponent(
        'warm_session_history',
        'campaign.warm_session',
        inventory.warm_session_history
      ),
      evalComponent('board_context', 'codex_protocol', unavailable()),
      evalComponent('tool_output', 'codex_protocol', unavailable())
    ],
    schema_version: EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION
  }
}
