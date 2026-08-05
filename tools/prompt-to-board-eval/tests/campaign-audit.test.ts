import { describe, expect, test } from 'bun:test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  executeCampaign,
  type CampaignExecutor,
  type CampaignRoster,
  type CampaignRunResult
} from '../src/campaign'
import { auditCampaignTruth } from '../src/campaign-audit'
import { dispatchedEvent, EvalLogWriter } from '../src/io'
import { createEvalEvent } from '../src/schema'
import {
  appendPassingEvidence,
  manifest,
  options,
  scenario,
  target,
  writePendingRun,
  writePendingRunWithRecoveredError,
  writePendingRunWithWrongRequest
} from '../src/testing/campaign-support'

async function finalizedCampaign() {
  const campaignOptions = options(
    manifest(scenario('S1', 'fresh')),
    [{ exact_target: target('page-A'), run_id: 'truth-1', scenario_id: 'S1' }],
    writePendingRun
  )
  campaignOptions.visibleProof = {
    collect: (context, sink) => appendPassingEvidence(context, sink)
  }
  const results = await executeCampaign(campaignOptions)
  const roster = JSON.parse(
    await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
  ) as CampaignRoster
  return { results, roster }
}

describe('campaign truth audit', () => {
  test('passes only when every rostered run reconciles to its raw log and terminal state', async () => {
    const { results, roster } = await finalizedCampaign()
    const report = await auditCampaignTruth(roster, results)

    expect(report.gate_passed).toBeTrue()
    expect(report.scheduled_total).toBe(1)
    expect(report.started_total).toBe(1)
    expect(report.counts.finalized).toBe(1)
    expect(report.discrepancies).toEqual([])
    const telemetryPath = results[0]?.telemetry_artifact_path
    expect(telemetryPath).toBeString()
    expect(JSON.parse(await readFile(telemetryPath ?? '', 'utf8'))).toMatchObject({
      run_id: 'truth-1',
      schema_version: 'prompt-to-board-run-telemetry/v1'
    })
    expect(report.observations[0]?.telemetry_artifact_path).toBe(telemetryPath)
  })

  test('rejects Board evidence that used a different request ID than the roster', async () => {
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'wrong-request', scenario_id: 'S1' }],
      writePendingRunWithWrongRequest
    )
    campaignOptions.allowPendingVisibleProof = true
    const results = await executeCampaign(campaignOptions)
    const roster = JSON.parse(
      await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
    ) as CampaignRoster

    const report = await auditCampaignTruth(roster, results)

    expect(report.gate_passed).toBeFalse()
    expect(report.discrepancies.map(({ code }) => code)).toContain(
      'board_request_identity_mismatch'
    )
  })

  test('rejects an artifact success with no Board evidence for its request ID', async () => {
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'missing-board', scenario_id: 'S1' }],
      async (input) => {
        await mkdir(dirname(input.eventLogPath), { recursive: true })
        const writer = await EvalLogWriter.create(
          input.eventLogPath,
          dispatchedEvent(
            input.runId,
            input.recorderId,
            Date.now(),
            performance.now(),
            input.prompt,
            {
              campaign_roster_id: input.campaignRosterId,
              config: {
                config_id: input.configuration.config_id,
                measurement_class: input.configuration.measurement_class
              },
              grader_version: input.configuration.evaluator.grader_version,
              rubric_id: input.rubricId,
              rubric_version: input.rubricVersion,
              scenario_fingerprint: input.scenarioFingerprint,
              scenario_id: input.scenarioId,
              source_snapshot: input.configuration.source
            }
          )
        )
        await writer.append(
          createEvalEvent({
            data: { text: 'Claimed success without a Board result.' },
            kind: 'agent_message_completed',
            observed_at_ms: Date.now(),
            observed_monotonic_ms: performance.now(),
            precision_ms: 1,
            recorder_id: input.recorderId,
            run_id: input.runId,
            sequence: 1,
            source: 'codex'
          })
        )
        return { exitCode: 0, status: 'recorded' as const, threadId: 'thread-missing-board' }
      }
    )
    campaignOptions.allowPendingVisibleProof = true
    const results = await executeCampaign(campaignOptions)
    const roster = JSON.parse(
      await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
    ) as CampaignRoster

    const report = await auditCampaignTruth(roster, results)

    expect(report.gate_passed).toBeFalse()
    expect(report.discrepancies.map(({ code }) => code)).toContain(
      'board_request_identity_mismatch'
    )
  })

  test('accepts one verified straight-through release without a fabricated model final', async () => {
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'straight-through', scenario_id: 'S1' }],
      async (input) => {
        const exactTarget = input.exactTarget
        if (!exactTarget || !input.boardRequestId) throw new Error('Expected exact run identity.')
        await mkdir(dirname(input.eventLogPath), { recursive: true })
        const writer = await EvalLogWriter.create(
          input.eventLogPath,
          dispatchedEvent(
            input.runId,
            input.recorderId,
            Date.now(),
            performance.now(),
            input.prompt,
            {
              campaign_roster_id: input.campaignRosterId,
              config: {
                config_id: input.configuration.config_id,
                measurement_class: input.configuration.measurement_class
              },
              grader_version: input.configuration.evaluator.grader_version,
              rubric_id: input.rubricId,
              rubric_version: input.rubricVersion,
              scenario_fingerprint: input.scenarioFingerprint,
              scenario_id: input.scenarioId,
              source_snapshot: input.configuration.source
            }
          )
        )
        const event = (
          sequence: number,
          kind: Parameters<typeof createEvalEvent>[0]['kind'],
          data: Record<string, unknown>,
          source: Parameters<typeof createEvalEvent>[0]['source']
        ) =>
          createEvalEvent({
            data,
            kind,
            observed_at_ms: Date.now() + sequence,
            observed_monotonic_ms: performance.now() + sequence,
            precision_ms: 1,
            recorder_id: input.recorderId,
            run_id: input.runId,
            sequence,
            source
          })
        for (const candidate of [
          event(1, 'agent_message_completed', { text: 'Using the guarded builder.' }, 'codex'),
          event(2, 'command_started', { route: 'cli', semantic_command: 'build' }, 'codex'),
          event(
            3,
            'openpencil_result',
            { request_id: input.boardRequestId, target: exactTarget },
            'openpencil'
          ),
          event(
            4,
            'durability_confirmed',
            { current: true, request_id: input.boardRequestId, target: exactTarget },
            'openpencil'
          ),
          event(5, 'codex_raw_stream_closed', { intentional_termination: true }, 'orchestrator'),
          event(
            6,
            'final_response_released',
            {
              final_origin: 'board_build_release_summary',
              request_id: input.boardRequestId,
              target: exactTarget,
              text: 'Built one durable card.'
            },
            'orchestrator'
          )
        ]) {
          await writer.append(candidate)
        }
        return { exitCode: 0, status: 'recorded' as const, threadId: 'thread-direct' }
      }
    )
    campaignOptions.allowPendingVisibleProof = true
    const results = await executeCampaign(campaignOptions)
    const roster = JSON.parse(
      await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
    ) as CampaignRoster

    const report = await auditCampaignTruth(roster, results)

    expect(report.gate_passed).toBeTrue()
    expect(report.discrepancies).toEqual([])
  })

  test('keeps a scheduled run with no result or log in the denominator as never started', async () => {
    const { roster } = await finalizedCampaign()
    const rosterRun = roster.runs[0]
    if (!rosterRun) throw new Error('Expected a rostered run.')
    const neverStartedRoster: CampaignRoster = {
      ...roster,
      runs: [
        {
          ...rosterRun,
          event_log_path: `${rosterRun.event_log_path}.never-started`,
          run_id: 'never-started'
        }
      ]
    }

    const report = await auditCampaignTruth(neverStartedRoster, [])

    expect(report.gate_passed).toBeFalse()
    expect(report.scheduled_total).toBe(1)
    expect(report.started_total).toBe(0)
    expect(report.counts.never_started).toBe(1)
    expect(report.discrepancies.map(({ code }) => code)).toContain('missing_result')
  })

  test('classifies a retained log without a result as interrupted instead of dropping it', async () => {
    const { roster } = await finalizedCampaign()
    const report = await auditCampaignTruth(roster, [])

    expect(report.counts.interrupted).toBe(1)
    expect(report.started_total).toBe(1)
    expect(report.discrepancies.map(({ code }) => code)).toContain('missing_result')
  })

  test('rejects duplicate and identity-shifted results', async () => {
    const { results, roster } = await finalizedCampaign()
    const original = results[0]
    if (!original) throw new Error('Expected one result.')
    const shifted: CampaignRunResult = {
      ...original,
      config_id: 'shifted-config',
      scenario_id: 'shifted-scenario'
    }
    const report = await auditCampaignTruth(roster, [original, shifted])

    expect(report.gate_passed).toBeFalse()
    expect(report.discrepancies.map(({ code }) => code)).toContain('duplicate_result')
    expect(report.discrepancies.map(({ code }) => code)).toContain('result_identity_mismatch')
  })

  test('rejects a derived telemetry artifact that diverges from immutable raw events', async () => {
    const { results, roster } = await finalizedCampaign()
    const telemetryPath = results[0]?.telemetry_artifact_path
    if (!telemetryPath) throw new Error('Expected finalized telemetry artifact.')
    const artifact = JSON.parse(await readFile(telemetryPath, 'utf8'))
    await writeFile(
      telemetryPath,
      `${JSON.stringify({ ...artifact, source_event_count: artifact.source_event_count + 1 })}\n`
    )

    const report = await auditCampaignTruth(roster, results)

    expect(report.gate_passed).toBeFalse()
    expect(report.discrepancies.map(({ code }) => code)).toContain('telemetry_artifact_mismatch')
  })

  test('retains an executor exception as a failed raw-log event', async () => {
    const executor: CampaignExecutor = async () => {
      throw new Error('synthetic executor crash')
    }
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'crash-1', scenario_id: 'S1' }],
      executor
    )
    const results = await executeCampaign(campaignOptions)
    const roster = JSON.parse(
      await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
    ) as CampaignRoster
    const report = await auditCampaignTruth(roster, results)

    expect(results[0]?.status).toBe('failed')
    expect(report.gate_passed).toBeTrue()
    expect(report.counts.failed).toBe(1)
    expect(report.counts.unlogged_failure).toBe(0)
  })

  test('rejects a result status that contradicts the raw terminal events', async () => {
    const { results, roster } = await finalizedCampaign()
    const original = results[0]
    if (!original) throw new Error('Expected one result.')
    const report = await auditCampaignTruth(roster, [{ ...original, status: 'recorded' }])

    expect(report.gate_passed).toBeFalse()
    expect(report.discrepancies.map(({ code }) => code)).toContain('terminal_event_mismatch')
  })

  test('treats append-only visible finalization as newer truth than a pending executor result', async () => {
    const { results, roster } = await finalizedCampaign()
    const original = results[0]
    if (!original) throw new Error('Expected one result.')

    const report = await auditCampaignTruth(roster, [{ ...original, status: 'pending_proof' }])

    expect(report.gate_passed).toBeTrue()
    expect(report.counts.finalized).toBe(1)
    expect(report.observations[0]?.result_status).toBe('pending_proof')
    expect(report.observations[0]?.state).toBe('finalized')
  })

  test('keeps recovered pre-final errors visible without misclassifying a proved run', async () => {
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'recovered-1', scenario_id: 'S1' }],
      writePendingRunWithRecoveredError
    )
    campaignOptions.visibleProof = {
      collect: (context, sink) => appendPassingEvidence(context, sink)
    }
    const results = await executeCampaign(campaignOptions)
    const roster = JSON.parse(
      await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
    ) as CampaignRoster

    const report = await auditCampaignTruth(roster, results)

    expect(report.gate_passed).toBeTrue()
    expect(report.counts.finalized).toBe(1)
    expect(report.discrepancies).toEqual([])
  })
})
