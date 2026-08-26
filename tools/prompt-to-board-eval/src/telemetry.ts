import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { EvaluationConfiguration } from './evaluation-config'
import {
  EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION,
  parseEvalEvent,
  type EvalContextComponent,
  type EvalContextComponentKind,
  type EvalContextInventory,
  type EvalEvent,
  type EvalRunTelemetry,
  type EvalTelemetryAvailability,
  type EvalTelemetryValue
} from './schema'

export const EVAL_RUN_TELEMETRY_ARTIFACT_SCHEMA_VERSION =
  'prompt-to-board-run-telemetry/v1' as const

export interface EvalRunTelemetryArtifact {
  derived_at_ms: number
  run_id: string
  schema_version: typeof EVAL_RUN_TELEMETRY_ARTIFACT_SCHEMA_VERSION
  source_event_count: number
  source_event_log_path: string
  source_event_log_sha256: string
  telemetry: EvalRunTelemetry
}

const NO_EXACT_CONTEXT_TOKENS =
  'Codex JSONL does not attribute input tokens to individual context components.'
const STRAIGHT_THROUGH_USAGE_UNAVAILABLE =
  'The straight-through supervisor ended the Codex turn after authoritative Board receipt and before Codex emitted exact usage; no token estimate was substituted.'
const MODEL_REQUEST_ENQUEUE_UNAVAILABLE =
  'Codex JSONL does not expose provider model-request enqueue timestamps.'
const MODEL_START_UNAVAILABLE =
  'Codex JSONL turn.started is a turn lifecycle marker, not a provider model-start timestamp.'
const FIRST_MODEL_TOKEN_UNAVAILABLE =
  'Codex JSONL exposes completed agent messages, not first-token timestamps.'
const TOOL_ARGUMENT_START_UNAVAILABLE =
  'Codex JSONL first exposes complete tool arguments when invocation starts; argument-generation start is unavailable.'
const FINAL_MODEL_REQUEST_UNAVAILABLE =
  'Codex JSONL does not expose the model-request start after a tool result.'
const TOOL_ARGUMENT_TOKENS_UNAVAILABLE =
  'Codex turn.completed reports thread-total usage but does not attribute tokens to tool arguments.'
const TOOL_RESULT_TOKENS_UNAVAILABLE =
  'Codex turn.completed reports thread-total usage but does not attribute tokens to tool results.'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function observedComponent(
  kind: EvalContextComponentKind,
  source: string,
  content: string
): EvalContextComponent {
  return {
    availability: 'observed',
    availability_reason: null,
    bytes: Buffer.byteLength(content, 'utf8'),
    kind,
    provenance_hash: null,
    sha256: sha256(content),
    source,
    token_count: null,
    token_count_availability_reason: NO_EXACT_CONTEXT_TOKENS
  }
}

function provenanceComponent(
  kind: EvalContextComponentKind,
  source: string,
  provenanceHash: string,
  reason: string
): EvalContextComponent {
  return {
    availability: 'provenance_only',
    availability_reason: reason,
    bytes: null,
    kind,
    provenance_hash: provenanceHash,
    sha256: null,
    source,
    token_count: null,
    token_count_availability_reason: NO_EXACT_CONTEXT_TOKENS
  }
}

function unavailableComponent(
  kind: EvalContextComponentKind,
  source: string,
  reason: string
): EvalContextComponent {
  return {
    availability: 'unavailable',
    availability_reason: reason,
    bytes: null,
    kind,
    provenance_hash: null,
    sha256: null,
    source,
    token_count: null,
    token_count_availability_reason: NO_EXACT_CONTEXT_TOKENS
  }
}

