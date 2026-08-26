import {
  BOARD_BUILD_PLAN_CONTRACT,
  parseBoardBuildPlan,
  type BoardBuildPlan
} from '#core/rpc/board-build-plan'

export const BOARD_BUILD_RECIPE_REQUEST_CONTRACT = 'board-build-recipe-request/v1' as const
export const BOARD_BUILD_RECIPE_REGISTRY_VERSION = 1 as const

export type BriefGridRecipeCard = {
  body: string
  title: string
}

export type StructuredCardsRecipeParams = {
  cards: BriefGridRecipeCard[]
  direction?: 'horizontal' | 'vertical'
  heading: string
}

export type StructuredCardsRecipeRequest = {
  contract: typeof BOARD_BUILD_RECIPE_REQUEST_CONTRACT
  params: StructuredCardsRecipeParams
  recipe_id: 'structured_cards'
  recipe_version: 1
}

export type ProcessFlowRecipeStep = BriefGridRecipeCard

export type ProcessFlowRecipeParams = {
  heading: string
  steps: ProcessFlowRecipeStep[]
}

export type ProcessFlowRecipeRequest = {
  contract: typeof BOARD_BUILD_RECIPE_REQUEST_CONTRACT
  params: ProcessFlowRecipeParams
  recipe_id: 'process_flow'
  recipe_version: 1
}

export type BoardBuildRecipeRequest = ProcessFlowRecipeRequest | StructuredCardsRecipeRequest

export type BoardBuildRecipeCompilerMetadata = {
  artifact_aliases: string[]
  expanded_plan_digest: `sha256:${string}`
  recipe_id: BoardBuildRecipeRequest['recipe_id']
  recipe_version: BoardBuildRecipeRequest['recipe_version']
  registry_version: typeof BOARD_BUILD_RECIPE_REGISTRY_VERSION
}

export type BoardBuildRecipeCompilation = {
  metadata: BoardBuildRecipeCompilerMetadata
  plan: BoardBuildPlan
}

type JsonRecord = Record<string, unknown>
type RecipeCompiler = {
  compile: (params: unknown) => {
    artifactAliases: string[]
    plan: BoardBuildPlan
  }
  recipeId: BoardBuildRecipeRequest['recipe_id']
  recipeVersion: BoardBuildRecipeRequest['recipe_version']
}
type RecipeCompilerResult = {
  artifactAliases: string[]
  plan: BoardBuildPlan
}

const BRIEF_GRID_MAX_BODY_LENGTH = 550
const BRIEF_GRID_MAX_CARD_COUNT = 12
const BRIEF_GRID_MAX_HEADING_LENGTH = 240
const BRIEF_GRID_MAX_TITLE_LENGTH = 120
const PROCESS_FLOW_MAX_STEP_COUNT = 8
const PROCESS_FLOW_MIN_STEP_COUNT = 2
const RECIPE_KEY_SEPARATOR = '@'

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function assertExactFields(value: JsonRecord, fields: readonly string[], label: string): void {
  const allowed = new Set(fields)
  const unsupported = Object.keys(value).filter((field) => !allowed.has(field))
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.sort().join(', ')}.`)
  }
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  const normalized = value.trim()
  if (normalized.length > maximum) {
    throw new Error(`${label} must contain at most ${maximum} characters.`)
  }
  return normalized
}

function parseTitledBodyItems(
  value: unknown,
  label: string,
  noun: string,
  minimum: number,
  maximum: number
): BriefGridRecipeCard[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain ${minimum} to ${maximum} ${noun}.`)
  }
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`${label}[${index}] must be an object.`)
    assertExactFields(item, ['body', 'title'], `${label}[${index}]`)
    return {
      body: boundedString(item.body, `${label}[${index}].body`, BRIEF_GRID_MAX_BODY_LENGTH),
      title: boundedString(item.title, `${label}[${index}].title`, BRIEF_GRID_MAX_TITLE_LENGTH)
    }
  })
}

function parseStructuredCardsParams(value: unknown): StructuredCardsRecipeParams {
  if (!isRecord(value)) throw new Error('structured_cards params must be an object.')
  assertExactFields(value, ['cards', 'direction', 'heading'], 'structured_cards params')
  const direction = value.direction
  if (direction !== undefined && direction !== 'horizontal' && direction !== 'vertical') {
    throw new Error('structured_cards params.direction must be horizontal or vertical.')
  }
  return {
    cards: parseTitledBodyItems(
      value.cards,
      'structured_cards params.cards',
      'cards',
      1,
      BRIEF_GRID_MAX_CARD_COUNT
    ),
    ...(direction ? { direction } : {}),
    heading: boundedString(
      value.heading,
      'structured_cards params.heading',
      BRIEF_GRID_MAX_HEADING_LENGTH
    )
  }
}

function cardAlias(index: number): string {
  return `card_${String(index + 1).padStart(2, '0')}`
}

function stepAlias(index: number): string {
  return `step_${String(index + 1).padStart(2, '0')}`
}

