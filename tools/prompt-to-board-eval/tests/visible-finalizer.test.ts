import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatchedEvent, EvalLogWriter, readEvalEvents, type EvalLogAppendSink } from '../src/io'
import { createEvalEvent, type EvalEvent, type EvalTarget } from '../src/schema'
import {
  finalizeVisibleRun,
  VisibleFinalizationError,
  type VisibleFinalizationOptions
} from '../src/visible-finalizer'

const CONFIG_ID = 'a'.repeat(64)
const SCREENSHOT_HASH = 'b'.repeat(64)
const EVIDENCE_HASH = 'c'.repeat(64)
const TARGET: EvalTarget = {
  content_document_id: 'content-1',
  document_id: 'document-1',
  page_id: 'page-1',
  runtime_instance_id: 'runtime-1',
  workspace_id: 'workspace-1'
}

function event(
  sequence: number,
  kind: EvalEvent['kind'],
  data: Record<string, unknown>,
  source: EvalEvent['source'] = 'openpencil'
): EvalEvent {
  return createEvalEvent({
    data,
    kind,
    observed_at_ms: 100 + sequence * 10,
    observed_monotonic_ms: 100 + sequence * 10,
    precision_ms: 1,
    recorder_id: 'recorder-1',
    run_id: 'RUN-1',
    sequence,
    source
  })
}

async function pendingLog(deadline = 1_000, recoveredRunError = false): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'visible-finalizer-'))
  const path = join(directory, 'events.jsonl')
  const writer = await EvalLogWriter.create(
    path,
    dispatchedEvent('RUN-1', 'recorder-1', 100, 100, 'Build it.', {
      campaign_roster_id: 'd'.repeat(64),
      config: { config_id: CONFIG_ID, measurement_class: 'open_ended_cold' },
      grader_version: 'grader/v1',
      rubric_id: 'rubric-1',
      rubric_version: '1',
      scenario_fingerprint: 'e'.repeat(64),
      scenario_id: 'scenario-1',
      source_snapshot: {
        commit: 'abc',
        dirty: false,
        dirty_diff_hash: 'clean',
        dirty_files: []
      }
    })
  )
  const text = 'The artifact is ready.'
  const generatedSequence = recoveredRunError ? 5 : 4
  const generatedAtMs = 100 + generatedSequence * 10
  for (const item of [
    event(1, 'openpencil_result', { owner_id: '0:1', request_id: 'req-1', target: TARGET }),
    event(2, 'render_acknowledged', { acknowledged: true, target: TARGET }),
    event(3, 'durability_confirmed', { current: true, target: TARGET }),
    ...(recoveredRunError
      ? [event(4, 'run_error', { code: 'recoverable_tool_error' }, 'codex')]
      : []),
    event(generatedSequence, 'agent_message_completed', { text }, 'codex'),
    event(
      generatedSequence + 1,
      'run_pending_proof',
      {
        config_id: CONFIG_ID,
        expected_target: TARGET,
        generated_at_ms: generatedAtMs,
        generated_event_sequence: generatedSequence,
        generated_sha256: createHash('sha256').update(text).digest('hex'),
        proof_deadline_at_ms: deadline,
        required_evidence: ['pixel', 'semantic', 'durability']
      },
      'orchestrator'
    )
  ]) {
    await writer.append(item)
  }
  return path
}

async function appendPassingEvidence(sink: EvalLogAppendSink): Promise<void> {
  await sink.appendGenerated((last) => ({
    events: [
      event(
        last.sequence + 1,
        'pixel_witness_captured',
        {
          artifact_visible: true,
          screenshot_path: '/tmp/proof.png',
          screenshot_sha256: SCREENSHOT_HASH,
          target: TARGET,
          visible_at_ms: 160
        },
        'browser'
      ),
      event(
        last.sequence + 2,
        'semantic_review_completed',
        {
          evidence_sha256: EVIDENCE_HASH,
          quality_passed: true,
          rubric_id: 'rubric-1',
          rubric_version: '1',
          scenario_id: 'scenario-1',
          scenario_version: 'e'.repeat(64),
          target: TARGET
        },
        'reviewer'
      )
    ],
    value: undefined
  }))
}

function options(path: string): VisibleFinalizationOptions {
  return {
    appendEvidence: appendPassingEvidence,
    clock: () => ({ epochMs: 900, monotonicMs: 900 }),
    eventLogPath: path,
    expectedConfigId: CONFIG_ID,
    expectedTarget: TARGET
  }
}