export function buildRecorderContextInventory(
  prompt: string,
  configuration: Readonly<EvaluationConfiguration>
): EvalContextInventory {
  const combinedPromptReason =
    'The recorder receives one combined prompt and cannot recover this component boundary.'
  const provenanceReason =
    'The frozen configuration records provenance but not the exact injected bytes.'
  return {
    components: [
      observedComponent('full_dispatched_prompt', 'recorder.prompt', prompt),
      unavailableComponent('user_prompt', 'recorder.prompt', combinedPromptReason),
      provenanceComponent(
        'exact_target_packet',
        'evaluation_configuration.board',
        sha256(stableJson(configuration.board)),
        'The exact Board target is frozen, but its serialized prompt segment is not supplied separately.'
      ),
      provenanceComponent(
        'execution_contract',
        'evaluation_configuration.prompt_tooling.prompt_template_hash',
        configuration.prompt_tooling.prompt_template_hash,
        provenanceReason
      ),
      unavailableComponent(
        'system_instructions',
        'codex_protocol',
        'codex exec JSONL does not expose system instruction contents.'
      ),
      unavailableComponent(
        'developer_instructions',
        'codex_protocol',
        'codex exec JSONL does not expose developer instruction contents.'
      ),
      configuration.context.ignore_rules
        ? unavailableComponent(
            'project_instructions',
            'evaluation_configuration.context.ignore_rules',
            'Project instructions were explicitly disabled for this run.'
          )
        : provenanceComponent(
            'project_instructions',
            'evaluation_configuration.context.rules_hash',
            configuration.context.rules_hash,
            provenanceReason
          ),
      configuration.assistance.provided_recipe_sha256
        ? provenanceComponent(
            'provided_recipe',
            'evaluation_configuration.assistance.provided_recipe_sha256',
            configuration.assistance.provided_recipe_sha256,
            'The frozen configuration records the recipe fingerprint but not its exact bytes.'
          )
        : unavailableComponent(
            'provided_recipe',
            'evaluation_configuration.assistance.provided_recipe_sha256',
            'No recipe was provided for this run.'
          ),
      provenanceComponent(
        'skill_bundle',
        'evaluation_configuration.prompt_tooling.skill_bundle_hash',
        configuration.prompt_tooling.skill_bundle_hash,
        provenanceReason
      ),
      unavailableComponent(
        'optional_modules',
        'codex_protocol',
        'The recorder cannot observe which optional instruction modules Codex injected.'
      ),
      provenanceComponent(
        'tool_schemas',
        'evaluation_configuration.prompt_tooling.tool_build_hash',
        configuration.prompt_tooling.tool_build_hash,
        provenanceReason
      ),
      unavailableComponent(
        'board_context',
        'codex_protocol',
        'Tool output can be byte-counted, but Codex JSONL does not expose its later model-context contribution.'
      ),
      unavailableComponent(
        'tool_output',
        'codex_protocol',
        'Tool output can be byte-counted, but Codex JSONL does not expose its later model-context contribution.'
      )
    ],
    schema_version: EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION
  }
}

function eventValue<T>(
  event: EvalEvent | undefined,
  value: T | null,
  missingReason: string,
  availability: EvalTelemetryAvailability = 'observed'
): EvalTelemetryValue<T> {
  if (!event || value === null) {
    return {
      availability: 'unavailable',
      availability_reason: missingReason,
      source_event_sequence: event?.sequence ?? null,
      value: null
    }
  }
  return {
    availability,
    availability_reason: null,
    source_event_sequence: event.sequence,
    value
  }
}

function eventTime(
  event: EvalEvent | undefined,
  missingReason: string
): EvalTelemetryValue<number> {
  return eventValue(event, event?.observed_at_ms ?? null, missingReason)
}

function unavailable<T>(reason: string): EvalTelemetryValue<T> {
  return {
    availability: 'unavailable',
    availability_reason: reason,
    source_event_sequence: null,
    value: null
  }
}

