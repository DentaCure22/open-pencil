import type { BoardBuildPlan } from '#core/rpc/board-build-plan'
import {
  BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
  compileBoardBuildRecipeRequest,
  type BoardBuildRecipeCompilerMetadata
} from '#core/rpc/board-build-recipe'

export const BOARD_BUILD_INTENT_REQUEST_CONTRACT = 'board-build-intent-request/v1' as const
export const BOARD_BUILD_INTENT_COMPILATION_CONTRACT = 'board-build-intent-compilation/v1' as const
export const BOARD_BUILD_INTENT_REGISTRY_VERSION = 1 as const

export type BoardBuildIntentOutcome = 'compare' | 'explain' | 'process'
export type BoardBuildIntentRequestedOutcome = 'auto' | BoardBuildIntentOutcome
export type BoardBuildIntentRepresentation = 'comparison' | 'process_flow' | 'structured_brief'
export type BoardBuildIntentCapability =
  | 'comparison_design'
  | 'document_synthesis'
  | 'process_modeling'
export type BoardBuildIntentEffect = 'compute'
export type BoardBuildIntentRoutingSource = 'default' | 'explicit' | 'intent_keyword'

export type BoardBuildIntentItem = {
  body: string
  title: string
}

export type BoardBuildIntentRequest = {
  contract: typeof BOARD_BUILD_INTENT_REQUEST_CONTRACT
  heading: string
  intent: string
  items: BoardBuildIntentItem[]
  outcome?: BoardBuildIntentRequestedOutcome
}

export type BoardBuildIntentCapabilityRequest = {
  capability_id: BoardBuildIntentCapability
  effect: BoardBuildIntentEffect
}

export type BoardBuildIntentCapabilityResult = BoardBuildIntentCapabilityRequest & {
  authority: 'none'
  output_contract: typeof BOARD_BUILD_RECIPE_REQUEST_CONTRACT
  provider_id: string
  provider_version: number
}

export type BoardBuildIntentRepresentationPlan = {
  capability_requests: BoardBuildIntentCapabilityRequest[]
  dominant_representation: BoardBuildIntentRepresentation
  intent: string
  outcome: BoardBuildIntentOutcome
  routing_source: BoardBuildIntentRoutingSource
  supporting_representations: BoardBuildIntentRepresentation[]
}

export type BoardBuildIntentCompilerMetadata = {
  capability_results: BoardBuildIntentCapabilityResult[]
  contract: typeof BOARD_BUILD_INTENT_COMPILATION_CONTRACT
  recipe_compilation: BoardBuildRecipeCompilerMetadata
  registry_version: typeof BOARD_BUILD_INTENT_REGISTRY_VERSION
  representation_plan: BoardBuildIntentRepresentationPlan
}

export type BoardBuildIntentCompilation = {
  metadata: BoardBuildIntentCompilerMetadata
  plan: BoardBuildPlan
}

type JsonRecord = Record<string, unknown>
type IntentRoute = {
  capability: BoardBuildIntentCapability
  direction?: 'horizontal' | 'vertical'
  providerId: string
  providerVersion: number
  recipeId: 'process_flow' | 'structured_cards'
  representation: BoardBuildIntentRepresentation
}

const INTENT_MAX_LENGTH = 1_000
const PROCESS_KEYWORDS =
  /\b(?:flow|flowchart|lifecycle|pipeline|process|sequence|steps?|workflow)\b/iu
const COMPARISON_KEYWORDS =
  /\b(?:compare|comparison|differences?|pros and cons|trade-?offs?|versus|vs\.?)\b|side[- ]by[- ]side/iu

