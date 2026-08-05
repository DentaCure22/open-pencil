import { parseEvaluationConfigIdentity, type EvaluationConfigIdentity } from './evaluation-config'

export const EVAL_EVENT_SCHEMA_VERSION = 'prompt-to-board-eval-event/v3' as const
export const EVAL_SUMMARY_SCHEMA_VERSION = 'prompt-to-board-eval-summary/v5' as const
export const EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION = 'prompt-to-board-context-inventory/v2' as const

export type EvalEventSource = 'browser' | 'codex' | 'openpencil' | 'orchestrator' | 'reviewer'

export const EVAL_EVENT_KINDS = [
  'agent_message_completed',
  'board_context_completed',
  'codex_event_unmapped',
  'codex_raw_stream_closed',
  'codex_thread_started',
  'codex_turn_completed',
  'codex_turn_started',
  'command_completed',
  'command_started',
  'durability_confirmed',
  'final_response_released',
  'openpencil_result',
  'pixel_witness_captured',
  'process_spawned',
  'prompt_written',
  'recovery_probe_completed',
  'render_acknowledged',
  'run_dispatched',
  'run_error',
  'run_pending_proof',
  'semantic_review_completed',
  'visual_review_completed'
] as const

export type EvalEventKind = (typeof EVAL_EVENT_KINDS)[number]

export type EvalContextComponentKind =
  | 'board_context'
  | 'developer_instructions'
  | 'exact_target_packet'
  | 'execution_contract'
  | 'full_dispatched_prompt'
  | 'optional_modules'
  | 'project_instructions'
  | 'provided_recipe'
  | 'skill_bundle'
  | 'system_instructions'
  | 'tool_output'
  | 'tool_schemas'
  | 'user_prompt'
  | 'warm_session_history'

export type EvalContextComponentAvailability = 'observed' | 'provenance_only' | 'unavailable'

export interface EvalContextComponent {
  availability: EvalContextComponentAvailability
  availability_reason: string | null
  bytes: number | null
  kind: EvalContextComponentKind
  provenance_hash: string | null
  sha256: string | null
  source: string
  token_count: null
  token_count_availability_reason: string
}

export interface EvalContextInventory {
  components: EvalContextComponent[]
  schema_version: typeof EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION
}

export type EvalTelemetryAvailability = 'derived' | 'observed' | 'unavailable'

export interface EvalTelemetryValue<T> {
  availability: EvalTelemetryAvailability
  availability_reason: string | null
  source_event_sequence: number | null
  value: T | null
}

export interface EvalTokenTelemetry {
  cache_write_input_tokens: EvalTelemetryValue<number>
  cached_input_tokens: EvalTelemetryValue<number>
  input_tokens: EvalTelemetryValue<number>
  output_tokens: EvalTelemetryValue<number>
  reasoning_output_tokens: EvalTelemetryValue<number>
  scope: EvalTelemetryValue<'codex_thread_total'>
  tool_argument_tokens: EvalTelemetryValue<number>
  tool_result_tokens: EvalTelemetryValue<number>
  total_tokens: EvalTelemetryValue<number>
  uncached_input_tokens: EvalTelemetryValue<number>
}

export interface EvalRunTelemetry {
  bytes: {
    full_dispatched_prompt: EvalTelemetryValue<number>
    generated_final: EvalTelemetryValue<number>
    raw_codex_stream: EvalTelemetryValue<number>
    released_final: EvalTelemetryValue<number>
    tool_arguments: EvalTelemetryValue<number>
    tool_result: EvalTelemetryValue<number>
  }
  context_inventory: EvalContextInventory | null
  milestones: {
    codex_turn_started_at_ms: EvalTelemetryValue<number>
    durability_observed_at_ms: EvalTelemetryValue<number>
    evaluator_enqueued_at_ms: EvalTelemetryValue<number>
    final_generated_at_ms: EvalTelemetryValue<number>
    final_model_request_started_at_ms: EvalTelemetryValue<number>
    final_released_at_ms: EvalTelemetryValue<number>
    first_model_token_at_ms: EvalTelemetryValue<number>
    first_tool_arguments_available_at_ms: EvalTelemetryValue<number>
    first_tool_arguments_started_at_ms: EvalTelemetryValue<number>
    first_tool_completed_at_ms: EvalTelemetryValue<number>
    first_tool_invoked_at_ms: EvalTelemetryValue<number>
    model_request_enqueued_at_ms: EvalTelemetryValue<number>
    model_started_at_ms: EvalTelemetryValue<number>
    process_spawned_at_ms: EvalTelemetryValue<number>
    prompt_written_at_ms: EvalTelemetryValue<number>
    receipt_observed_at_ms: EvalTelemetryValue<number>
  }
  tokens: EvalTokenTelemetry
  unmapped_codex_events: number
}

