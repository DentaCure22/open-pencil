import { createHash } from 'node:crypto'

export const SCENARIO_MANIFEST_VERSION = 'prompt-to-board-scenario-manifest/v1' as const

export const SCENARIO_SPLITS = ['dev', 'validation', 'held_out', 'adversarial', 'probe'] as const

export const SCENARIO_MODALITIES = [
  'native_text',
  'native_card',
  'native_diagram',
  'code_object',
  'object_connection',
  'none'
] as const

export const EXPECTED_OUTCOMES = ['artifact_success', 'safe_stop'] as const
export const SESSION_MODES = ['fresh', 'warm'] as const
export const VISIBILITY_REQUIREMENTS = ['required', 'optional', 'forbidden'] as const
export const TARGET_POLICIES = [
  'exact_fixture',
  'current_visible',
  'persisted_authority',
  'invalid_target'
] as const

export const LINEAGE_ORIGINS = ['human', 'system', 'synthetic', 'derived'] as const
export const OPTIMIZATION_EXPOSURES = ['allowed', 'forbidden'] as const

export type ScenarioSplit = (typeof SCENARIO_SPLITS)[number]
export type ScenarioModality = (typeof SCENARIO_MODALITIES)[number]
export type ExpectedOutcome = (typeof EXPECTED_OUTCOMES)[number]
export type SessionMode = (typeof SESSION_MODES)[number]
export type VisibilityRequirement = (typeof VISIBILITY_REQUIREMENTS)[number]
export type LineageOrigin = (typeof LINEAGE_ORIGINS)[number]
export type OptimizationExposure = (typeof OPTIMIZATION_EXPOSURES)[number]

export type ExactTargetPolicy =
  | {
      fixture_ref: string
      kind: 'exact_fixture'
      target_substitution: 'forbidden'
    }
  | {
      kind: 'current_visible'
      target_substitution: 'forbidden'
      writer_requirement: 'exactly_one'
    }
  | {
      editor_required: false
      fixture_ref: string
      kind: 'persisted_authority'
      target_substitution: 'forbidden'
    }
  | {
      failure_class: 'ambiguous_runtime' | 'missing_identity' | 'stale_context' | 'wrong_target'
      kind: 'invalid_target'
      target_substitution: 'forbidden'
    }

export interface ScenarioLineageTransform {
  name: string
  version: string
}

export interface ScenarioLineage {
  family_id: string
  optimization_exposure: OptimizationExposure
  origin: LineageOrigin
  parent_scenario_ids: string[]
  source_record_ids: string[]
  transform: ScenarioLineageTransform | null
}

export interface PromptToBoardScenario {
  expected_outcome: ExpectedOutcome
  lineage: ScenarioLineage
  modalities: ScenarioModality[]
  prompt: string
  rubric: {
    rubric_id: string
    version: string
  }
  scenario_id: string
  session_mode: SessionMode
  split: ScenarioSplit
  target_policy: ExactTargetPolicy
  visibility: VisibilityRequirement
}

export interface ScenarioManifest {
  manifest_id: string
  revision: number
  scenarios: PromptToBoardScenario[]
  schema_version: typeof SCENARIO_MANIFEST_VERSION
}

export interface ScenarioManifestValidation {
  errors: string[]
  manifest: ScenarioManifest | null
  valid: boolean
}

const PROTECTED_SPLITS = new Set<ScenarioSplit>(['held_out', 'adversarial', 'probe'])

function objectValue(value: unknown, label: string): object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function field(candidate: object, name: string): unknown {
  return Reflect.get(candidate, name)
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string.`)
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`))
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  supported: T,
  label: string
): T[number] {
  const candidate = nonEmptyString(value, label)
  if (!supported.includes(candidate)) throw new Error(`${label} is unsupported: ${candidate}.`)
  return candidate
}

function uniqueValues<T extends string>(values: T[], label: string): T[] {
  const unique = new Set(values)
  if (unique.size !== values.length) throw new Error(`${label} must not contain duplicates.`)
  return values
}