function composition(
  members: string[],
  direction: 'horizontal' | 'vertical' | undefined
): BoardBuildPlan['composition'] {
  return {
    anchor: { alias: 'heading' },
    geography: 'preserve',
    members: members.map((alias) => ({ alias })),
    placement: 'below',
    ...(direction ? { preferences: { direction } } : {})
  }
}

function compileStructuredCards(value: unknown): RecipeCompilerResult {
  const params = parseStructuredCardsParams(value)
  const cardAliases = params.cards.map((_, index) => cardAlias(index))
  const useComposition = cardAliases.length > 1
  const plan = parseBoardBuildPlan({
    artifacts: [
      {
        alias: 'heading',
        recipe: {
          kind: 'native_text',
          placement: { target: { kind: 'auto' } },
          text: params.heading
        }
      },
      ...params.cards.map((card, index) => ({
        alias: cardAliases[index],
        ...(useComposition ? {} : { anchor: { alias: 'heading' } }),
        recipe: { body: card.body, kind: 'native_card', title: card.title }
      }))
    ],
    ...(useComposition ? { composition: composition(cardAliases, params.direction) } : {}),
    contract: BOARD_BUILD_PLAN_CONTRACT
  })
  return { artifactAliases: ['heading', ...cardAliases], plan }
}

function parseProcessFlowParams(value: unknown): ProcessFlowRecipeParams {
  if (!isRecord(value)) throw new Error('process_flow params must be an object.')
  assertExactFields(value, ['heading', 'steps'], 'process_flow params')
  return {
    heading: boundedString(
      value.heading,
      'process_flow params.heading',
      BRIEF_GRID_MAX_HEADING_LENGTH
    ),
    steps: parseTitledBodyItems(
      value.steps,
      'process_flow params.steps',
      'steps',
      PROCESS_FLOW_MIN_STEP_COUNT,
      PROCESS_FLOW_MAX_STEP_COUNT
    )
  }
}

function compileProcessFlow(value: unknown): RecipeCompilerResult {
  const params = parseProcessFlowParams(value)
  const stepAliases = params.steps.map((_, index) => stepAlias(index))
  const plan = parseBoardBuildPlan({
    artifacts: [
      {
        alias: 'heading',
        recipe: {
          kind: 'native_text',
          placement: { target: { kind: 'auto' } },
          text: params.heading
        }
      },
      ...params.steps.map((step, index) => ({
        alias: stepAliases[index],
        recipe: { body: step.body, kind: 'native_card', title: step.title }
      }))
    ],
    composition: composition(stepAliases, 'horizontal'),
    contract: BOARD_BUILD_PLAN_CONTRACT
  })
  return { artifactAliases: ['heading', ...stepAliases], plan }
}

function recipeKey(recipeId: string, recipeVersion: number): string {
  return `${recipeId}${RECIPE_KEY_SEPARATOR}${recipeVersion}`
}

const RECIPE_REGISTRY = new Map<string, RecipeCompiler>([
  [
    recipeKey('structured_cards', 1),
    { compile: compileStructuredCards, recipeId: 'structured_cards', recipeVersion: 1 }
  ],
  [
    recipeKey('process_flow', 1),
    { compile: compileProcessFlow, recipeId: 'process_flow', recipeVersion: 1 }
  ]
])

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)])
  )
}

async function expandedPlanDigest(plan: BoardBuildPlan): Promise<`sha256:${string}`> {
  const serialized = JSON.stringify(canonicalValue(plan))
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized)
  )
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex}`
}

export async function compileBoardBuildRecipeRequest(
  value: unknown
): Promise<BoardBuildRecipeCompilation> {
  if (!isRecord(value)) throw new Error('Board build recipe request must be an object.')
  assertExactFields(
    value,
    ['contract', 'params', 'recipe_id', 'recipe_version'],
    'Board build recipe request'
  )
  if (value.contract !== BOARD_BUILD_RECIPE_REQUEST_CONTRACT) {
    throw new Error(
      `Board build recipe request contract must be ${BOARD_BUILD_RECIPE_REQUEST_CONTRACT}.`
    )
  }
  if (typeof value.recipe_id !== 'string' || !value.recipe_id.trim()) {
    throw new Error('Board build recipe request recipe_id is required.')
  }
  if (!Number.isInteger(value.recipe_version) || (value.recipe_version as number) < 1) {
    throw new Error('Board build recipe request recipe_version must be a positive integer.')
  }
  const recipeId = value.recipe_id.trim()
  const recipeVersion = value.recipe_version as number
  const recipe = RECIPE_REGISTRY.get(recipeKey(recipeId, recipeVersion))
  if (!recipe) {
    throw new Error(`Unsupported Board build recipe ${recipeId}@${recipeVersion}.`)
  }
  const { artifactAliases, plan } = recipe.compile(value.params)
  return {
    metadata: {
      artifact_aliases: artifactAliases,
      expanded_plan_digest: await expandedPlanDigest(plan),
      recipe_id: recipe.recipeId,
      recipe_version: recipe.recipeVersion,
      registry_version: BOARD_BUILD_RECIPE_REGISTRY_VERSION
    },
    plan
  }
}
