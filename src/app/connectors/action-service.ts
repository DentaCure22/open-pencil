import { recordActionExecution, recordActionVerification } from '@/app/action-lifecycle'
import type { ActionExecutionResult, ActionVerificationResult } from '@/app/action-lifecycle'
import {
  WorkspaceDomainError,
  type ActionExecutionTargetResult,
  type ActionProposal,
  type ActionProposalStep,
  type ActionVerificationCheck,
  type KnowledgeWorkspace
} from '@/app/workspace'

import type { ConnectorRegistry } from './registry'

export type ExecuteAuthorizedActionInput = {
  appliedAt?: string
  executionReceiptId?: string
  executorId: string
  expectedProposalRevision: number
  expectedWorkspaceRevision: number
  idempotencyKey: string
  localResults?: ActionExecutionTargetResult[]
  proposalId: string
  registry: ConnectorRegistry
}

export type VerifyAppliedActionInput = {
  expectedProposalRevision: number
  expectedWorkspaceRevision: number
  idempotencyKey: string
  localChecks?: ActionVerificationCheck[]
  proposalId: string
  registry: ConnectorRegistry
  verificationReceiptId?: string
  verifiedAt?: string
  verifiedBy: string
}

function requireProposal(workspace: KnowledgeWorkspace, id: string): ActionProposal {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('not_found', `action proposal ${id}`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'action-proposal') {
    throw new WorkspaceDomainError('not_found', `action proposal ${id}`)
  }
  return object
}

function requireScopes(granted: string[], required: string[], label: string): void {
  const missing = required.filter((scope) => !granted.includes(scope))
  if (missing.length > 0) {
    throw new WorkspaceDomainError(
      'permission_denied',
      `${label} is missing connector scopes: ${missing.join(', ')}`
    )
  }
}

function connectorSteps(proposal: ActionProposal): Map<string, ActionProposalStep[]> {
  const grouped = new Map<string, ActionProposalStep[]>()
  for (const step of proposal.steps) {
    if (step.target.kind !== 'external-system') continue
    const connectorId = step.target.connectorId
    if (!connectorId) {
      throw new WorkspaceDomainError('validation_failed', `step ${step.id} has no connectorId`)
    }
    grouped.set(connectorId, [...(grouped.get(connectorId) ?? []), step])
  }
  return grouped
}

function validateConnectorResults(
  steps: ActionProposalStep[],
  results: ActionExecutionTargetResult[],
  connectorId: string
): void {
  const expected = new Map(steps.map((step) => [step.id, step.target.ref]))
  if (
    results.length !== expected.size ||
    new Set(results.map((result) => result.stepId)).size !== results.length ||
    results.some((result) => expected.get(result.stepId) !== result.targetRef)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `connector ${connectorId} must return one exact result for each assigned step`
    )
  }
}

export async function executeAuthorizedActionWithConnectors(
  workspace: KnowledgeWorkspace,
  input: ExecuteAuthorizedActionInput
): Promise<ActionExecutionResult> {
  const proposal = requireProposal(workspace, input.proposalId)
  if (proposal.status !== 'authorized' || proposal.revision !== input.expectedProposalRevision) {
    throw new WorkspaceDomainError(
      'revision_conflict',
      `action proposal ${proposal.id} is not the expected authorized revision`
    )
  }
  const results = [...(input.localResults ?? [])]
  for (const [connectorId, steps] of connectorSteps(proposal)) {
    const connector = input.registry.require(connectorId)
    if (!connector.descriptor.capabilities.actionWrite || !connector.executeAction) {
      throw new WorkspaceDomainError(
        'permission_denied',
        `connector ${connectorId} does not support action writes`
      )
    }
    requireScopes(
      proposal.authorization.grantedScopes,
      connector.descriptor.actionWriteScopes,
      `connector ${connectorId}`
    )
    const connectorResults = await connector.executeAction({
      grantedScopes: proposal.authorization.grantedScopes,
      idempotencyKey: input.idempotencyKey,
      proposal,
      steps
    })
    validateConnectorResults(steps, connectorResults, connectorId)
    results.push(...connectorResults)
  }
  return recordActionExecution(workspace, {
    appliedAt: input.appliedAt,
    executionReceiptId: input.executionReceiptId,
    executorId: input.executorId,
    expectedProposalRevision: input.expectedProposalRevision,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    proposalId: input.proposalId,
    results
  })
}

function validateConnectorChecks(
  steps: ActionProposalStep[],
  checks: ActionVerificationCheck[],
  connectorId: string
): void {
  const targetRefs = new Set(steps.map((step) => step.target.ref))
  if (
    checks.length === 0 ||
    checks.some((check) => check.kind !== 'external-readback' || !targetRefs.has(check.targetRef))
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `connector ${connectorId} verification must return external readback evidence for its targets`
    )
  }
}

export async function verifyAppliedActionWithConnectors(
  workspace: KnowledgeWorkspace,
  input: VerifyAppliedActionInput
): Promise<ActionVerificationResult> {
  const proposal = requireProposal(workspace, input.proposalId)
  if (proposal.status !== 'applied' || proposal.revision !== input.expectedProposalRevision) {
    throw new WorkspaceDomainError(
      'revision_conflict',
      `action proposal ${proposal.id} is not the expected applied revision`
    )
  }
  const executionId = proposal.executionReceipt?.objectId
  if (!executionId || !Object.hasOwn(workspace.objects, executionId)) {
    throw new WorkspaceDomainError('not_found', `execution receipt for ${proposal.id}`)
  }
  const execution = workspace.objects[executionId]
  if (execution.type !== 'action-execution-receipt') {
    throw new WorkspaceDomainError('not_found', `execution receipt for ${proposal.id}`)
  }
  const observedAt = input.verifiedAt ?? new Date().toISOString()
  const checks = [...(input.localChecks ?? [])]
  for (const [connectorId, steps] of connectorSteps(proposal)) {
    const connector = input.registry.require(connectorId)
    if (!connector.descriptor.capabilities.actionReadback || !connector.verifyAction) {
      throw new WorkspaceDomainError(
        'permission_denied',
        `connector ${connectorId} does not support action readback`
      )
    }
    requireScopes(
      proposal.authorization.grantedScopes,
      connector.descriptor.actionReadbackScopes,
      `connector ${connectorId}`
    )
    const connectorChecks = await connector.verifyAction({
      execution,
      grantedScopes: proposal.authorization.grantedScopes,
      idempotencyKey: input.idempotencyKey,
      observedAt,
      proposal,
      steps
    })
    validateConnectorChecks(steps, connectorChecks, connectorId)
    checks.push(...connectorChecks)
  }
  return recordActionVerification(workspace, {
    checks,
    expectedProposalRevision: input.expectedProposalRevision,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    proposalId: input.proposalId,
    verificationReceiptId: input.verificationReceiptId,
    verifiedAt: observedAt,
    verifiedBy: input.verifiedBy
  })
}
