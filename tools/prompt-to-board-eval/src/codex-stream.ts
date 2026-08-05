import { parseCliOpenPencilOutput, projectOpenPencilResult } from './openpencil-result'
import { createEvalEvent, type EvalEvent } from './schema'

interface ObservedClock {
  epochMs: number
  monotonicMs: number
}

type Clock = () => ObservedClock

interface CodexStreamProjectorOptions {
  clock?: Clock
  initialSequence?: number
  recorderId: string
  runId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
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

function canonicalJsonBytes(value: unknown): number | null {
  const serialized = JSON.stringify(stableValue(value))
  return serialized === undefined ? null : Buffer.byteLength(serialized, 'utf8')
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function normalizedUsage(value: unknown): Record<string, number | null> | null {
  const usage = record(value)
  if (!usage) return null
  const inputTokens = tokenCount(usage.input_tokens)
  const cachedInputTokens = tokenCount(usage.cached_input_tokens)
  const outputTokens = tokenCount(usage.output_tokens)
  const reasoningOutputTokens = tokenCount(usage.reasoning_output_tokens)
  const cacheWriteInputTokens = tokenCount(usage.cache_write_input_tokens)
  const uncachedInputTokens =
    inputTokens !== null && cachedInputTokens !== null && cachedInputTokens <= inputTokens
      ? inputTokens - cachedInputTokens
      : null
  return {
    cache_write_input_tokens: cacheWriteInputTokens,
    cached_input_tokens: cachedInputTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    total_tokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    uncached_input_tokens: uncachedInputTokens
  }
}

export function openPencilSemanticCommand(command: string): string | null {
  const normalized = command.replaceAll('\\\n', ' ').replaceAll(/\s+/g, ' ').trim()
  const match = normalized.match(
    /(?:openpencil-cli\.sh|bun\s+open-pencil|openpencil)\s+board\s+(list|create|open|context|build|edit|connect|read|present|verify)\b/
  )
  if (match?.index !== undefined) {
    const argumentsText = normalized.slice(match.index + match[0].length)
    if (/^\s+(?:--help|-h)(?:\s|$|['";|&])/u.test(argumentsText)) return null
  }
  return match?.[1] ?? null
}

export class CodexStreamProjector {
  readonly #clock: Clock
  readonly #runId: string
  readonly #recorderId: string
  #sequence: number

  constructor(options: CodexStreamProjectorOptions) {
    this.#clock = options.clock ?? (() => ({ epochMs: Date.now(), monotonicMs: performance.now() }))
    this.#runId = options.runId
    this.#recorderId = options.recorderId
    this.#sequence = options.initialSequence ?? 1
  }

  get nextSequence(): number {
    return this.#sequence
  }

  projectLine(line: string): EvalEvent[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return [this.#event('run_error', { code: 'invalid_codex_jsonl', line })]
    }
    const raw = record(parsed)
    const type = string(raw?.type)
    if (!raw || !type)
      return [this.#event('run_error', { code: 'invalid_codex_event', raw: parsed })]

    return this.#projectEvent(type, raw)
  }

  #projectEvent(type: string, raw: Record<string, unknown>): EvalEvent[] {
    if (type === 'thread.started') {
      return [this.#event('codex_thread_started', { raw_event: raw, thread_id: raw.thread_id })]
    }
    if (type === 'turn.started') return [this.#event('codex_turn_started', { raw_event: raw })]
    if (type === 'turn.completed') {
      return [
        this.#event('codex_turn_completed', {
          raw_event: raw,
          usage: normalizedUsage(raw.usage),
          usage_scope: 'codex_thread_total'
        })
      ]
    }
    if (type === 'turn.failed' || type === 'error') {
      return [this.#event('run_error', { code: type, raw })]
    }
    if (type !== 'item.started' && type !== 'item.completed') {
      return [
        this.#event('codex_event_unmapped', {
          codex_event_type: type,
          item_type: null,
          raw_event: raw,
          reason: 'unsupported_top_level_event'
        })
      ]
    }

    const item = record(raw.item)
    if (!item) {
      return [
        this.#event('codex_event_unmapped', {
          codex_event_type: type,
          item_type: null,
          raw_event: raw,
          reason: 'missing_item_record'
        })
      ]
    }
    return this.#projectItem(type, raw, item)
  }

  #projectItem(
    type: 'item.started' | 'item.completed',
    raw: Record<string, unknown>,
    item: Record<string, unknown>
  ): EvalEvent[] {
    const itemType = string(item.type)
    if (itemType === 'agent_message' && type === 'item.completed') {
      return [
        this.#event('agent_message_completed', {
          item_id: string(item.id) ?? null,
          raw_event: raw,
          text: string(item.text) ?? '',
          text_bytes: utf8Bytes(string(item.text) ?? ''),
          text_encoding: 'utf8'
        })
      ]
    }
    if (itemType === 'mcp_tool_call') return this.#projectMcpItem(type, raw, item)
    if (itemType !== 'command_execution') {
      return [
        this.#event('codex_event_unmapped', {
          codex_event_type: type,
          item_id: string(item.id) ?? null,
          item_type: itemType ?? null,
          raw_event: raw,
          reason: 'unsupported_item_type'
        })
      ]
    }

    return this.#projectCommandItem(type, raw, item)
  }

  #projectMcpItem(
    type: 'item.started' | 'item.completed',
    raw: Record<string, unknown>,
    item: Record<string, unknown>
  ): EvalEvent[] {
    const tool = string(item.tool) ?? ''
    const server = string(item.server) ?? ''
    const semanticCommand = server.toLowerCase().includes('openpencil') ? tool : null
    const data = {
      argument_bytes: canonicalJsonBytes(item.arguments ?? null),
      argument_encoding: 'canonical-json/utf8',
      arguments: item.arguments ?? null,
      item_id: string(item.id) ?? null,
      raw_event: raw,
      route: 'mcp',
      semantic_command: semanticCommand,
      server,
      status: string(item.status) ?? null,
      tool
    }
    if (type === 'item.started') return [this.#event('command_started', data)]

    const events = [
      this.#event('command_completed', {
        ...data,
        error: item.error ?? null,
        result: item.result ?? null,
        result_bytes: canonicalJsonBytes(item.result ?? null),
        result_encoding: 'canonical-json/utf8'
      })
    ]
    this.#appendProjectedResults(events, semanticCommand, item.result)
    if (semanticCommand === 'board_context' && string(item.status) === 'completed') {
      events.push(
        this.#event('board_context_completed', { item_id: item.id ?? null, route: 'mcp' })
      )
    }
    return events
  }

  #projectCommandItem(
    type: 'item.started' | 'item.completed',
    raw: Record<string, unknown>,
    item: Record<string, unknown>
  ): EvalEvent[] {
    const command = string(item.command) ?? ''
    const semanticCommand = openPencilSemanticCommand(command)
    const data = {
      argument_bytes: utf8Bytes(command),
      argument_encoding: 'utf8',
      command,
      item_id: string(item.id) ?? null,
      raw_event: raw,
      route: 'cli',
      semantic_command: semanticCommand,
      status: string(item.status) ?? null
    }
    if (type === 'item.started') return [this.#event('command_started', data)]

    const aggregatedOutput = string(item.aggregated_output) ?? ''
    const events = [
      this.#event('command_completed', {
        ...data,
        aggregated_output: aggregatedOutput,
        exit_code: number(item.exit_code) ?? null,
        result_bytes: utf8Bytes(aggregatedOutput),
        result_encoding: 'utf8'
      })
    ]
    const parsedOutput = parseCliOpenPencilOutput(item.aggregated_output)
    if (semanticCommand && !parsedOutput) {
      events.push(
        this.#event('run_error', {
          code: 'unstructured_openpencil_cli_output',
          item_id: item.id ?? null,
          semantic_command: semanticCommand
        })
      )
      return events
    }
    this.#appendProjectedResults(events, semanticCommand, parsedOutput)
    if (semanticCommand === 'context' && number(item.exit_code) === 0) {
      events.push(this.#event('board_context_completed', { command, item_id: item.id ?? null }))
    }
    return events
  }

  #appendProjectedResults(
    events: EvalEvent[],
    semanticCommand: string | null,
    result: unknown
  ): void {
    for (const projected of projectOpenPencilResult(semanticCommand, result)) {
      events.push(this.#event(projected.kind, projected.data))
    }
  }

  #event(kind: EvalEvent['kind'], data: Record<string, unknown>): EvalEvent {
    const observed = this.#clock()
    const event = createEvalEvent({
      data,
      kind,
      observed_at_ms: observed.epochMs,
      observed_monotonic_ms: observed.monotonicMs,
      precision_ms: 1,
      recorder_id: this.#recorderId,
      run_id: this.#runId,
      sequence: this.#sequence,
      source: 'codex'
    })
    this.#sequence += 1
    return event
  }
}
