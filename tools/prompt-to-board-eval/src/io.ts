import { appendFile, readFile, writeFile } from 'node:fs/promises'

import type { EvaluationConfigIdentity, EvaluationConfiguration } from './evaluation-config'
import {
  createEvalEvent,
  parseEvalEvent,
  type EvalContextInventory,
  type EvalEvent
} from './schema'

export interface EvalDispatchEvidence {
  campaign_roster_id: string
  config: EvaluationConfigIdentity
  context_inventory?: EvalContextInventory
  grader_version: string
  rubric_id: string
  rubric_version: string
  scenario_fingerprint: string
  scenario_id: string
  source_snapshot: EvaluationConfiguration['source']
}

export interface EvalLogGeneratedBatch<T> {
  events: readonly EvalEvent[]
  value: T
}

export interface EvalLogAppendSink {
  appendGenerated<T>(
    factory: (
      last: Readonly<EvalEvent>
    ) => EvalLogGeneratedBatch<T> | Promise<EvalLogGeneratedBatch<T>>
  ): Promise<T>
}

export async function readEvalEvents(path: string): Promise<EvalEvent[]> {
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => parseEvalEvent(JSON.parse(line)))
}

export async function createEvalLog(path: string, event: EvalEvent): Promise<void> {
  await writeFile(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8', flag: 'wx' })
}

function validateAppend(last: EvalEvent | undefined, event: EvalEvent): void {
  if (last && event.run_id !== last.run_id) throw new Error('Eval event run_id does not match log.')
  if (last && event.sequence !== last.sequence + 1) {
    throw new Error(`Eval event sequence must be ${last.sequence + 1}.`)
  }
  if (last && event.observed_at_ms < last.observed_at_ms) {
    throw new Error('Eval event time cannot move backwards.')
  }
}

export class EvalLogWriter {
  readonly #path: string
  #last: EvalEvent
  #pending: Promise<void> = Promise.resolve()

  private constructor(path: string, initial: EvalEvent) {
    this.#path = path
    this.#last = initial
  }

  static async create(path: string, initial: EvalEvent): Promise<EvalLogWriter> {
    await createEvalLog(path, initial)
    return new EvalLogWriter(path, initial)
  }

  static async open(path: string): Promise<EvalLogWriter> {
    const events = await readEvalEvents(path)
    const initial = events.at(0)
    if (!initial) throw new Error('Eval log writer requires an existing non-empty log.')
    let previous: EvalEvent | undefined
    for (const event of events) {
      validateAppend(previous, event)
      previous = event
    }
    const last = events.at(-1)
    if (!last) throw new Error('Eval log writer requires an existing non-empty log.')
    return new EvalLogWriter(path, last)
  }

  append(event: EvalEvent): Promise<void> {
    return this.#enqueue(async () => {
      validateAppend(this.#last, event)
      await appendFile(this.#path, `${JSON.stringify(event)}\n`, 'utf8')
      this.#last = event
    })
  }

  appendGenerated<T>(
    factory: (
      last: Readonly<EvalEvent>
    ) => EvalLogGeneratedBatch<T> | Promise<EvalLogGeneratedBatch<T>>
  ): Promise<T> {
    return this.#enqueue(async () => {
      const batch = await factory(this.#last)
      let previous = this.#last
      for (const event of batch.events) {
        validateAppend(previous, event)
        previous = event
      }
      if (batch.events.length > 0) {
        await appendFile(
          this.#path,
          batch.events.map((event) => `${JSON.stringify(event)}\n`).join(''),
          'utf8'
        )
        this.#last = previous
      }
      return batch.value
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation)
    this.#pending = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export async function appendEvalEvent(path: string, event: EvalEvent): Promise<void> {
  const events = await readEvalEvents(path)
  const last = events.at(-1)
  validateAppend(last, event)
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8')
}

export function dispatchedEvent(
  runId: string,
  recorderId: string,
  observedAtMs: number,
  observedMonotonicMs: number,
  prompt: string,
  evidence?: EvalDispatchEvidence
): EvalEvent {
  return createEvalEvent({
    data: { prompt, ...evidence },
    kind: 'run_dispatched',
    observed_at_ms: observedAtMs,
    observed_monotonic_ms: observedMonotonicMs,
    precision_ms: 1,
    recorder_id: recorderId,
    run_id: runId,
    sequence: 0,
    source: 'orchestrator'
  })
}
