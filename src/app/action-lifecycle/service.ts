import {
  WorkspaceDomainError,
  createActionExecutionReceipt,
  createActionProposal,
  createActionRollbackReceipt,
  createActionVerificationReceipt,
  createWorkspaceContext,
  createWorkspaceId,
  createWorkspaceRelation,
  mutateKnowledgeWorkspace
} from '@/app/workspace'
import type {
  ActionExecutionReceipt,
  ActionProposal,
  ActionRollbackReceipt,
  ActionVerificationCheck,
  ActionVerificationReceipt,
  DecisionReceipt,
  KnowledgeWorkspace,
  WorkspaceOperation
} from '@/app/workspace'

import type {
  ActionExecutionResult,
  ActionProposalResult,
  ActionRollbackResult,
  ActionVerificationResult,
  AuthorizeActionInput,
  ProposeActionInput,
  RecordActionExecutionInput,
  RecordActionRollbackInput,
  RecordActionVerificationInput
} from './types'

function isoTimestamp(value?: string): string {
  return value ?? new Date().toISOString()
}

function requireUnique(values: string[], label: string): void {
  if (
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((value) => !value)
  ) {
    throw new WorkspaceDomainError('validation_failed', `${label} must contain unique values`)
  }
}

function requireDecision(workspace: KnowledgeWorkspace, id: string): DecisionReceipt {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('not_found', `decision receipt ${id}`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'decision-receipt') {
    throw new WorkspaceDomainError('not_found', `decision receipt ${id}`)
  }
  if (object.outcome.status !== 'approved') {
    throw new WorkspaceDomainError(
      'permission_denied',
      `decision receipt ${id} must be approved before proposing an action`
    )
  }
  return object
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

function requireExecution(
  workspace: KnowledgeWorkspace,
  proposal: ActionProposal
): ActionExecutionReceipt {
  const id = proposal.executionReceipt?.objectId
  if (!id || !Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('not_found', `execution receipt for ${proposal.id}`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'action-execution-receipt') {
    throw new WorkspaceDomainError('not_found', `execution receipt for ${proposal.id}`)
  }
  return object
}

function requireExpectedRevision(proposal: ActionProposal, expected: number): void {
  if (proposal.revision !== expected) {
    throw new WorkspaceDomainError(
      'revision_conflict',
      `action proposal ${proposal.id} expected revision ${expected}, current revision ${proposal.revision}`
    )
  }
}

function committedExecution(workspace: KnowledgeWorkspace, id: string): ActionExecutionReceipt {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('not_found', `action execution receipt ${id}`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'action-execution-receipt') {
    throw new WorkspaceDomainError('not_found', `action execution receipt ${id}`)
  }
  return object
}

function committedVerification(
  workspace: KnowledgeWorkspace,
  id: string
): ActionVerificationReceipt {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('not_found', `action verification receipt ${id}`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'action-verification-receipt') {
    throw new WorkspaceDomainError('not_found', `action verification receipt ${id}`)
  }
  return object
}

function committedRollback(workspace: KnowledgeWorkspace, id: string): ActionRollbackReceipt {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('not_found', `action rollback receipt ${id}`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'action-rollback-receipt') {
    throw new WorkspaceDomainError('not_found', `action rollback receipt ${id}`)
  }
  return object
}

function requiredVerificationKinds(proposal: ActionProposal): Set<ActionVerificationCheck['kind']> {
  const kinds = new Set<ActionVerificationCheck['kind']>()
  if (proposal.requestedCapabilities.workspaceWrites) kinds.add('workspace')
  if (proposal.requestedCapabilities.sourceWrites) {
    kinds.add('test')
    kinds.add('runtime')
  }
  if (proposal.requestedCapabilities.externalWrites) kinds.add('external-readback')
  return kinds
}

export function proposeAction(
  workspace: KnowledgeWorkspace,
  input: ProposeActionInput
): ActionProposalResult {
  const decision = requireDecision(workspace, input.decisionReceiptId)
  requireUnique(input.requiredScopes, 'action required scopes')
  requireUnique(
    input.steps.map((step) => step.id),
    'action step IDs'
  )
  if (!input.name || input.steps.length === 0) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'an action proposal requires a name and at least one step'
    )
  }
  const targetKinds = new Set(input.steps.map((step) => step.target.kind))
  const id = input.id ?? createWorkspaceId('action-proposal')
  const proposal = createActionProposal(
    createWorkspaceContext(workspace, {
      now: input.now,
      provenance: { actorId: input.actorId, kind: 'agent' }
    }),
    {
      decisionReceipt: { objectId: decision.id, revision: decision.revision },
      evidenceManifest: decision.evidenceManifest,
      id,
      name: input.name,
      requestedCapabilities: {
        externalWrites: targetKinds.has('external-system'),
        requiredScopes: input.requiredScopes,
        sourceWrites: targetKinds.has('source'),
        workspaceWrites: targetKinds.has('workspace')
      },
      steps: input.steps
    }
  )
  const relations = [
    createWorkspaceRelation({
      id: `relation_${id}_decision`,
      relationType: 'proposed-by-decision',
      sourceId: id,
      targetId: decision.id,
      workspaceId: workspace.id
    }),
    createWorkspaceRelation({
      id: `relation_${id}_evidence`,
      relationType: 'uses-evidence',
      sourceId: id,
      targetId: decision.evidenceManifest.objectId,
      workspaceId: workspace.id
    })
  ]
  const committed = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    operations: [
      { object: proposal, type: 'create-object' },
      ...relations.map((relation) => ({ relation, type: 'connect-relation' as const }))
    ]
  }).workspace
  return { proposal: requireProposal(committed, id), workspace: committed }
}