function parseTargetPolicy(value: unknown, label: string): ExactTargetPolicy {
  const candidate = objectValue(value, label)
  const kind = enumValue(field(candidate, 'kind'), TARGET_POLICIES, `${label}.kind`)
  if (field(candidate, 'target_substitution') !== 'forbidden') {
    throw new Error(`${label}.target_substitution must be forbidden.`)
  }

  if (kind === 'exact_fixture') {
    return {
      fixture_ref: nonEmptyString(field(candidate, 'fixture_ref'), `${label}.fixture_ref`),
      kind,
      target_substitution: 'forbidden'
    }
  }
  if (kind === 'current_visible') {
    if (field(candidate, 'writer_requirement') !== 'exactly_one') {
      throw new Error(`${label}.writer_requirement must be exactly_one.`)
    }
    return { kind, target_substitution: 'forbidden', writer_requirement: 'exactly_one' }
  }
  if (kind === 'persisted_authority') {
    if (field(candidate, 'editor_required') !== false) {
      throw new Error(`${label}.editor_required must be false.`)
    }
    return {
      editor_required: false,
      fixture_ref: nonEmptyString(field(candidate, 'fixture_ref'), `${label}.fixture_ref`),
      kind,
      target_substitution: 'forbidden'
    }
  }

  const failureClass = enumValue(
    field(candidate, 'failure_class'),
    ['ambiguous_runtime', 'missing_identity', 'stale_context', 'wrong_target'] as const,
    `${label}.failure_class`
  )
  return { failure_class: failureClass, kind, target_substitution: 'forbidden' }
}

function parseLineage(value: unknown, label: string): ScenarioLineage {
  const candidate = objectValue(value, label)
  const origin = enumValue(field(candidate, 'origin'), LINEAGE_ORIGINS, `${label}.origin`)
  const transformValue = field(candidate, 'transform')
  let transform: ScenarioLineageTransform | null = null
  if (transformValue !== null) {
    const transformCandidate = objectValue(transformValue, `${label}.transform`)
    transform = {
      name: nonEmptyString(field(transformCandidate, 'name'), `${label}.transform.name`),
      version: nonEmptyString(field(transformCandidate, 'version'), `${label}.transform.version`)
    }
  }
  const parentScenarioIds = uniqueValues(
    stringArray(field(candidate, 'parent_scenario_ids'), `${label}.parent_scenario_ids`),
    `${label}.parent_scenario_ids`
  )
  if (origin === 'derived' && (parentScenarioIds.length === 0 || transform === null)) {
    throw new Error(`${label} derived origin requires a parent and transform.`)
  }
  if (origin === 'synthetic' && transform === null) {
    throw new Error(`${label} synthetic origin requires a transform.`)
  }
  if ((origin === 'human' || origin === 'system') && parentScenarioIds.length > 0) {
    throw new Error(`${label} ${origin} origin cannot name parent scenarios.`)
  }

  return {
    family_id: nonEmptyString(field(candidate, 'family_id'), `${label}.family_id`),
    optimization_exposure: enumValue(
      field(candidate, 'optimization_exposure'),
      OPTIMIZATION_EXPOSURES,
      `${label}.optimization_exposure`
    ),
    origin,
    parent_scenario_ids: parentScenarioIds,
    source_record_ids: uniqueValues(
      stringArray(field(candidate, 'source_record_ids'), `${label}.source_record_ids`),
      `${label}.source_record_ids`
    ),
    transform
  }
}