describe('two-phase visible finalization', () => {
  test('appends proof before releasing exactly one claim-bearing final', async () => {
    const path = await pendingLog()
    const result = await finalizeVisibleRun(options(path))
    const events = await readEvalEvents(path)

    expect(result).toEqual({
      finalText: 'The artifact is ready.',
      generatedAtMs: 140,
      originalProofDeadlineAtMs: 1_000,
      releasedAfterOriginalDeadlineMs: 0,
      releasedAtMs: 900,
      safetyTimeoutMs: 45 * 60_000
    })
    expect(events.map(({ kind }) => kind).slice(-4)).toEqual([
      'run_pending_proof',
      'pixel_witness_captured',
      'semantic_review_completed',
      'final_response_released'
    ])
    expect(events.at(-1)?.data).toMatchObject({ generated_at_ms: 140, released_at_ms: 900 })
    expect(events.filter(({ kind }) => kind === 'final_response_released')).toHaveLength(1)
    await expect(finalizeVisibleRun(options(path))).rejects.toMatchObject({
      code: 'already_finalized'
    })
  })

  test('treats the original proof deadline as latency telemetry', async () => {
    const path = await pendingLog(800)
    const result = await finalizeVisibleRun(options(path))
    const released = (await readEvalEvents(path)).at(-1)

    expect(result.releasedAfterOriginalDeadlineMs).toBe(100)
    expect(released?.data).toMatchObject({
      original_proof_deadline_at_ms: 800,
      released_after_original_deadline_ms: 100
    })
  })

  test('accepts repeated exact-target durability checkpoints and validates the latest one', async () => {
    const path = await pendingLog()
    const writer = await EvalLogWriter.open(path)
    await writer.append(
      event(6, 'durability_confirmed', {
        current: true,
        request_id: 'req-2',
        target: TARGET
      })
    )

    await expect(finalizeVisibleRun(options(path))).resolves.toMatchObject({
      finalText: 'The artifact is ready.'
    })
  })

  test('accepts repeated exact-target render acknowledgements and validates the latest one', async () => {
    const path = await pendingLog()
    const writer = await EvalLogWriter.open(path)
    await writer.append(
      event(6, 'render_acknowledged', {
        acknowledged: true,
        target: TARGET
      })
    )

    await expect(finalizeVisibleRun(options(path))).resolves.toMatchObject({
      finalText: 'The artifact is ready.'
    })
  })

  test('preserves a recovered pre-final run error without erasing later proof', async () => {
    const path = await pendingLog(1_000, true)

    await expect(finalizeVisibleRun(options(path))).resolves.toMatchObject({
      finalText: 'The artifact is ready.',
      generatedAtMs: 150
    })
    expect((await readEvalEvents(path)).filter(({ kind }) => kind === 'run_error')).toHaveLength(1)
  })

  test('fails closed on a terminal run error after proof buffering', async () => {
    const path = await pendingLog()
    const writer = await EvalLogWriter.open(path)
    await writer.append(event(6, 'run_error', { code: 'terminal_error' }, 'orchestrator'))

    await expect(finalizeVisibleRun(options(path))).rejects.toMatchObject({
      code: 'run_failed'
    })
  })

  test('fails closed only after the configured no-progress safety timeout', async () => {
    const path = await pendingLog(800)
    await expect(
      finalizeVisibleRun({ ...options(path), safetyTimeoutMs: 700 })
    ).rejects.toMatchObject({ code: 'proof_timeout' })
    expect((await readEvalEvents(path)).map(({ kind }) => kind).at(-1)).toBe('run_pending_proof')
  })

  test('fails closed on stale config before appending proof', async () => {
    const path = await pendingLog()
    await expect(
      finalizeVisibleRun({ ...options(path), expectedConfigId: 'f'.repeat(64) })
    ).rejects.toMatchObject({ code: 'config_mismatch' })
    expect((await readEvalEvents(path)).map(({ kind }) => kind).at(-1)).toBe('run_pending_proof')
  })

  test('fails closed on the wrong exact target before appending proof', async () => {
    const path = await pendingLog()
    const wrongTarget = { ...TARGET, page_id: 'page-other' }
    try {
      await finalizeVisibleRun({ ...options(path), expectedTarget: wrongTarget })
      throw new Error('Expected target mismatch.')
    } catch (error) {
      expect(error).toBeInstanceOf(VisibleFinalizationError)
      expect((error as VisibleFinalizationError).code).toBe('target_mismatch')
    }
    expect((await readEvalEvents(path)).map(({ kind }) => kind).at(-1)).toBe('run_pending_proof')
  })

  test('keeps the generated final buffered when required evidence is missing', async () => {
    const path = await pendingLog()
    await expect(
      finalizeVisibleRun({ ...options(path), appendEvidence: async () => undefined })
    ).rejects.toMatchObject({ code: 'evidence_incomplete' })
    expect((await readEvalEvents(path)).map(({ kind }) => kind).at(-1)).toBe('run_pending_proof')
  })
})