export function authorizeAction(
  workspace: KnowledgeWorkspace,
  input: AuthorizeActionInput
): ActionProposalResult {
  const proposal = requireProposal(workspace, input.proposalId)
  requireExpectedRevision(proposal, input.expectedProposalRevision)
  if (proposal.status !== 'proposed' || proposal.authorization.status !== 'required') {
    throw new WorkspaceDomainError(
      'permission_denied',
      `action proposal ${proposal.id} is not awaiting authorization`
    )
  }
  requireUnique(input.grantedScopes, 'granted action scopes')
  const missing = proposal.requestedCapabilities.requiredScopes.filter(
    (scope) => !input.grantedScopes.includes(scope)
  )
  if (missing.length > 0) {
    throw new WorkspaceDomainError(
      'permission_denied',
      `action proposal ${proposal.id} is missing required scopes: ${missing.join(', ')}`
    )
  }
  const committed = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    operations: [
      {
        expectedObjectRevision: proposal.revision,
        objectId: proposal.id,
        objectType: 'action-proposal',
        patch: {
          authorization: {
            actorId: input.actorId,
            authorizedAt: isoTimestamp(input.now),
            grantedScopes: input.grantedScopes,
            required: true,
            status: 'granted'
          },
          status: 'authorized'
        },
        type: 'update-object'
      }
    ]
  }).workspace
  return { proposal: requireProposal(committed, proposal.id), workspace: committed }
}

export function recordActionExecution(
  workspace: KnowledgeWorkspace,
  input: RecordActionExecutionInput
): ActionExecutionResult {
  const proposal = requireProposal(workspace, input.proposalId)
  requireExpectedRevision(proposal, input.expectedProposalRevision)
  if (proposal.status !== 'authorized' || proposal.authorization.status !== 'granted') {
    throw new WorkspaceDomainError(
      'permission_denied',
      `action proposal ${proposal.id} must be authorized before execution`
    )
  }
  requireUnique(
    input.results.map((result) => result.stepId),
    'action execution step IDs'
  )
  const steps = new Map(proposal.steps.map((step) => [step.id, step]))
  if (
    input.results.length !== steps.size ||
    input.results.some((result) => steps.get(result.stepId)?.target.ref !== result.targetRef)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'execution results must classify every exact proposal step once'
    )
  }
  const status = input.results.every((result) => result.status === 'applied') ? 'applied' : 'failed'
  const receiptId = input.executionReceiptId ?? createWorkspaceId('action-execution-receipt')
  const receipt = createActionExecutionReceipt(
    createWorkspaceContext(workspace, {
      now: input.appliedAt,
      provenance: { actorId: input.executorId, kind: 'agent' }
    }),
    {
      appliedAt: isoTimestamp(input.appliedAt),
      executorId: input.executorId,
      id: receiptId,
      idempotencyKey: input.idempotencyKey,
      proposal: { objectId: proposal.id, revision: proposal.revision + 1 },
      results: input.results,
      status
    }
  )
  const operations: WorkspaceOperation[] = [
    { object: receipt, type: 'create-object' },
    {
      expectedObjectRevision: proposal.revision,
      objectId: proposal.id,
      objectType: 'action-proposal',
      patch: {
        executionReceipt: { objectId: receipt.id, revision: 1 },
        status
      },
      type: 'update-object'
    }
  ]
  const committed = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    operations
  }).workspace
  return {
    execution: committedExecution(committed, receiptId),
    proposal: requireProposal(committed, proposal.id),
    workspace: committed
  }
}