const ROUTES: Record<BoardBuildIntentOutcome, IntentRoute> = {
  compare: {
    capability: 'comparison_design',
    direction: 'horizontal',
    providerId: 'builtin.board-recipe.structured-cards',
    providerVersion: 1,
    recipeId: 'structured_cards',
    representation: 'comparison'
  },
  explain: {
    capability: 'document_synthesis',
    direction: 'vertical',
    providerId: 'builtin.board-recipe.structured-cards',
    providerVersion: 1,
    recipeId: 'structured_cards',
    representation: 'structured_brief'
  },
  process: {
    capability: 'process_modeling',
    providerId: 'builtin.board-recipe.process-flow',
    providerVersion: 1,
    recipeId: 'process_flow',
    representation: 'process_flow'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`)
  const result = value.trim()
  if (result.length === 0) throw new Error(`${label} is required.`)
  if (result.length <= maximum) return result
  throw new Error(`${label} must contain at most ${maximum} characters.`)
}

function parseRequestedOutcome(value: unknown): BoardBuildIntentRequestedOutcome {
  if (value === undefined) return 'auto'
  if (value === 'auto' || value === 'compare' || value === 'explain' || value === 'process') {
    return value
  }
  throw new Error('Board build intent outcome must be auto, compare, explain, or process.')
}

function resolveOutcome(
  intent: string,
  requested: BoardBuildIntentRequestedOutcome
): { outcome: BoardBuildIntentOutcome; source: BoardBuildIntentRoutingSource } {
  if (requested !== 'auto') return { outcome: requested, source: 'explicit' }
  const process = PROCESS_KEYWORDS.test(intent)
  const compare = COMPARISON_KEYWORDS.test(intent)
  if (process && compare) {
    throw new Error(
      'Board build intent matches both process and comparison; set outcome explicitly.'
    )
  }
  if (process) return { outcome: 'process', source: 'intent_keyword' }
  if (compare) return { outcome: 'compare', source: 'intent_keyword' }
  return { outcome: 'explain', source: 'default' }
}

function parseIntentRequest(value: unknown): {
  heading: string
  intent: string
  items: unknown
  requestedOutcome: BoardBuildIntentRequestedOutcome
} {
  if (!isRecord(value)) throw new Error('Board build intent request must be an object.')
  const allowed = new Set(['contract', 'heading', 'intent', 'items', 'outcome'])
  const unsupported = Object.keys(value)
    .filter((field) => !allowed.has(field))
    .sort()
  if (unsupported.length > 0) {
    throw new Error(
      `Board build intent request contains unsupported fields: ${unsupported.join(', ')}.`
    )
  }
  if (value.contract !== BOARD_BUILD_INTENT_REQUEST_CONTRACT) {
    throw new Error(
      `Board build intent request contract must be ${BOARD_BUILD_INTENT_REQUEST_CONTRACT}.`
    )
  }
  return {
    heading: requiredString(value.heading, 'Board build intent heading', 240),
    intent: requiredString(value.intent, 'Board build intent intent', INTENT_MAX_LENGTH),
    items: value.items,
    requestedOutcome: parseRequestedOutcome(value.outcome)
  }
}

export async function compileBoardBuildIntentRequest(
  value: unknown
): Promise<BoardBuildIntentCompilation> {
  const request = parseIntentRequest(value)
  const routing = resolveOutcome(request.intent, request.requestedOutcome)
  const route = ROUTES[routing.outcome]
  const recipe = await compileBoardBuildRecipeRequest({
    contract: BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
    params:
      route.recipeId === 'process_flow'
        ? { heading: request.heading, steps: request.items }
        : {
            cards: request.items,
            ...(route.direction ? { direction: route.direction } : {}),
            heading: request.heading
          },
    recipe_id: route.recipeId,
    recipe_version: 1
  })
  const capabilityRequest: BoardBuildIntentCapabilityRequest = {
    capability_id: route.capability,
    effect: 'compute'
  }
  return {
    metadata: {
      capability_results: [
        {
          ...capabilityRequest,
          authority: 'none',
          output_contract: BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
          provider_id: route.providerId,
          provider_version: route.providerVersion
        }
      ],
      contract: BOARD_BUILD_INTENT_COMPILATION_CONTRACT,
      recipe_compilation: recipe.metadata,
      registry_version: BOARD_BUILD_INTENT_REGISTRY_VERSION,
      representation_plan: {
        capability_requests: [capabilityRequest],
        dominant_representation: route.representation,
        intent: request.intent,
        outcome: routing.outcome,
        routing_source: routing.source,
        supporting_representations: []
      }
    },
    plan: recipe.plan
  }
}