function parseScenario(value: unknown, index: number): PromptToBoardScenario {
  const label = `Scenario[${index}]`
  const candidate = objectValue(value, label)
  const modalities = uniqueValues(
    stringArray(field(candidate, 'modalities'), `${label}.modalities`).map((modality) =>
      enumValue(modality, SCENARIO_MODALITIES, `${label}.modalities`)
    ),
    `${label}.modalities`
  )
  if (modalities.length === 0) throw new Error(`${label}.modalities must not be empty.`)
  if (modalities.includes('none') && modalities.length > 1) {
    throw new Error(`${label}.modalities none cannot be combined with another modality.`)
  }

  const expectedOutcome = enumValue(
    field(candidate, 'expected_outcome'),
    EXPECTED_OUTCOMES,
    `${label}.expected_outcome`
  )
  const visibility = enumValue(
    field(candidate, 'visibility'),
    VISIBILITY_REQUIREMENTS,
    `${label}.visibility`
  )
  if (expectedOutcome === 'safe_stop' && visibility !== 'forbidden') {
    throw new Error(`${label} safe_stop requires forbidden visibility.`)
  }
  if (expectedOutcome === 'safe_stop' && !modalities.includes('none')) {
    throw new Error(`${label} safe_stop requires the none modality.`)
  }
  if (expectedOutcome === 'artifact_success' && modalities.includes('none')) {
    throw new Error(`${label} artifact_success cannot use the none modality.`)
  }

  const split = enumValue(field(candidate, 'split'), SCENARIO_SPLITS, `${label}.split`)
  const lineage = parseLineage(field(candidate, 'lineage'), `${label}.lineage`)
  const requiredExposure = PROTECTED_SPLITS.has(split) ? 'forbidden' : 'allowed'
  if (lineage.optimization_exposure !== requiredExposure) {
    throw new Error(
      `${label}.lineage.optimization_exposure must be ${requiredExposure} for ${split}.`
    )
  }

  return {
    expected_outcome: expectedOutcome,
    lineage,
    modalities,
    prompt: nonEmptyString(field(candidate, 'prompt'), `${label}.prompt`),
    rubric: {
      rubric_id: nonEmptyString(
        field(objectValue(field(candidate, 'rubric'), `${label}.rubric`), 'rubric_id'),
        `${label}.rubric.rubric_id`
      ),
      version: nonEmptyString(
        field(objectValue(field(candidate, 'rubric'), `${label}.rubric`), 'version'),
        `${label}.rubric.version`
      )
    },
    scenario_id: nonEmptyString(field(candidate, 'scenario_id'), `${label}.scenario_id`),
    session_mode: enumValue(
      field(candidate, 'session_mode'),
      SESSION_MODES,
      `${label}.session_mode`
    ),
    split,
    target_policy: parseTargetPolicy(field(candidate, 'target_policy'), `${label}.target_policy`),
    visibility
  }
}