export function recordActionVerification(
  workspace: KnowledgeWorkspace,
  input: RecordActionVerificationInput
): ActionVerificationResult {
  const proposal = requireProposal(workspace, input.proposalId)
  requireExpectedRevision(proposal, input.expectedProposalRevision)
  if (proposal.status !== 'applied' || proposal.verificationReceipt) {
    throw new WorkspaceDomainError(
      'permission_denied',
      `action proposal ${proposal.id} must have one applied execution awaiting verification`
    )
  }
  const execution = requireExecution(workspace, proposal)
  requireUnique(
    input.checks.map((check) => check.id),
    'action verification check IDs'
  )
  const requiredKinds = requiredVerificationKinds(proposal)
  const passingKinds = new Set(
    input.checks.filter((check) => check.passed).map((check) => check.kind)
  )
  const verified =
    execution.status === 'applied' &&
    input.checks.length > 0 &&
    input.checks.every((check) => check.passed) &&
    [...requiredKinds].every((kind) => passingKinds.has(kind))
  const outcome = verified ? 'verified' : 'failed'
  const receiptId = input.verificationReceiptId ?? createWorkspaceId('action-verification-receipt')
  const receipt = createActionVerificationReceipt(
    createWorkspaceContext(workspace, {
      now: input.verifiedAt,
      provenance: { actorId: input.verifiedBy, kind: 'agent' }
    }),
    {
      checks: input.checks,
      execution: { objectId: execution.id, revision: execution.revision },
      id: receiptId,
      outcome,
      proposal: { objectId: proposal.id, revision: proposal.revision + 1 },
      verifiedAt: isoTimestamp(input.verifiedAt),
      verifiedBy: input.verifiedBy
    }
  )
  const committed = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    operations: [
      { object: receipt, type: 'create-object' },
      {
        expectedObjectRevision: proposal.revision,
        objectId: proposal.id,
        objectType: 'action-proposal',
        patch: {
          status: outcome,
          verificationReceipt: { objectId: receipt.id, revision: 1 }
        },
        type: 'update-object'
      }
    ]
  }).workspace
  return {
    execution: committedExecution(committed, execution.id),
    proposal: requireProposal(committed, proposal.id),
    verification: committedVerification(committed, receiptId),
    workspace: committed
  }
}

export function recordActionRollback(
  workspace: KnowledgeWorkspace,
  input: RecordActionRollbackInput
): ActionRollbackResult {
  const proposal = requireProposal(workspace, input.proposalId)
  requireExpectedRevision(proposal, input.expectedProposalRevision)
  if (proposal.status !== 'verified' || !proposal.verificationReceipt || proposal.rollbackReceipt) {
    throw new WorkspaceDomainError(
      'permission_denied',
      `action proposal ${proposal.id} must be verified and not already rolled back`
    )
  }
  requireUnique(input.grantedScopes, 'rollback granted scopes')
  const missing = proposal.requestedCapabilities.requiredScopes.filter(
    (scope) => !input.grantedScopes.includes(scope)
  )
  if (missing.length > 0) {
    throw new WorkspaceDomainError(
      'permission_denied',
      `action rollback ${proposal.id} is missing required scopes: ${missing.join(', ')}`
    )
  }
  requireUnique(
    input.results.map((result) => result.stepId),
    'action rollback step IDs'
  )
  const steps = new Map(proposal.steps.map((step) => [step.id, step]))
  if (
    input.results.length !== steps.size ||
    input.results.some((result) => steps.get(result.stepId)?.target.ref !== result.targetRef)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'rollback results must classify every exact proposal step once'
    )
  }
  if (!input.reason) {
    throw new WorkspaceDomainError('validation_failed', 'an action rollback requires a reason')
  }
  const execution = requireExecution(workspace, proposal)
  const verification = committedVerification(workspace, proposal.verificationReceipt.objectId)
  const restored = input.results.every((result) => result.status === 'restored')
  const receiptId = input.rollbackReceiptId ?? createWorkspaceId('action-rollback-receipt')
  const rolledBackAt = isoTimestamp(input.now)
  const receipt = createActionRollbackReceipt(
    createWorkspaceContext(workspace, {
      now: input.now,
      provenance: { actorId: input.actorId, kind: 'user' }
    }),
    {
      authorization: {
        actorId: input.actorId,
        authorizedAt: rolledBackAt,
        grantedScopes: input.grantedScopes
      },
      execution: { objectId: execution.id, revision: execution.revision },
      id: receiptId,
      idempotencyKey: input.idempotencyKey,
      proposal: { objectId: proposal.id, revision: proposal.revision + 1 },
      reason: input.reason,
      results: input.results,
      rolledBackAt,
      rolledBackBy: input.actorId,
      status: restored ? 'restored' : 'failed',
      verification: { objectId: verification.id, revision: verification.revision }
    }
  )
  const committed = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: input.expectedWorkspaceRevision,
    idempotencyKey: input.idempotencyKey,
    operations: [
      { object: receipt, type: 'create-object' },
      {
        expectedObjectRevision: proposal.revision,
        objectId: proposal.id,
        objectType: 'action-proposal',
        patch: {
          rollbackReceipt: { objectId: receipt.id, revision: 1 },
          status: restored ? 'rolled-back' : 'rollback-failed'
        },
        type: 'update-object'
      }
    ]
  }).workspace
  return {
    execution: committedExecution(committed, execution.id),
    proposal: requireProposal(committed, proposal.id),
    rollback: committedRollback(committed, receiptId),
    verification: committedVerification(committed, verification.id),
    workspace: committed
  }
}
