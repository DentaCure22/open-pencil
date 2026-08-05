import { createHash } from 'node:crypto'

import type { PromptToBoardScenario } from './scenario-manifest'
import { parseEvalTarget, type EvalTarget } from './schema'

export interface CampaignBoardRequestIdentity {
  board_request_id: string
  recovery_of_run_id: string | null
  request_scope_run_id: string
}

export interface CampaignPromptParts {
  execution_contract: string | null
  exact_target_packet: string | null
  full_prompt: string
  scenario_user_prompt: string
}

const REQUEST_SCOPE_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function requestScopeRunId(value: string): string {
  if (typeof value !== 'string' || !REQUEST_SCOPE_RUN_ID_PATTERN.test(value)) {
    throw new Error(`Campaign request scope run_id must be path-safe: ${value}.`)
  }
  return value
}

function requestTarget(value: EvalTarget): EvalTarget {
  const target = parseEvalTarget(value)
  for (const [field, identity] of Object.entries(target)) {
    if (identity !== identity.trim()) {
      throw new Error(`Campaign request target ${field} must not contain surrounding whitespace.`)
    }
  }
  return target
}

export function sameEvalTarget(left: EvalTarget, right: EvalTarget): boolean {
  return (
    left.content_document_id === right.content_document_id &&
    left.document_id === right.document_id &&
    left.page_id === right.page_id &&
    left.runtime_instance_id === right.runtime_instance_id &&
    left.workspace_id === right.workspace_id
  )
}

export function campaignBoardRequestId(runId: string, target: EvalTarget): string {
  const scopedRunId = requestScopeRunId(runId)
  const exactTarget = requestTarget(target)
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        content_document_id: exactTarget.content_document_id,
        document_id: exactTarget.document_id,
        page_id: exactTarget.page_id,
        run_id: scopedRunId,
        runtime_instance_id: exactTarget.runtime_instance_id,
        workspace_id: exactTarget.workspace_id
      })
    )
    .digest('hex')
  return `ptb-run:${digest.slice(0, 32)}`
}

export function campaignPromptParts(
  scenario: PromptToBoardScenario,
  target: EvalTarget | null,
  requestIdentity: CampaignBoardRequestIdentity | null
): CampaignPromptParts {
  if (!target || !requestIdentity) {
    return {
      execution_contract: null,
      exact_target_packet: null,
      full_prompt: scenario.prompt,
      scenario_user_prompt: scenario.prompt
    }
  }
  const recoveryInstruction = requestIdentity.recovery_of_run_id
    ? `This is an explicitly linked recovery of run ${requestIdentity.recovery_of_run_id}. Reuse the unchanged original mutation with this request ID; do not attach a different payload to it.`
    : 'If the mutation result is uncertain, recover or replay with this same request ID; never generate a replacement ID.'
  const exactTargetPacket = `Exact OpenPencil target (do not substitute):\n${JSON.stringify(target)}`
  const executionContract = `Orchestrator Board request ID (must use exactly): ${requestIdentity.board_request_id}\nThe first mutating Board command must pass --request-id ${requestIdentity.board_request_id}. ${recoveryInstruction}\n\nLean execution contract: use the exact target above in one guarded Board command when the requested modality supports it. Do not run a separate context discovery, duplicate readback, presentation check, reload, or general audit. Trust the command's durable receipt and built-in readback; add only proof required by this scenario's modality.`
  return {
    execution_contract: executionContract,
    exact_target_packet: exactTargetPacket,
    full_prompt: `${scenario.prompt}\n\n${exactTargetPacket}\n\n${executionContract}`,
    scenario_user_prompt: scenario.prompt
  }
}

export function campaignPrompt(
  scenario: PromptToBoardScenario,
  target: EvalTarget | null,
  requestIdentity: CampaignBoardRequestIdentity | null
): string {
  return campaignPromptParts(scenario, target, requestIdentity).full_prompt
}
