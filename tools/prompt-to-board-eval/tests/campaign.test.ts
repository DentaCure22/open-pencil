import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  executeCampaign,
  parseCampaignRunPlans,
  type CampaignExecutor,
  type CampaignExecutorInput,
  type CampaignRoster
} from '../src/campaign'
import { configuration, manifest, options, scenario, target } from '../src/testing/campaign-support'

describe('prompt-to-Board campaign scheduler', () => {
  test('parses complete run plans and rejects malformed batch input', () => {
    const exactTarget = target('page-A')
    const parsed = parseCampaignRunPlans([
      {
        configuration: configuration('fresh', exactTarget),
        exact_target: exactTarget,
        recovery_of_run_id: 'batch-root',
        run_id: 'batch-1',
        scenario_id: 'S1'
      }
    ])

    expect(parsed[0]).toMatchObject({
      exact_target: exactTarget,
      recovery_of_run_id: 'batch-root',
      run_id: 'batch-1',
      scenario_id: 'S1'
    })
    expect(() => parseCampaignRunPlans([])).toThrow('non-empty array')
    expect(() =>
      parseCampaignRunPlans([{ configuration: {}, run_id: 'bad', scenario_id: 'S1' }])
    ).toThrow()
    expect(() =>
      parseCampaignRunPlans([
        {
          configuration: configuration('fresh', exactTarget),
          recovery_of_run_id: ' ',
          run_id: 'bad-recovery',
          scenario_id: 'S1'
        }
      ])
    ).toThrow('recovery_of_run_id')
  })

  test('runs distinct targets in parallel while serializing one exact target', async () => {
    const activePages = new Set<string>()
    const requestIds = new Set<string>()
    const started: string[] = []
    let active = 0
    let peak = 0
    const executor: CampaignExecutor = async (input) => {
      const page = input.exactTarget?.page_id ?? 'none'
      expect(activePages.has(page)).toBeFalse()
      activePages.add(page)
      started.push(input.runId)
      if (!input.boardRequestId) throw new Error('Expected orchestrator Board request ID.')
      requestIds.add(input.boardRequestId)
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => {
        setTimeout(resolve, input.runId === 'A1' ? 20 : 5)
      })
      active -= 1
      activePages.delete(page)
      return { exitCode: 0, status: 'recorded', threadId: `thread-${input.runId}` }
    }

    const results = await executeCampaign(
      options(
        manifest(scenario('S1', 'fresh'), scenario('S2', 'fresh'), scenario('S3', 'fresh')),
        [
          { exact_target: target('page-A'), run_id: 'A1', scenario_id: 'S1' },
          { exact_target: target('page-A'), run_id: 'A2', scenario_id: 'S2' },
          { exact_target: target('page-B'), run_id: 'B1', scenario_id: 'S3' }
        ],
        executor
      )
    )

    expect(peak).toBe(2)
    expect(requestIds.size).toBe(3)
    expect(started.slice(0, 2)).toEqual(['A1', 'B1'])
    expect(started.indexOf('A2')).toBeGreaterThan(started.indexOf('A1'))
    expect(results.map(({ run_id, status }) => [run_id, status])).toEqual([
      ['A1', 'recorded'],
      ['A2', 'recorded'],
      ['B1', 'recorded']
    ])
  })

  test('keeps warm sessions sequential and resumes the preceding Codex thread', async () => {
    const observed: Array<[string, string | undefined]> = []
    const executor: CampaignExecutor = async (input) => {
      observed.push([input.runId, input.resumeThreadId])
      return { exitCode: 0, status: 'recorded', threadId: `thread-${input.runId}` }
    }

    const results = await executeCampaign(
      options(
        manifest(scenario('W1', 'warm'), scenario('W2', 'warm')),
        [
          {
            exact_target: target('page-A'),
            run_id: 'warm-1',
            scenario_id: 'W1',
            warm_session_id: 'session-A'
          },
          {
            exact_target: target('page-B'),
            run_id: 'warm-2',
            scenario_id: 'W2',
            warm_session_id: 'session-A'
          }
        ],
        executor
      )
    )

    expect(observed).toEqual([
      ['warm-1', undefined],
      ['warm-2', 'thread-warm-1']
    ])
    expect(results[1]?.resume_thread_id).toBe('thread-warm-1')
  })

  test('does not overtake a blocked earlier run in the same warm session', async () => {
    const releaseBlock = Promise.withResolvers<undefined>()
    const launched = Promise.withResolvers<undefined>()
    const observed: string[] = []
    const executor: CampaignExecutor = async (input) => {
      observed.push(input.runId)
      if (input.runId === 'blocker') {
        launched.resolve(undefined)
        await releaseBlock.promise
      }
      return { exitCode: 0, status: 'recorded', threadId: `thread-${input.runId}` }
    }

    const resultsPromise = executeCampaign(
      options(
        manifest(scenario('BLOCK', 'fresh'), scenario('W1', 'warm'), scenario('W2', 'warm')),
        [
          { exact_target: target('page-A'), run_id: 'blocker', scenario_id: 'BLOCK' },
          {
            exact_target: target('page-A'),
            run_id: 'warm-1',
            scenario_id: 'W1',
            warm_session_id: 'session-A'
          },
          {
            exact_target: target('page-B'),
            run_id: 'warm-2',
            scenario_id: 'W2',
            warm_session_id: 'session-A'
          }
        ],
        executor
      )
    )

    await launched.promise
    expect(observed).toEqual(['blocker'])
    releaseBlock.resolve(undefined)
    await resultsPromise
    expect(observed).toEqual(['blocker', 'warm-1', 'warm-2'])
  })

  test('uses deterministic ordered paths independent of completion order', async () => {
    const executor: CampaignExecutor = async (input) => {
      await new Promise((resolve) => {
        setTimeout(resolve, input.runId === 'first' ? 10 : 1)
      })
      return { exitCode: 0, status: 'recorded', threadId: `thread-${input.runId}` }
    }
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh'), scenario('S2', 'fresh')),
      [
        { exact_target: target('page-A'), run_id: 'first', scenario_id: 'S1' },
        { exact_target: target('page-B'), run_id: 'second', scenario_id: 'S2' }
      ],
      executor
    )
    const results = await executeCampaign(campaignOptions)

    expect(results.map(({ run_id }) => run_id)).toEqual(['first', 'second'])
    expect(results.map(({ event_log_path }) => event_log_path)).toEqual([
      join(campaignOptions.outputDir, '001-first/events.jsonl'),
      join(campaignOptions.outputDir, '002-second/events.jsonl')
    ])
  })

  test('prewrites an immutable prompt-free roster before launching', async () => {
    const protectedPrompt = 'Held-out phrase that must not appear in the roster.'
    const heldOut = {
      ...scenario('HOLD-1', 'fresh'),
      lineage: {
        ...scenario('HOLD-1', 'fresh').lineage,
        optimization_exposure: 'forbidden' as const
      },
      prompt: protectedPrompt,
      split: 'held_out' as const
    }
    let rosterText = ''
    const executor: CampaignExecutor = async (input) => {
      rosterText = await readFile(join(input.eventLogPath, '../../campaign-roster.json'), 'utf8')
      expect(input.prompt).toContain(protectedPrompt)
      return { exitCode: 0, status: 'recorded', threadId: 'thread-held-out' }
    }
    const campaignOptions = options(
      manifest(heldOut),
      [{ exact_target: target('page-A'), run_id: 'held-out', scenario_id: 'HOLD-1' }],
      executor
    )
    const results = await executeCampaign(campaignOptions)
    const roster = JSON.parse(rosterText) as CampaignRoster
    const rosterRun = roster.runs[0]
    if (!rosterRun) throw new Error('Expected one rostered held-out run.')

    expect(rosterText).not.toContain(protectedPrompt)
    expect(rosterText).toContain(results[0]?.campaign_roster_id ?? 'missing')
    expect(roster.schema_version).toBe('prompt-to-board-campaign-roster/v3')
    expect(rosterRun.context_components.scenario_user_prompt.utf8_bytes).toBe(
      Buffer.byteLength(protectedPrompt, 'utf8')
    )
    expect(rosterRun.context_components.full_dispatched_prompt.sha256_utf8).toMatch(
      /^[a-f0-9]{64}$/u
    )
    await expect(executeCampaign(campaignOptions)).rejects.toThrow()
  })

  test('gives exact-target runs the lean execution contract', async () => {
    let dispatchedPrompt = ''
    let boardRequestId = ''
    const executor: CampaignExecutor = async (input) => {
      dispatchedPrompt = input.prompt
      boardRequestId = input.boardRequestId ?? ''
      const contextByKind = new Map(
        input.contextInventory.components.map((component) => [component.kind, component])
      )
      expect(contextByKind.get('user_prompt')).toMatchObject({ availability: 'observed' })
      expect(contextByKind.get('exact_target_packet')).toMatchObject({ availability: 'observed' })
      expect(contextByKind.get('execution_contract')).toMatchObject({ availability: 'observed' })
      return { exitCode: 0, status: 'recorded', threadId: 'thread-lean' }
    }
    const campaignOptions = options(
      manifest(scenario('LEAN-1', 'fresh')),
      [{ exact_target: target('page-A'), run_id: 'lean-1', scenario_id: 'LEAN-1' }],
      executor
    )

    await executeCampaign(campaignOptions)

    expect(dispatchedPrompt).toContain('Exact OpenPencil target (do not substitute)')
    expect(boardRequestId).toMatch(/^ptb-run:[a-f0-9]{32}$/u)
    expect(dispatchedPrompt).toContain(`--request-id ${boardRequestId}`)
    expect(dispatchedPrompt).toContain('never generate a replacement ID')
    expect(dispatchedPrompt).toContain('use the exact target above in one guarded Board command')
    expect(dispatchedPrompt).toContain('Do not run a separate context discovery')
    expect(dispatchedPrompt).toContain("Trust the command's durable receipt and built-in readback")
  })

  test('opts eligible runs into the straight-through recorder only when requested', async () => {
    let observed: CampaignExecutorInput['straightThroughInput'] = null
    const exactTarget = target('page-A')
    const executor: CampaignExecutor = async (input) => {
      observed = input.straightThroughInput
      return { exitCode: 0, status: 'recorded', threadId: 'thread-straight-option' }
    }
    const campaignOptions = options(
      manifest(scenario('STRAIGHT', 'fresh')),
      [{ exact_target: exactTarget, run_id: 'straight-option', scenario_id: 'STRAIGHT' }],
      executor
    )
    const run = campaignOptions.runs[0]
    if (!run) throw new Error('Expected one campaign run.')
    run.configuration = configuration('fresh', exactTarget, false)
    campaignOptions.straightThrough = true

    await executeCampaign(campaignOptions)

    expect(observed).toMatchObject({
      enabled: true,
      exactTarget,
      requestId: expect.stringMatching(/^ptb-run:/u),
      scenario: { scenario_id: 'STRAIGHT' }
    })
  })

  test('reuses one request ID only for an explicitly linked same-target recovery', async () => {
    const observed: CampaignExecutorInput[] = []
    const executor: CampaignExecutor = async (input) => {
      observed.push(input)
      return { exitCode: 0, status: 'recorded', threadId: `thread-${input.runId}` }
    }
    const campaignOptions = options(
      manifest(scenario('RECOVER', 'fresh')),
      [
        { exact_target: target('page-A'), run_id: 'root-run', scenario_id: 'RECOVER' },
        {
          exact_target: target('page-A'),
          recovery_of_run_id: 'root-run',
          run_id: 'recovery-run',
          scenario_id: 'RECOVER'
        }
      ],
      executor
    )

    await executeCampaign(campaignOptions)

    expect(observed).toHaveLength(2)
    expect(observed[1]?.boardRequestId).toBe(observed[0]?.boardRequestId)
    expect(observed[1]?.requestScopeRunId).toBe('root-run')
    expect(observed[1]?.recoveryOfRunId).toBe('root-run')
    expect(observed[1]?.prompt).toContain('explicitly linked recovery of run root-run')
    const roster = JSON.parse(
      await readFile(join(campaignOptions.outputDir, 'campaign-roster.json'), 'utf8')
    )
    expect(roster.runs[1].board_request_identity).toEqual({
      board_request_id: observed[0]?.boardRequestId,
      recovery_of_run_id: 'root-run',
      request_scope_run_id: 'root-run'
    })
    expect(roster.runs[1].context_components.scenario_user_prompt).toEqual(
      roster.runs[0].context_components.scenario_user_prompt
    )
    expect(roster.runs[1].context_components.exact_target_packet).toEqual(
      roster.runs[0].context_components.exact_target_packet
    )
    expect(roster.runs[1].context_components.execution_contract).not.toEqual(
      roster.runs[0].context_components.execution_contract
    )
    expect(roster.runs[1].context_components.full_dispatched_prompt).not.toEqual(
      roster.runs[0].context_components.full_dispatched_prompt
    )
  })

  test('rejects recovery linkage that changes target or references a later run', async () => {
    const executor: CampaignExecutor = async () => ({
      exitCode: 0,
      status: 'recorded',
      threadId: 'unused'
    })
    await expect(
      executeCampaign(
        options(
          manifest(scenario('RECOVER', 'fresh')),
          [
            {
              exact_target: target('page-A'),
              recovery_of_run_id: 'later-run',
              run_id: 'early-run',
              scenario_id: 'RECOVER'
            },
            { exact_target: target('page-A'), run_id: 'later-run', scenario_id: 'RECOVER' }
          ],
          executor
        )
      )
    ).rejects.toThrow('must reference an earlier run_id')

    await expect(
      executeCampaign(
        options(
          manifest(scenario('RECOVER', 'fresh')),
          [
            { exact_target: target('page-A'), run_id: 'root-run', scenario_id: 'RECOVER' },
            {
              exact_target: target('page-B'),
              recovery_of_run_id: 'root-run',
              run_id: 'wrong-target',
              scenario_id: 'RECOVER'
            }
          ],
          executor
        )
      )
    ).rejects.toThrow('must keep the original exact target')
  })

  test('rejects a run whose session mode contradicts its measurement class', async () => {
    const executor: CampaignExecutor = async () => ({
      exitCode: 0,
      status: 'recorded',
      threadId: 'unused'
    })
    const campaignOptions = options(
      manifest(scenario('W1', 'warm')),
      [
        {
          exact_target: target('page-A'),
          run_id: 'warm-mislabeled',
          scenario_id: 'W1',
          warm_session_id: 'session-A'
        }
      ],
      executor
    )
    const firstRun = campaignOptions.runs[0]
    if (!firstRun) throw new Error('Expected one campaign run.')
    campaignOptions.runs[0] = {
      ...firstRun,
      configuration: configuration('fresh', target('page-A'))
    }
    await expect(executeCampaign(campaignOptions)).rejects.toThrow(
      'conflicts with measurement class'
    )
  })

  test('rejects a runtime that differs from the frozen five-part target', async () => {
    const executor: CampaignExecutor = async () => ({
      exitCode: 0,
      status: 'recorded',
      threadId: 'unused'
    })
    const exactTarget = target('page-A')
    const campaignOptions = options(
      manifest(scenario('S1', 'fresh')),
      [{ exact_target: exactTarget, run_id: 'wrong-runtime', scenario_id: 'S1' }],
      executor
    )
    const firstRun = campaignOptions.runs[0]
    if (!firstRun) throw new Error('Expected one campaign run.')
    campaignOptions.runs[0] = {
      ...firstRun,
      configuration: configuration('fresh', {
        ...exactTarget,
        runtime_instance_id: 'runtime-other'
      })
    }

    await expect(executeCampaign(campaignOptions)).rejects.toThrow(
      'exact target does not match its frozen configuration'
    )
  })

  test('fails a warm run without a thread and skips its dependent continuation', async () => {
    let calls = 0
    const executor: CampaignExecutor = async () => {
      calls += 1
      return { exitCode: 0, status: 'recorded', threadId: null }
    }
    const results = await executeCampaign(
      options(
        manifest(scenario('W1', 'warm'), scenario('W2', 'warm')),
        [
          {
            exact_target: target('page-A'),
            run_id: 'warm-1',
            scenario_id: 'W1',
            warm_session_id: 'session-A'
          },
          {
            exact_target: target('page-B'),
            run_id: 'warm-2',
            scenario_id: 'W2',
            warm_session_id: 'session-A'
          }
        ],
        executor
      )
    )

    expect(calls).toBe(1)
    expect(results.map(({ status }) => status)).toEqual(['failed', 'skipped'])
  })

  test('rejects duplicate run IDs and writable runs without exact targets', async () => {
    const executor: CampaignExecutor = async () => ({
      exitCode: 0,
      status: 'recorded',
      threadId: 'unused'
    })
    const scenarios = manifest(scenario('S1', 'fresh'), scenario('S2', 'fresh'))
    await expect(
      executeCampaign(
        options(
          scenarios,
          [
            { exact_target: target('page-A'), run_id: 'duplicate', scenario_id: 'S1' },
            { exact_target: target('page-B'), run_id: 'duplicate', scenario_id: 'S2' }
          ],
          executor
        )
      )
    ).rejects.toThrow('Duplicate campaign run_id')
    await expect(
      executeCampaign(
        options(scenarios, [{ run_id: 'missing-target', scenario_id: 'S1' }], executor)
      )
    ).rejects.toThrow('requires an exact target')
  })
})