function normalizedPrompt(prompt: string): string {
  return prompt.trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  const candidate = objectValue(value, 'Fingerprint value')
  return Object.fromEntries(
    Object.keys(candidate)
      .sort()
      .map((key) => [key, stableValue(field(candidate, key))])
  )
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function scenarioFingerprint(scenario: PromptToBoardScenario): string {
  return sha256(
    JSON.stringify(
      stableValue({
        expected_outcome: scenario.expected_outcome,
        modalities: [...scenario.modalities].sort(),
        prompt: normalizedPrompt(scenario.prompt),
        session_mode: scenario.session_mode,
        target_policy: scenario.target_policy,
        visibility: scenario.visibility
      })
    )
  )
}

function assertNoCycle(
  scenarioId: string,
  scenariosById: ReadonlyMap<string, PromptToBoardScenario>,
  visiting: Set<string>,
  visited: Set<string>
): void {
  if (visited.has(scenarioId)) return
  if (visiting.has(scenarioId))
    throw new Error(`Scenario lineage contains a cycle at ${scenarioId}.`)
  visiting.add(scenarioId)
  const scenario = scenariosById.get(scenarioId)
  for (const parentId of scenario?.lineage.parent_scenario_ids ?? []) {
    assertNoCycle(parentId, scenariosById, visiting, visited)
  }
  visiting.delete(scenarioId)
  visited.add(scenarioId)
}

function assertLeakageSafe(scenarios: PromptToBoardScenario[]): void {
  const scenariosById = new Map<string, PromptToBoardScenario>()
  const prompts = new Map<string, string>()
  const fingerprints = new Map<string, string>()
  const familySplits = new Map<string, ScenarioSplit>()
  const sourceSplits = new Map<string, ScenarioSplit>()

  for (const scenario of scenarios) {
    if (scenariosById.has(scenario.scenario_id)) {
      throw new Error(`Duplicate scenario_id: ${scenario.scenario_id}.`)
    }
    scenariosById.set(scenario.scenario_id, scenario)

    const promptKey = sha256(normalizedPrompt(scenario.prompt))
    const existingPrompt = prompts.get(promptKey)
    if (existingPrompt) {
      throw new Error(
        `Normalized prompt leakage between ${existingPrompt} and ${scenario.scenario_id}.`
      )
    }
    prompts.set(promptKey, scenario.scenario_id)

    const fingerprint = scenarioFingerprint(scenario)
    const existingFingerprint = fingerprints.get(fingerprint)
    if (existingFingerprint) {
      throw new Error(
        `Scenario fingerprint leakage between ${existingFingerprint} and ${scenario.scenario_id}.`
      )
    }
    fingerprints.set(fingerprint, scenario.scenario_id)

    const familySplit = familySplits.get(scenario.lineage.family_id)
    if (familySplit && familySplit !== scenario.split) {
      throw new Error(
        `Lineage family ${scenario.lineage.family_id} crosses ${familySplit} and ${scenario.split}.`
      )
    }
    familySplits.set(scenario.lineage.family_id, scenario.split)

    for (const sourceId of scenario.lineage.source_record_ids) {
      const sourceSplit = sourceSplits.get(sourceId)
      if (sourceSplit && sourceSplit !== scenario.split) {
        throw new Error(`Source record ${sourceId} crosses ${sourceSplit} and ${scenario.split}.`)
      }
      sourceSplits.set(sourceId, scenario.split)
    }
  }

  for (const scenario of scenarios) {
    for (const parentId of scenario.lineage.parent_scenario_ids) {
      const parent = scenariosById.get(parentId)
      if (!parent)
        throw new Error(`Scenario ${scenario.scenario_id} has unknown parent ${parentId}.`)
      if (
        parent.split !== scenario.split ||
        parent.lineage.family_id !== scenario.lineage.family_id
      ) {
        throw new Error(
          `Scenario ${scenario.scenario_id} parent ${parentId} must share its split and family.`
        )
      }
    }
  }

  const visited = new Set<string>()
  for (const scenarioId of scenariosById.keys()) {
    assertNoCycle(scenarioId, scenariosById, new Set(), visited)
  }
}

export function parseScenarioManifest(value: unknown): ScenarioManifest {
  const candidate = objectValue(value, 'Scenario manifest')
  if (field(candidate, 'schema_version') !== SCENARIO_MANIFEST_VERSION) {
    throw new Error(`Scenario manifest schema_version must be ${SCENARIO_MANIFEST_VERSION}.`)
  }
  const scenarioValues = field(candidate, 'scenarios')
  if (!Array.isArray(scenarioValues) || scenarioValues.length === 0) {
    throw new Error('Scenario manifest scenarios must be a non-empty array.')
  }
  const scenarios = scenarioValues.map(parseScenario)
  assertLeakageSafe(scenarios)
  return {
    manifest_id: nonEmptyString(field(candidate, 'manifest_id'), 'Scenario manifest manifest_id'),
    revision: positiveInteger(field(candidate, 'revision'), 'Scenario manifest revision'),
    scenarios,
    schema_version: SCENARIO_MANIFEST_VERSION
  }
}

export function validateScenarioManifest(value: unknown): ScenarioManifestValidation {
  try {
    return { errors: [], manifest: parseScenarioManifest(value), valid: true }
  } catch (error) {
    return {
      errors: [error instanceof Error ? error.message : String(error)],
      manifest: null,
      valid: false
    }
  }
}

export function assertValidScenarioManifest(value: unknown): asserts value is ScenarioManifest {
  parseScenarioManifest(value)
}
