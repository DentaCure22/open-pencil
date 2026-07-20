import type {
  ActionExecutionReceipt,
  ActionExecutionTargetResult,
  ActionProposal,
  ActionProposalStep,
  ActionRollbackReceipt,
  ActionRollbackTargetResult,
  ActionVerificationCheck,
  ActionVerificationReceipt,
  KnowledgeWorkspace
} from '@/app/workspace'

export type ProposeActionInput = {
  actorId?: string
  decisionReceiptId: string
  expectedWorkspaceRevision: number
  id?: string
  idempotencyKey: string
  name: string
  now?: string
  requiredScopes: string[]
  steps: ActionProposalStep[]
}

export type AuthorizeActionInput = {
  actorId: string
  expectedProposalRevision: number
  expectedWorkspaceRevision: number
  grantedScopes: string[]
  idempotencyKey: string
  now?: string
  proposalId: string
}

export type RecordActionExecutionInput = {
  appliedAt?: string
  executionReceiptId?: string
  executorId: string
  expectedProposalRevision: number
  expectedWorkspaceRevision: number
  idempotencyKey: string
  proposalId: string
  results: ActionExecutionTargetResult[]
}

export type RecordActionVerificationInput = {
  checks: ActionVerificationCheck[]
  expectedProposalRevision: number
  expectedWorkspaceRevision: number
  idempotencyKey: string
  proposalId: string
  verificationReceiptId?: string
  verifiedAt?: string
  verifiedBy: string
}

export type RecordActionRollbackInput = {
  actorId: string
  expectedProposalRevision: number
  expectedWorkspaceRevision: number
  grantedScopes: string[]
  idempotencyKey: string
  now?: string
  proposalId: string
  reason: string
  results: ActionRollbackTargetResult[]
  rollbackReceiptId?: string
}

export type ActionProposalResult = {
  proposal: ActionProposal
  workspace: KnowledgeWorkspace
}

export type ActionExecutionResult = ActionProposalResult & {
  execution: ActionExecutionReceipt
}

export type ActionVerificationResult = ActionExecutionResult & {
  verification: ActionVerificationReceipt
}

export type ActionRollbackResult = ActionVerificationResult & {
  rollback: ActionRollbackReceipt
}
