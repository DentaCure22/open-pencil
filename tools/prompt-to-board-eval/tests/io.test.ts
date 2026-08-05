import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  appendEvalEvent,
  createEvalLog,
  dispatchedEvent,
  EvalLogWriter,
  readEvalEvents
} from '../src/io'
import { createEvalEvent } from '../src/schema'

describe('append-only eval log', () => {
  test('refuses overwrite, run switches, sequence gaps, and backwards time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-eval-log-'))
    const path = join(directory, 'events.jsonl')
    await createEvalLog(path, dispatchedEvent('RUN-1', 'recorder-1', 100, 100, 'Build it.'))
    await expect(
      createEvalLog(path, dispatchedEvent('RUN-1', 'recorder-1', 100, 100, 'Build it.'))
    ).rejects.toThrow()
    await appendEvalEvent(
      path,
      createEvalEvent({
        data: {},
        kind: 'codex_turn_started',
        observed_at_ms: 101,
        observed_monotonic_ms: 101,
        precision_ms: 1,
        recorder_id: 'recorder-1',
        run_id: 'RUN-1',
        sequence: 1,
        source: 'codex'
      })
    )
    expect(await readEvalEvents(path)).toHaveLength(2)
    await expect(
      appendEvalEvent(
        path,
        createEvalEvent({
          data: {},
          kind: 'run_error',
          observed_at_ms: 99,
          observed_monotonic_ms: 102,
          precision_ms: 1,
          recorder_id: 'recorder-1',
          run_id: 'RUN-1',
          sequence: 2,
          source: 'orchestrator'
        })
      )
    ).rejects.toThrow('time cannot move backwards')
  })

  test('streams many events through one validated writer without rereading the log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-eval-writer-'))
    const path = join(directory, 'events.jsonl')
    const writer = await EvalLogWriter.create(
      path,
      dispatchedEvent('RUN-STREAM', 'recorder-1', 100, 100, 'Build it.')
    )
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      await writer.append(
        createEvalEvent({
          data: { sequence },
          kind: 'codex_turn_started',
          observed_at_ms: 100 + sequence,
          observed_monotonic_ms: 100 + sequence,
          precision_ms: 1,
          recorder_id: 'recorder-1',
          run_id: 'RUN-STREAM',
          sequence,
          source: 'codex'
        })
      )
    }
    expect(await readEvalEvents(path)).toHaveLength(51)
    await expect(
      writer.append(
        createEvalEvent({
          data: {},
          kind: 'run_error',
          observed_at_ms: 152,
          observed_monotonic_ms: 152,
          precision_ms: 1,
          recorder_id: 'recorder-1',
          run_id: 'RUN-STREAM',
          sequence: 52,
          source: 'orchestrator'
        })
      )
    ).rejects.toThrow('sequence must be 51')
  })

  test('serializes generated event batches with ordinary appends', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-eval-writer-batch-'))
    const path = join(directory, 'events.jsonl')
    const writer = await EvalLogWriter.create(
      path,
      dispatchedEvent('RUN-BATCH', 'recorder-1', 100, 100, 'Build it.')
    )
    const ordinary = writer.append(
      createEvalEvent({
        data: {},
        kind: 'codex_turn_started',
        observed_at_ms: 101,
        observed_monotonic_ms: 101,
        precision_ms: 1,
        recorder_id: 'recorder-1',
        run_id: 'RUN-BATCH',
        sequence: 1,
        source: 'codex'
      })
    )
    const generated = writer.appendGenerated((last) => ({
      events: [
        createEvalEvent({
          data: {},
          kind: 'pixel_witness_captured',
          observed_at_ms: 102,
          observed_monotonic_ms: 102,
          precision_ms: 1,
          recorder_id: last.recorder_id,
          run_id: last.run_id,
          sequence: last.sequence + 1,
          source: 'browser'
        })
      ],
      value: 'appended'
    }))

    expect(await generated).toBe('appended')
    await ordinary
    expect((await readEvalEvents(path)).map((event) => event.sequence)).toEqual([0, 1, 2])
  })
})
