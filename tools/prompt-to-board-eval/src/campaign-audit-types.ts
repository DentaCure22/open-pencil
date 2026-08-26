import type { CampaignRunStatus } from './campaign'

export const CAMPAIGN_TRUTH_AUDIT_SCHEMA_VERSION =
  'prompt-to-board-campaign-truth-audit/v1' as const

export type CampaignTruthState =
  | 'failed'
  | 'finalized'
  | 'interrupted'
  | 'never_started'
  | 'pending_proof'
  | 'recorded'
  | 'skipped'
  | 'unlogged_failure'

export interface CampaignTruthDiscrepancy {
  code:
    | 'dispatch_identity_mismatch'
    | 'board_request_identity_mismatch'
    | 'duplicate_result'
    | 'finalization_mismatch'
    | 'invalid_event_log'
    | 'missing_event_log'
    | 'missing_result'
    | 'missing_telemetry_artifact'
    | 'roster_identity_mismatch'
    | 'result_identity_mismatch'
    | 'terminal_event_mismatch'
    | 'telemetry_artifact_mismatch'
    | 'unexpected_event_log'
    | 'unexpected_result'
  detail: string
  run_id: string
}

export interface CampaignTruthObservation {
  discrepancies: readonly CampaignTruthDiscrepancy[]
  event_count: number
  result_status: CampaignRunStatus | null
  run_id: string
  state: CampaignTruthState
  telemetry_artifact_path: string | null
}

export interface CampaignTruthAuditReport {
  counts: Record<CampaignTruthState, number>
  discrepancies: readonly CampaignTruthDiscrepancy[]
  gate_passed: boolean
  observations: readonly CampaignTruthObservation[]
  results_total: number
  roster_id: string
  scheduled_total: number
  schema_version: typeof CAMPAIGN_TRUTH_AUDIT_SCHEMA_VERSION
  started_total: number
}
