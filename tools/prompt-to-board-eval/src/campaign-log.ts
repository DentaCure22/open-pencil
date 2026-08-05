import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { CampaignExecutorInput } from './campaign'
import { evaluationConfigIdentity, type EvaluationConfiguration } from './evaluation-config'
import { dispatchedEvent, EvalLogWriter, readEvalEvents } from './io'
import { createEvalEvent, type EvalTarget } from './schema'

export interface CampaignFailureLogInput {
  campaignRosterId: string
  configuration: EvaluationConfiguration
  error: string
  eventLogPath: string
  prompt: string
  recorderId: string
  rubricId: string
  rubricVersion: string
  runId: string
  scenarioFingerprint: string
  scenarioId: string
  stage: 'executor' | 'visible_proof'
  target: EvalTarget | null
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')
}

async function openOrCreateFailureLog(input: CampaignFailureLogInput): Promise<EvalLogWriter> {
  try {
    return await EvalLogWriter.open(input.eventLogPath)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
  await mkdir(dirname(input.eventLogPath), { recursive: true })
  const now = Date.now()
  return EvalLogWriter.create(
    input.eventLogPath,
    dispatchedEvent(input.runId, input.recorderId, now, performance.now(), input.prompt, {
      campaign_roster_id: input.campaignRosterId,
      config: evaluationConfigIdentity(input.configuration),
      grader_version: input.configuration.evaluator.grader_version,
      rubric_id: input.rubricId,
      rubric_version: input.rubricVersion,
      scenario_fingerprint: input.scenarioFingerprint,
      scenario_id: input.scenarioId,
      source_snapshot: input.configuration.source
    })
  )
}

export async function recordCampaignRunFailure(input: CampaignFailureLogInput): Promise<string> {
  try {
    const existing = await readEvalEvents(input.eventLogPath).catch((error: unknown) => {
      if (isMissingFile(error)) return []
      throw error
    })
    if (existing.at(-1)?.kind === 'run_error') return input.error
    const writer = await openOrCreateFailureLog(input)
    await writer.appendGenerated((last) => ({
      events: [
        createEvalEvent({
          data: {
            code: `${input.stage}_failed`,
            config_id: input.configuration.config_id,
            error: input.error,
            stage: input.stage,
            target: input.target
          },
          kind: 'run_error',
          observed_at_ms: Math.max(Date.now(), last.observed_at_ms),
          observed_monotonic_ms: Math.max(
            performance.now(),
            last.observed_monotonic_ms + Number.EPSILON
          ),
          precision_ms: 1,
          recorder_id: last.recorder_id,
          run_id: last.run_id,
          sequence: last.sequence + 1,
          source: 'orchestrator'
        })
      ],
      value: undefined
    }))
    return input.error
  } catch (ledgerError) {
    const detail = ledgerError instanceof Error ? ledgerError.message : String(ledgerError)
    return `${input.error}; failure ledger append also failed: ${detail}`
  }
}

export function recordCampaignExecutorFailure(
  input: CampaignExecutorInput,
  error: string,
  stage: CampaignFailureLogInput['stage']
): Promise<string> {
  return recordCampaignRunFailure({
    campaignRosterId: input.campaignRosterId,
    configuration: input.configuration,
    error,
    eventLogPath: input.eventLogPath,
    prompt: input.prompt,
    recorderId: input.recorderId,
    rubricId: input.rubricId,
    rubricVersion: input.rubricVersion,
    runId: input.runId,
    scenarioFingerprint: input.scenarioFingerprint,
    scenarioId: input.scenarioId,
    stage,
    target: input.exactTarget
  })
}