export interface EvalTarget {
  content_document_id: string
  document_id: string
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

export interface EvalEvent {
  data: Record<string, unknown>
  kind: EvalEventKind
  observed_at_ms: number
  observed_monotonic_ms: number
  precision_ms: number
  recorder_id: string
  run_id: string
  schema_version: typeof EVAL_EVENT_SCHEMA_VERSION
  sequence: number
  source: EvalEventSource
}

export interface EvalRunRequirements {
  durability: boolean
  pixel_witness: boolean
  receipt: boolean
  recovery: boolean
  render_acknowledgement: boolean
  semantic_quality: boolean
  visual_quality: boolean
}

export interface EvalSemanticProvenance {
  rubric_id: string
  rubric_version: string
  scenario_version: string
}

export interface LegacyEvalMetadataMigration {
  provenance: EvalSemanticProvenance
  require_semantic_quality: boolean
}

export interface EvalRunMetadata {
  config: EvaluationConfigIdentity
  expected_outcome: 'artifact_success' | 'safe_stop'
  prompt: string
  provenance: EvalSemanticProvenance
  requirements: EvalRunRequirements
  run_id: string
  scenario_id: string
}

export interface EvalRunSummary {
  failures: string[]
  metadata: EvalRunMetadata
  milestones: {
    authoritative_result_at_ms: number | null
    durability_confirmed_at_ms: number | null
    final_response_observed_at_ms: number | null
    final_response_generated_at_ms?: number | null
    first_board_tool_started_at_ms: number | null
    first_tool_started_at_ms: number | null
    pixel_witness_at_ms: number | null
    prompt_dispatched_at_ms: number | null
    render_acknowledged_at_ms: number | null
    semantic_review_at_ms: number | null
  }
  schema_version: typeof EVAL_SUMMARY_SCHEMA_VERSION
  target: EvalTarget | null
  timings_ms: {
    command_execution_total: number | null
    prompt_to_authoritative: number | null
    prompt_to_final: number | null
    prompt_to_final_generation?: number | null
    prompt_to_first_board_tool: number | null
    prompt_to_first_tool: number | null
    prompt_to_semantic_review: number | null
    prompt_to_visible: number | null
  }
  valid: boolean
  witnesses: {
    durability: boolean
    pixel: boolean
    receipt: boolean
    render: boolean
    semantic_quality: boolean
    visual_quality: boolean
  }
}

const EVENT_KINDS = new Set<string>(EVAL_EVENT_KINDS)

const EVENT_SOURCES = new Set<EvalEventSource>([
  'browser',
  'codex',
  'openpencil',
  'orchestrator',
  'reviewer'
])

function objectValue(value: unknown, label: string): object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function field(candidate: object, name: string): unknown {
  return Reflect.get(candidate, name)
}

function record(value: unknown, label: string): Record<string, unknown> {
  const candidate = objectValue(value, label)
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(candidate)) result[key] = field(candidate, key)
  return result
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a string.`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

export function parseEvalEvent(value: unknown): EvalEvent {
  const candidate = objectValue(value, 'Eval event')
  if (field(candidate, 'schema_version') !== EVAL_EVENT_SCHEMA_VERSION) {
    throw new Error(`Eval event schema_version must be ${EVAL_EVENT_SCHEMA_VERSION}.`)
  }
  const kind = nonEmptyString(field(candidate, 'kind'), 'Eval event kind') as EvalEventKind
  if (!EVENT_KINDS.has(kind)) throw new Error(`Unsupported eval event kind: ${kind}.`)
  const source = nonEmptyString(field(candidate, 'source'), 'Eval event source') as EvalEventSource
  if (!EVENT_SOURCES.has(source)) throw new Error(`Unsupported eval event source: ${source}.`)
  return {
    data: record(field(candidate, 'data'), 'Eval event data'),
    kind,
    observed_at_ms: nonNegativeInteger(
      field(candidate, 'observed_at_ms'),
      'Eval event observed_at_ms'
    ),
    observed_monotonic_ms: nonNegativeNumber(
      field(candidate, 'observed_monotonic_ms'),
      'Eval event observed_monotonic_ms'
    ),
    precision_ms: nonNegativeNumber(field(candidate, 'precision_ms'), 'Eval event precision_ms'),
    recorder_id: nonEmptyString(field(candidate, 'recorder_id'), 'Eval event recorder_id'),
    run_id: nonEmptyString(field(candidate, 'run_id'), 'Eval event run_id'),
    schema_version: EVAL_EVENT_SCHEMA_VERSION,
    sequence: nonNegativeInteger(field(candidate, 'sequence'), 'Eval event sequence'),
    source
  }
}

export function parseEvalTarget(value: unknown): EvalTarget {
  const candidate = objectValue(value, 'Eval target')
  return {
    content_document_id: nonEmptyString(
      field(candidate, 'content_document_id'),
      'Eval target content_document_id'
    ),
    document_id: nonEmptyString(field(candidate, 'document_id'), 'Eval target document_id'),
    page_id: nonEmptyString(field(candidate, 'page_id'), 'Eval target page_id'),
    runtime_instance_id: nonEmptyString(
      field(candidate, 'runtime_instance_id'),
      'Eval target runtime_instance_id'
    ),
    workspace_id: nonEmptyString(field(candidate, 'workspace_id'), 'Eval target workspace_id')
  }
}

export function createEvalEvent(event: Omit<EvalEvent, 'schema_version'>): EvalEvent {
  return parseEvalEvent({ ...event, schema_version: EVAL_EVENT_SCHEMA_VERSION })
}

function nonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`)
  return value
}