function numberData(event: EvalEvent | undefined, key: string): number | null {
  const value = event?.data[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

type EvalRecordData = { [key: string]: unknown }

function recordData(event: EvalEvent | undefined, key: string): EvalRecordData | null {
  const value = event?.data[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as EvalRecordData)
    : null
}

function usageValue(
  event: EvalEvent | undefined,
  usage: Record<string, unknown> | null,
  key: string,
  availability: EvalTelemetryAvailability = 'observed',
  missingReason = `codex_turn_completed did not expose ${key}.`
): EvalTelemetryValue<number> {
  const value = usage?.[key]
  return eventValue(
    event,
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null,
    missingReason,
    availability
  )
}

function contextInventory(events: readonly EvalEvent[]): EvalContextInventory | null {
  const value = events.find((event) => event.kind === 'run_dispatched')?.data.context_inventory
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (Reflect.get(value, 'schema_version') !== EVAL_CONTEXT_INVENTORY_SCHEMA_VERSION) return null
  const components = Reflect.get(value, 'components')
  if (!Array.isArray(components)) return null
  return value as EvalContextInventory
}

function matchingCompletion(
  events: readonly EvalEvent[],
  started: EvalEvent | undefined
): EvalEvent | undefined {
  const itemId = started?.data.item_id
  if (typeof itemId !== 'string') {
    return events.find((event) => event.kind === 'command_completed')
  }
  return events.find((event) => event.kind === 'command_completed' && event.data.item_id === itemId)
}

function semanticBoardBuild(events: readonly EvalEvent[]): EvalEvent | undefined {
  return events.find(
    (event) =>
      event.kind === 'command_started' &&
      (event.data.semantic_command === 'build' || event.data.semantic_command === 'board_build')
  )
}

function appliedOpenPencilResult(events: readonly EvalEvent[]): EvalEvent | undefined {
  return events.find(
    (event) =>
      event.kind === 'openpencil_result' &&
      (event.data.mutation_state === 'applied' || event.data.mutation_state === 'replayed') &&
      typeof event.data.request_id === 'string' &&
      event.data.request_id.trim().length > 0
  )
}

function utf8DataBytes(event: EvalEvent | undefined, key: string): number | null {
  const value = event?.data[key]
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : null
}

export function deriveEvalRunTelemetry(events: readonly EvalEvent[]): EvalRunTelemetry {
  const dispatch = events.find((event) => event.kind === 'run_dispatched')
  const processSpawned = events.find((event) => event.kind === 'process_spawned')
  const promptWritten = events.find((event) => event.kind === 'prompt_written')
  const turnStarted = events.find((event) => event.kind === 'codex_turn_started')
  const firstCommand = events.find((event) => event.kind === 'command_started')
  const firstCommandCompleted = matchingCompletion(events, firstCommand)
  const boardBuild = semanticBoardBuild(events)
  const boardBuildCompleted = matchingCompletion(events, boardBuild)
  const receipt = appliedOpenPencilResult(events)
  const durability = events.find((event) => event.kind === 'durability_confirmed')
  const releasedFinal = events.find((event) => event.kind === 'final_response_released')
  const straightThroughRelease =
    releasedFinal?.data.final_origin === 'board_build_release_summary' ? releasedFinal : undefined
  const rawStream = events.find((event) => event.kind === 'codex_raw_stream_closed')
  const turnCompleted = events.findLast((event) => event.kind === 'codex_turn_completed')
  const generatedFinal =
    straightThroughRelease || !turnCompleted
      ? undefined
      : events.findLast(
          (event) =>
            event.kind === 'agent_message_completed' && event.sequence < turnCompleted.sequence
        )
  let generatedFinalMissingReason =
    'No completed generated final was observed before codex_turn_completed.'
  if (straightThroughRelease) {
    generatedFinalMissingReason =
      'Straight-through release is authoritative; pre-build agent commentary is not a generated final.'
  } else if (!turnCompleted) {
    generatedFinalMissingReason =
      'A completed Codex turn was not observed, so an agent message cannot be identified as the generated final.'
  }
  const usage = recordData(turnCompleted, 'usage')
  const usageScope = turnCompleted?.data.usage_scope
  const usageMissingReason =
    straightThroughRelease && !turnCompleted ? STRAIGHT_THROUGH_USAGE_UNAVAILABLE : undefined

  return {
    bytes: {
      full_dispatched_prompt: eventValue(
        promptWritten,
        numberData(promptWritten, 'bytes'),
        'prompt_written with an exact byte count was not observed.'
      ),
      generated_final: eventValue(
        generatedFinal,
        numberData(generatedFinal, 'text_bytes'),
        generatedFinalMissingReason
      ),
      raw_codex_stream: eventValue(
        rawStream,
        numberData(rawStream, 'bytes'),
        'The raw Codex JSONL sidecar did not close with byte-count evidence.'
      ),
      released_final: eventValue(
        releasedFinal,
        utf8DataBytes(releasedFinal, 'text'),
        'No released final with exact UTF-8 text bytes was observed.'
      ),
      tool_arguments: eventValue(
        boardBuild,
        numberData(boardBuild, 'argument_bytes'),
        'No complete semantic Board build argument byte count was observed.'
      ),
      tool_result: eventValue(
        boardBuildCompleted,
        numberData(boardBuildCompleted, 'result_bytes'),
        'No matching semantic Board build result byte count was observed.'
      )
    },
    context_inventory: contextInventory(events),
    milestones: {
      codex_turn_started_at_ms: eventTime(
        turnStarted,
        'Codex did not emit a turn.started lifecycle event.'
      ),
      durability_observed_at_ms: eventTime(durability, 'No durability confirmation was observed.'),
      evaluator_enqueued_at_ms: eventTime(dispatch, 'No evaluator dispatch event was observed.'),
      final_generated_at_ms: eventTime(generatedFinal, generatedFinalMissingReason),
      final_model_request_started_at_ms: unavailable(FINAL_MODEL_REQUEST_UNAVAILABLE),
      final_released_at_ms: eventTime(releasedFinal, 'No released final was observed.'),
      first_model_token_at_ms: unavailable(FIRST_MODEL_TOKEN_UNAVAILABLE),
      first_tool_arguments_available_at_ms: eventTime(
        firstCommand,
        'No complete tool arguments were observed.'
      ),
      first_tool_arguments_started_at_ms: unavailable(TOOL_ARGUMENT_START_UNAVAILABLE),
      first_tool_completed_at_ms: eventTime(
        firstCommandCompleted,
        'No matching first-tool completion was observed.'
      ),
      first_tool_invoked_at_ms: eventTime(firstCommand, 'No tool invocation was observed.'),
      model_request_enqueued_at_ms: unavailable(MODEL_REQUEST_ENQUEUE_UNAVAILABLE),
      model_started_at_ms: unavailable(MODEL_START_UNAVAILABLE),
      process_spawned_at_ms: eventTime(processSpawned, 'No Codex process spawn was observed.'),
      prompt_written_at_ms: eventTime(promptWritten, 'No prompt stdin write was observed.'),
      receipt_observed_at_ms: eventTime(
        receipt,
        'No applied OpenPencil receipt/result was observed.'
      )
    },
    tokens: {
      cache_write_input_tokens: usageValue(
        turnCompleted,
        usage,
        'cache_write_input_tokens',
        'observed',
        usageMissingReason
      ),
      cached_input_tokens: usageValue(
        turnCompleted,
        usage,
        'cached_input_tokens',
        'observed',
        usageMissingReason
      ),
      input_tokens: usageValue(
        turnCompleted,
        usage,
        'input_tokens',
        'observed',
        usageMissingReason
      ),
      output_tokens: usageValue(
        turnCompleted,
        usage,
        'output_tokens',
        'observed',
        usageMissingReason
      ),
      reasoning_output_tokens: usageValue(
        turnCompleted,
        usage,
        'reasoning_output_tokens',
        'observed',
        usageMissingReason
      ),
      scope: eventValue(
        turnCompleted,
        usageScope === 'codex_thread_total' ? usageScope : null,
        usageMissingReason ?? 'Codex thread-total usage scope was not observed.'
      ),
      tool_argument_tokens: unavailable(TOOL_ARGUMENT_TOKENS_UNAVAILABLE),
      tool_result_tokens: unavailable(TOOL_RESULT_TOKENS_UNAVAILABLE),
      total_tokens: usageValue(turnCompleted, usage, 'total_tokens', 'derived', usageMissingReason),
      uncached_input_tokens: usageValue(
        turnCompleted,
        usage,
        'uncached_input_tokens',
        'derived',
        usageMissingReason
      )
    },
    unmapped_codex_events: events.filter((event) => event.kind === 'codex_event_unmapped').length
  }
}

export function evalRunTelemetryArtifactPath(eventLogPath: string): string {
  return join(dirname(eventLogPath), 'telemetry-v1.json')
}

function parseEventLog(text: string): EvalEvent[] {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => parseEvalEvent(JSON.parse(line)))
}

export async function persistEvalRunTelemetryArtifact(
  eventLogPath: string
): Promise<{ artifact: EvalRunTelemetryArtifact; path: string }> {
  const source = await readFile(eventLogPath, 'utf8')
  const events = parseEventLog(source)
  const runIds = new Set(events.map(({ run_id: runId }) => runId))
  const runId = events[0]?.run_id
  if (!runId || runIds.size !== 1) {
    throw new Error('Telemetry artifact requires one non-empty, single-run event log.')
  }
  const artifact: EvalRunTelemetryArtifact = {
    derived_at_ms: Date.now(),
    run_id: runId,
    schema_version: EVAL_RUN_TELEMETRY_ARTIFACT_SCHEMA_VERSION,
    source_event_count: events.length,
    source_event_log_path: eventLogPath,
    source_event_log_sha256: sha256(source),
    telemetry: deriveEvalRunTelemetry(events)
  }
  const path = evalRunTelemetryArtifactPath(eventLogPath)
  try {
    await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
  } catch (error) {
    if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'EEXIST') {
      throw error
    }
    const existing = await readEvalRunTelemetryArtifact(path)
    if (
      existing.run_id !== artifact.run_id ||
      existing.source_event_count !== artifact.source_event_count ||
      existing.source_event_log_path !== artifact.source_event_log_path ||
      existing.source_event_log_sha256 !== artifact.source_event_log_sha256 ||
      stableJson(existing.telemetry) !== stableJson(artifact.telemetry)
    ) {
      throw new Error('Existing telemetry artifact does not match the completed raw event log.')
    }
    return { artifact: existing, path }
  }
  return { artifact, path }
}

