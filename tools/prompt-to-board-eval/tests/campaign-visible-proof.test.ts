import { describe, expect, test } from 'bun:test'

import { executeCampaign, type CampaignExecutor } from '../src/campaign'
import { readEvalEvents } from '../src/io'
import {
  appendPassingEvidence,
  configuration,
  manifest,
  options,
  scenario,
  target,
  writePendingRun
} from '../src/testing/campaign-support'

describe('prompt-to-Board campaign visible proof', () => {
  test('rejects strict visible runs configured headless while allowing optional runs', async () => {
    const executor: CampaignExecutor = async () => ({
      exitCode: 0,
      status: 'recorded',
      threadId: 'thread-1'
    })
    const strictScenario = {
      ...scenario('VISIBLE', 'fresh'),
      visibility: 'required' as const
    }
    const strictOptions = options(
      manifest(strictScenario),
      [{ exact_target: target('page-A'), run_id: 'strict-headless', scenario_id: 'VISIBLE' }],
      executor
    )
    const strictRun = strictOptions.runs[0]
    if (!strictRun) throw new Error('Expected one strict campaign run.')
    strictOptions.runs[0] = {
      ...strictRun,
      configuration: configuration('fresh', target('page-A'), false)
    }
    await expect(executeCampaign(strictOptions)).rejects.toThrow(
      'requires visible proof but its frozen configuration is headless'
    )

    const missingCollectorOptions = options(
      manifest(strictScenario),
      [{ exact_target: target('page-A'), run_id: 'strict-no-collector', scenario_id: 'VISIBLE' }],
      executor
    )
    await expect(executeCampaign(missingCollectorOptions)).rejects.toThrow(
      'requires a visible proof collector or explicit generation-only opt-in'
    )

    const optionalScenario = { ...scenario('OPTIONAL', 'fresh'), visibility: 'optional' as const }
    const optionalOptions = options(
      manifest(optionalScenario),
      [{ exact_target: target('page-A'), run_id: 'optional-headless', scenario_id: 'OPTIONAL' }],
      executor
    )
    const optionalRun = optionalOptions.runs[0]
    if (!optionalRun) throw new Error('Expected one optional campaign run.')
    optionalOptions.runs[0] = {
      ...optionalRun,
      configuration: configuration('fresh', target('page-A'), false)
    }
    expect((await executeCampaign(optionalOptions))[0]?.status).toBe('recorded')

    const forbiddenScenario = {
      ...scenario('FORBIDDEN', 'fresh'),
      visibility: 'forbidden' as const
    }
    const forbiddenOptions = options(
      manifest(forbiddenScenario),
      [{ exact_target: target('page-A'), run_id: 'forbidden-browser', scenario_id: 'FORBIDDEN' }],
      executor
    )
    await expect(executeCampaign(forbiddenOptions)).rejects.toThrow(
      'forbids visible proof but its frozen configuration requires a browser'
    )
  })

  test('keeps visible output pending until independent proof and blocks warm continuation', async () => {
    let calls = 0
    const executor: CampaignExecutor = async () => {
      calls += 1
      return { exitCode: 0, status: 'pending_proof', threadId: 'thread-pending' }
    }
    const first = { ...scenario('W1', 'warm'), visibility: 'required' as const }
    const second = { ...scenario('W2', 'warm'), visibility: 'required' as const }
    const campaignOptions = options(
      manifest(first, second),
      [
        {
          exact_target: target('page-A'),
          run_id: 'warm-pending-1',
          scenario_id: 'W1',
          warm_session_id: 'session-pending'
        },
        {
          exact_target: target('page-B'),
          run_id: 'warm-pending-2',
          scenario_id: 'W2',
          warm_session_id: 'session-pending'
        }
      ],
      executor
    )
    campaignOptions.allowPendingVisibleProof = true
    const results = await executeCampaign(campaignOptions)

    expect(calls).toBe(1)
    expect(results.map(({ status }) => status)).toEqual(['pending_proof', 'skipped'])
    expect(results[0]?.error).toBeNull()
    expect(results[1]?.error).toBe('Previous warm-session run is still pending independent proof.')
  })

  test('awaits exact independent proof before completing and resuming a warm session', async () => {
    const observed: string[] = []
    let firstLogPath: string | null = null
    const executor: CampaignExecutor = async (input) => {
      if (input.runId === 'warm-proof-2' && firstLogPath) {
        const previous = await readEvalEvents(firstLogPath)
        observed.push(`previous:${previous.at(-1)?.kind}`)
      }
      observed.push(`execute:${input.runId}:${input.resumeThreadId ?? 'fresh'}`)
      if (input.runId === 'warm-proof-1') firstLogPath = input.eventLogPath
      return writePendingRun(input)
    }
    const campaignOptions = options(
      manifest(scenario('W1', 'warm'), scenario('W2', 'warm')),
      [
        {
          exact_target: target('page-A'),
          run_id: 'warm-proof-1',
          scenario_id: 'W1',
          warm_session_id: 'session-proof'
        },
        {
          exact_target: target('page-B'),
          run_id: 'warm-proof-2',
          scenario_id: 'W2',
          warm_session_id: 'session-proof'
        }
      ],
      executor
    )
    campaignOptions.visibleProof = {
      collect: async (context, sink) => {
        expect(Object.isFrozen(context)).toBeTrue()
        expect(Object.isFrozen(context.configuration)).toBeTrue()
        expect(Object.isFrozen(context.exact_target)).toBeTrue()
        observed.push(`collect:${context.run_id}:${context.exact_target.page_id}`)
        await appendPassingEvidence(context, sink)
      }
    }

    const results = await executeCampaign(campaignOptions)

    expect(results.map(({ status }) => status)).toEqual(['finalized', 'finalized'])
    expect(observed).toEqual([
      'execute:warm-proof-1:fresh',
      'collect:warm-proof-1:page-A',
      'previous:final_response_released',
      'execute:warm-proof-2:thread-warm-proof-1',
      'collect:warm-proof-2:page-B'
    ])
    for (const result of results) {
      const events = await readEvalEvents(result.event_log_path)
      expect(events.filter(({ kind }) => kind === 'final_response_released')).toHaveLength(1)
      expect(events.at(-1)?.kind).toBe('final_response_released')
    }
  })

  test('counts independent proof failure as a failed first attempt', async () => {
    const executor: CampaignExecutor = writePendingRun
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'proof-failure', scenario_id: 'S1' }],
      executor
    )
    campaignOptions.visibleProof = {
      collect: async () => {
        throw new Error('pixel witness missing')
      }
    }

    const [result] = await executeCampaign(campaignOptions)

    expect(result).toMatchObject({
      error: 'Visible proof failed: pixel witness missing',
      exit_code: 0,
      status: 'failed'
    })
    if (!result) throw new Error('Expected failed campaign result.')
    const events = await readEvalEvents(result.event_log_path)
    expect(events.at(-1)?.kind).toBe('run_error')
    expect(events.at(-1)?.data).toMatchObject({
      code: 'visible_proof_failed',
      error: 'pixel witness missing',
      stage: 'visible_proof'
    })
    expect(events.some(({ kind }) => kind === 'final_response_released')).toBeFalse()
  })

  test('serializes different visible targets through one browser proof lane', async () => {
    const activeLifecycles = new Set<string>()
    const observed: string[] = []
    const executor: CampaignExecutor = async (input) => {
      expect(activeLifecycles.size).toBe(0)
      activeLifecycles.add(input.runId)
      observed.push(`execute:${input.runId}`)
      return writePendingRun(input)
    }
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh'), scenario('S2', 'fresh')),
      [
        { exact_target: target('page-A'), run_id: 'visible-A', scenario_id: 'S1' },
        { exact_target: target('page-B'), run_id: 'visible-B', scenario_id: 'S2' }
      ],
      executor
    )
    campaignOptions.visibleProof = {
      collect: async (context, sink) => {
        expect(activeLifecycles.has(context.run_id)).toBeTrue()
        observed.push(`collect:${context.run_id}`)
        await appendPassingEvidence(context, sink)
        activeLifecycles.delete(context.run_id)
      }
    }

    const results = await executeCampaign(campaignOptions)

    expect(results.map(({ status }) => status)).toEqual(['finalized', 'finalized'])
    expect(observed).toEqual([
      'execute:visible-A',
      'collect:visible-A',
      'execute:visible-B',
      'collect:visible-B'
    ])
    expect(activeLifecycles.size).toBe(0)
  })
})