export function parseEvalRunMetadata(value: unknown): EvalRunMetadata {
  const candidate = objectValue(value, 'Eval run metadata')
  const expectedOutcome = nonEmptyString(
    field(candidate, 'expected_outcome'),
    'Eval run expected_outcome'
  )
  if (expectedOutcome !== 'artifact_success' && expectedOutcome !== 'safe_stop') {
    throw new Error('Eval run expected_outcome is unsupported.')
  }
  const requirements = objectValue(field(candidate, 'requirements'), 'Eval run requirements')
  const provenance = objectValue(field(candidate, 'provenance'), 'Eval run provenance')
  return {
    config: parseEvaluationConfigIdentity(field(candidate, 'config')),
    expected_outcome: expectedOutcome,
    prompt: nonEmptyString(field(candidate, 'prompt'), 'Eval run prompt'),
    provenance: {
      rubric_id: nonEmptyString(field(provenance, 'rubric_id'), 'Eval run rubric_id'),
      rubric_version: nonEmptyString(
        field(provenance, 'rubric_version'),
        'Eval run rubric_version'
      ),
      scenario_version: nonEmptyString(
        field(provenance, 'scenario_version'),
        'Eval run scenario_version'
      )
    },
    requirements: {
      durability: boolean(field(requirements, 'durability'), 'Requirement durability'),
      pixel_witness: boolean(field(requirements, 'pixel_witness'), 'Requirement pixel_witness'),
      receipt: boolean(field(requirements, 'receipt'), 'Requirement receipt'),
      recovery: boolean(field(requirements, 'recovery'), 'Requirement recovery'),
      render_acknowledgement: boolean(
        field(requirements, 'render_acknowledgement'),
        'Requirement render_acknowledgement'
      ),
      semantic_quality: boolean(
        field(requirements, 'semantic_quality'),
        'Requirement semantic_quality'
      ),
      visual_quality: boolean(field(requirements, 'visual_quality'), 'Requirement visual_quality')
    },
    run_id: nonEmptyString(field(candidate, 'run_id'), 'Eval run run_id'),
    scenario_id: nonEmptyString(field(candidate, 'scenario_id'), 'Eval run scenario_id')
  }
}

export function migrateLegacyEvalRunMetadata(
  value: unknown,
  migration: LegacyEvalMetadataMigration
): EvalRunMetadata {
  const candidate = record(value, 'Legacy eval run metadata')
  if (
    'provenance' in candidate ||
    'semantic_quality' in record(candidate.requirements, 'Legacy requirements')
  ) {
    throw new Error('Legacy metadata migration only accepts metadata without semantic provenance.')
  }
  return parseEvalRunMetadata({
    ...candidate,
    provenance: migration.provenance,
    requirements: {
      ...record(candidate.requirements, 'Legacy requirements'),
      semantic_quality: migration.require_semantic_quality
    }
  })
}