export async function readEvalRunTelemetryArtifact(
  path: string
): Promise<EvalRunTelemetryArtifact> {
  const value = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Telemetry artifact must be an object.')
  }
  if (Reflect.get(value, 'schema_version') !== EVAL_RUN_TELEMETRY_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `Telemetry artifact schema_version must be ${EVAL_RUN_TELEMETRY_ARTIFACT_SCHEMA_VERSION}.`
    )
  }
  const runId = Reflect.get(value, 'run_id')
  const eventLogPath = Reflect.get(value, 'source_event_log_path')
  const eventLogHash = Reflect.get(value, 'source_event_log_sha256')
  const eventCount = Reflect.get(value, 'source_event_count')
  if (typeof runId !== 'string' || !runId.trim()) throw new Error('Telemetry run_id is invalid.')
  if (typeof eventLogPath !== 'string' || !eventLogPath.trim()) {
    throw new Error('Telemetry source_event_log_path is invalid.')
  }
  if (typeof eventLogHash !== 'string' || !/^[a-f0-9]{64}$/u.test(eventLogHash)) {
    throw new Error('Telemetry source_event_log_sha256 is invalid.')
  }
  if (typeof eventCount !== 'number' || !Number.isInteger(eventCount) || eventCount < 1) {
    throw new Error('Telemetry source_event_count is invalid.')
  }
  return value as EvalRunTelemetryArtifact
}
