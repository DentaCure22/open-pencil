import { createHash } from 'node:crypto'

export const EVALUATION_CONFIG_SCHEMA_VERSION = 'prompt-to-board-eval-config/v2' as const

export const DEFAULT_VISIBLE_PROOF_SAFETY_TIMEOUT_MS = 45 * 60_000

export const MEASUREMENT_CLASSES = [
  'rpc_cold',
  'rpc_warm',
  'assisted_cold',
  'assisted_warm',
  'open_ended_cold',
  'open_ended_warm'
] as const

export type MeasurementClass = (typeof MEASUREMENT_CLASSES)[number]

export interface EvaluationAssistanceVector {
  context: 'agent_selected' | 'pre_scoped'
  modality: 'agent_selected' | 'preselected'
  placement: 'agent_selected' | 'pre_resolved'
  prompt: 'natural' | 'benchmark_structured'
  provided_recipe_sha256: string | null
  recipe: 'none' | 'provided'
  target: 'agent_discovered' | 'provided_exact'
}

export interface EvaluationConfigurationInput {
  agent: {
    model: string
    reasoning_effort: string
    service_tier: string
  }
  assistance: EvaluationAssistanceVector
  board: {
    content_document_id: string
    density: 'empty' | 'sparse' | 'medium' | 'dense'
    document_id: string
    fixture_hash: string
    page_id: string
    reset_policy: string
    revision: number
    runtime_instance_id: string
    workspace_id: string
  }
  browser: {
    engine: string
    profile_state: 'fresh' | 'persistent' | 'not_applicable'
    required: boolean
    version: string
    viewport: { height: number; width: number } | null
  }
  context: {
    cwd_mode: string
    ignore_rules: boolean
    ignore_user_config: boolean
    rules_hash: string
    user_config_hash: string
  }
  evaluator: {
    difficulty_class?: string
    grader_version: string
    modality_class?: string
    version: string
    visible_proof_safety_timeout_ms?: number
  }
  measurement_class: MeasurementClass
  prompt_tooling: {
    prompt_template_hash: string
    skill_bundle_hash: string
    tool_build_hash: string
    tool_contract_version: string
  }
  retry: {
    agent_turn_limit: number
    board_retry_policy: string
    max_retries: number
  }
  source: {
    commit: string
    dirty: boolean
    dirty_diff_hash: string
    dirty_files: string[]
  }
}

export interface EvaluationConfiguration extends EvaluationConfigurationInput {
  config_id: string
  schema_version: typeof EVALUATION_CONFIG_SCHEMA_VERSION
}

export interface EvaluationConfigIdentity {
  config_id: string
  measurement_class: MeasurementClass
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  )
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
}

function nonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string.`)
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
}

function validateMeasurementClass(
  measurementClass: string
): asserts measurementClass is MeasurementClass {
  if (!MEASUREMENT_CLASSES.includes(measurementClass as MeasurementClass)) {
    throw new Error(`Unsupported measurement class: ${measurementClass}.`)
  }
}

function expectedSession(measurementClass: MeasurementClass): 'cold' | 'warm' {
  return measurementClass.endsWith('_warm') ? 'warm' : 'cold'
}

function validateAssistance(
  measurementClass: MeasurementClass,
  assistance: EvaluationAssistanceVector
): void {
  const family = measurementClass.split('_').slice(0, -1).join('_')
  const values = Object.values(assistance)
  const hasAssistance = values.some(
    (value) =>
      value === 'pre_scoped' ||
      value === 'preselected' ||
      value === 'pre_resolved' ||
      value === 'benchmark_structured' ||
      value === 'provided'
  )
  if (family === 'assisted' && !hasAssistance) {
    throw new Error('An assisted measurement class must declare at least one assistance input.')
  }
  if (family === 'open_ended' && hasAssistance) {
    throw new Error('An open-ended measurement class cannot declare pre-resolved assistance.')
  }
  if (family === 'rpc' && assistance.recipe !== 'provided') {
    throw new Error('An RPC measurement class must declare its provided operation recipe.')
  }
  if (assistance.recipe === 'provided') {
    if (!assistance.provided_recipe_sha256?.match(/^[a-f0-9]{64}$/u)) {
      throw new Error('A provided recipe requires provided_recipe_sha256 as a SHA-256 hash.')
    }
  } else if (assistance.provided_recipe_sha256 !== null) {
    throw new Error('A run without a provided recipe must set provided_recipe_sha256 to null.')
  }
}

function validateConfigurationInput(input: EvaluationConfigurationInput): void {
  validateMeasurementClass(input.measurement_class)
  validateAssistance(input.measurement_class, input.assistance)
  for (const [label, value] of [
    ['agent.model', input.agent.model],
    ['agent.reasoning_effort', input.agent.reasoning_effort],
    ['agent.service_tier', input.agent.service_tier],
    ['board.content_document_id', input.board.content_document_id],
    ['board.document_id', input.board.document_id],
    ['board.fixture_hash', input.board.fixture_hash],
    ['board.page_id', input.board.page_id],
    ['board.reset_policy', input.board.reset_policy],
    ['board.runtime_instance_id', input.board.runtime_instance_id],
    ['board.workspace_id', input.board.workspace_id],
    ['browser.engine', input.browser.engine],
    ['browser.version', input.browser.version],
    ['context.cwd_mode', input.context.cwd_mode],
    ['context.rules_hash', input.context.rules_hash],
    ['context.user_config_hash', input.context.user_config_hash],
    ['evaluator.grader_version', input.evaluator.grader_version],
    ['evaluator.version', input.evaluator.version],
    ['prompt_tooling.prompt_template_hash', input.prompt_tooling.prompt_template_hash],
    ['prompt_tooling.skill_bundle_hash', input.prompt_tooling.skill_bundle_hash],
    ['prompt_tooling.tool_build_hash', input.prompt_tooling.tool_build_hash],
    ['prompt_tooling.tool_contract_version', input.prompt_tooling.tool_contract_version],
    ['retry.board_retry_policy', input.retry.board_retry_policy],
    ['source.commit', input.source.commit],
    ['source.dirty_diff_hash', input.source.dirty_diff_hash]
  ] as const) {
    nonEmpty(value, label)
  }
  for (const [label, value] of [
    ['evaluator.difficulty_class', input.evaluator.difficulty_class],
    ['evaluator.modality_class', input.evaluator.modality_class]
  ] as const) {
    if (value !== undefined) nonEmpty(value, label)
  }
  if (input.evaluator.visible_proof_safety_timeout_ms !== undefined) {
    positiveInteger(
      input.evaluator.visible_proof_safety_timeout_ms,
      'evaluator.visible_proof_safety_timeout_ms'
    )
  }
  for (const [label, value] of [
    ['board.revision', input.board.revision],
    ['retry.agent_turn_limit', input.retry.agent_turn_limit],
    ['retry.max_retries', input.retry.max_retries]
  ] as const) {
    nonNegativeInteger(value, label)
  }
  if (new Set(input.source.dirty_files).size !== input.source.dirty_files.length) {
    throw new Error('source.dirty_files must not contain duplicates.')
  }
  if (input.source.dirty !== input.source.dirty_files.length > 0) {
    throw new Error('source.dirty must agree with source.dirty_files.')
  }
  if (input.browser.required && input.browser.profile_state === 'not_applicable') {
    throw new Error('A required browser cannot use a not_applicable profile state.')
  }
  if (!input.browser.required && input.browser.viewport !== null) {
    throw new Error('A run without a browser must use a null viewport.')
  }
  if (input.browser.viewport) {
    nonNegativeInteger(input.browser.viewport.width, 'browser.viewport.width')
    nonNegativeInteger(input.browser.viewport.height, 'browser.viewport.height')
    if (input.browser.viewport.width === 0 || input.browser.viewport.height === 0) {
      throw new Error('browser.viewport dimensions must be positive.')
    }
  }
}

export function evaluationConfigHash(input: EvaluationConfigurationInput): string {
  validateConfigurationInput(input)
  return sha256(
    JSON.stringify(stableValue({ schema_version: EVALUATION_CONFIG_SCHEMA_VERSION, ...input }))
  )
}

export function createEvaluationConfiguration(
  input: EvaluationConfigurationInput
): Readonly<EvaluationConfiguration> {
  const normalized: EvaluationConfigurationInput = structuredClone(input)
  normalized.source.dirty_files.sort()
  const config: EvaluationConfiguration = {
    ...normalized,
    config_id: evaluationConfigHash(normalized),
    schema_version: EVALUATION_CONFIG_SCHEMA_VERSION
  }
  return deepFreeze(config)
}

export function parseEvaluationConfiguration(value: unknown): Readonly<EvaluationConfiguration> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Evaluation configuration must be an object.')
  }
  const candidate = value as EvaluationConfiguration
  if (candidate.schema_version !== EVALUATION_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Evaluation configuration schema_version must be ${EVALUATION_CONFIG_SCHEMA_VERSION}.`
    )
  }
  validateMeasurementClass(candidate.measurement_class)
  const { config_id: configId, schema_version: _schemaVersion, ...input } = candidate
  nonEmpty(configId, 'config_id')
  const canonical = createEvaluationConfiguration(input)
  if (configId !== canonical.config_id) {
    throw new Error('Evaluation configuration config_id does not match its contents.')
  }
  return canonical
}

export function evaluationConfigIdentity(
  config: EvaluationConfiguration
): EvaluationConfigIdentity {
  return { config_id: config.config_id, measurement_class: config.measurement_class }
}

export function visibleProofSafetyTimeoutMs(
  config: Pick<EvaluationConfigurationInput, 'evaluator'>
): number {
  return config.evaluator.visible_proof_safety_timeout_ms ?? DEFAULT_VISIBLE_PROOF_SAFETY_TIMEOUT_MS
}

export function parseEvaluationConfigIdentity(value: unknown): EvaluationConfigIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Evaluation config identity must be an object.')
  }
  const candidate = value as Partial<EvaluationConfigIdentity>
  const configId = candidate.config_id
  if (typeof configId !== 'string' || !/^[a-f0-9]{64}$/.test(configId)) {
    throw new Error('Evaluation config identity config_id must be a SHA-256 hash.')
  }
  const measurementClass = candidate.measurement_class
  if (typeof measurementClass !== 'string') {
    throw new TypeError('Evaluation config identity measurement_class must be a string.')
  }
  validateMeasurementClass(measurementClass)
  return { config_id: configId, measurement_class: measurementClass }
}

export function measurementSession(measurementClass: MeasurementClass): 'cold' | 'warm' {
  validateMeasurementClass(measurementClass)
  return expectedSession(measurementClass)
}
