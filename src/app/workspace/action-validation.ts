import { WorkspaceDomainError } from './errors'
import type {
  ActionProposal,
  ActionVerificationCheck,
  KnowledgeWorkspace,
  WorkspaceObject,
  WorkspaceObjectType
} from './types'

type ActionLifecycleObject = Extract<
  WorkspaceObject,
  {
    type:
      | 'action-execution-receipt'
      | 'action-proposal'
      | 'action-rollback-receipt'
      | 'action-verification-receipt'
  }
>

function requireObject(
  workspace: KnowledgeWorkspace,
  objectId: string,
  label: string
): WorkspaceObject {
  if (!Object.hasOwn(workspace.objects, objectId)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} references missing object ${objectId}`
    )
  }
  return workspace.objects[objectId]
}

function requireExactRevision(
  workspace: KnowledgeWorkspace,
  reference: { objectId: string; revision: number },
  expectedType: WorkspaceObjectType,
  label: string
): WorkspaceObject {
  const object = requireObject(workspace, reference.objectId, label)
  if (object.type !== expectedType || object.revision !== reference.revision) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} must reference exact ${expectedType} revision ${reference.revision}`
    )
  }
  return object
}

function requireHistoricalRevision(
  workspace: KnowledgeWorkspace,
  reference: { objectId: string; revision: number },
  expectedType: WorkspaceObjectType,
  label: string
): WorkspaceObject {
  const object = requireObject(workspace, reference.objectId, label)
  if (
    object.type !== expectedType ||
    !Number.isInteger(reference.revision) ||
    reference.revision < 1 ||
    reference.revision > object.revision
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} must reference an existing ${expectedType} revision`
    )
  }
  return object
}

function requireUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length || values.some((value) => !value)) {
    throw new WorkspaceDomainError('validation_failed', `${label} must contain unique IDs`)
  }
}

function validateProposalBasis(workspace: KnowledgeWorkspace, proposal: ActionProposal): void {
  const decision = requireExactRevision(
    workspace,
    proposal.decisionReceipt,
    'decision-receipt',
    `action proposal ${proposal.id}`
  )
  const evidence = requireExactRevision(
    workspace,
    proposal.evidenceManifest,
    'evidence-manifest',
    `action proposal ${proposal.id}`
  )
  if (decision.type !== 'decision-receipt' || evidence.type !== 'evidence-manifest') return
  if (
    decision.outcome.status !== 'approved' ||
    decision.evidenceManifest.objectId !== evidence.id ||
    decision.evidenceManifest.revision !== evidence.revision
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action proposal ${proposal.id} requires an approved decision and its exact evidence manifest`
    )
  }
}

function validateProposalSteps(proposal: ActionProposal): void {
  if (!proposal.name || proposal.steps.length === 0) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action proposal ${proposal.id} requires a name and at least one exact step`
    )
  }
  requireUnique(
    proposal.steps.map((step) => step.id),
    `action proposal ${proposal.id} steps`
  )
  for (const step of proposal.steps) {
    if (!step.description || !step.payloadDigest || !step.target.label || !step.target.ref) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `action proposal ${proposal.id} steps must identify their target and payload`
      )
    }
    if (step.target.kind === 'external-system' && !step.target.connectorId) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `external action step ${step.id} requires a connectorId`
      )
    }
  }
}

function validateProposalCapabilities(proposal: ActionProposal): void {
  const targetKinds = new Set(proposal.steps.map((step) => step.target.kind))
  const capabilities = proposal.requestedCapabilities
  requireUnique(capabilities.requiredScopes, `action proposal ${proposal.id} required scopes`)
  if (
    capabilities.requiredScopes.length === 0 ||
    capabilities.externalWrites !== targetKinds.has('external-system') ||
    capabilities.sourceWrites !== targetKinds.has('source') ||
    capabilities.workspaceWrites !== targetKinds.has('workspace')
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action proposal ${proposal.id} capabilities must exactly describe its targets and scopes`
    )
  }
}

function validateProposalAuthorization(proposal: ActionProposal): void {
  const authorization = proposal.authorization
  requireUnique(authorization.grantedScopes, `action proposal ${proposal.id} granted scopes`)
  const authorized = authorization.status === 'granted'
  if (proposal.status === 'proposed' && authorized) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `proposed action ${proposal.id} cannot already be authorized`
    )
  }
  if (proposal.status !== 'proposed' && !authorized) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action proposal ${proposal.id} requires granted authorization for ${proposal.status}`
    )
  }
  const hasAllScopes = proposal.requestedCapabilities.requiredScopes.every((scope) =>
    authorization.grantedScopes.includes(scope)
  )
  if (authorized && (!authorization.actorId || !authorization.authorizedAt || !hasAllScopes)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action proposal ${proposal.id} has an incomplete authorization receipt`
    )
  }
}

function validateProposalReceiptLinks(
  workspace: KnowledgeWorkspace,
  proposal: ActionProposal
): void {
  if (proposal.executionReceipt) {
    const execution = requireExactRevision(
      workspace,
      proposal.executionReceipt,
      'action-execution-receipt',
      `action proposal ${proposal.id} execution`
    )
    if (
      execution.type !== 'action-execution-receipt' ||
      execution.proposal.objectId !== proposal.id
    ) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `action proposal ${proposal.id} execution receipt must link back to the proposal`
      )
    }
  }
  if (proposal.verificationReceipt) {
    const verification = requireExactRevision(
      workspace,
      proposal.verificationReceipt,
      'action-verification-receipt',
      `action proposal ${proposal.id} verification`
    )
    if (
      verification.type !== 'action-verification-receipt' ||
      verification.proposal.objectId !== proposal.id
    ) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `action proposal ${proposal.id} verification receipt must link back to the proposal`
      )
    }
  }
  if (proposal.rollbackReceipt) {
    const rollback = requireExactRevision(
      workspace,
      proposal.rollbackReceipt,
      'action-rollback-receipt',
      `action proposal ${proposal.id} rollback`
    )
    if (rollback.type !== 'action-rollback-receipt' || rollback.proposal.objectId !== proposal.id) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `action proposal ${proposal.id} rollback receipt must link back to the proposal`
      )
    }
  }
}

function validateProposalStatus(proposal: ActionProposal): void {
  const hasExecution = Boolean(proposal.executionReceipt)
  const hasVerification = Boolean(proposal.verificationReceipt)
  const hasRollback = Boolean(proposal.rollbackReceipt)
  const hasAnyReceipt = hasExecution || hasVerification || hasRollback
  if (['proposed', 'authorized'].includes(proposal.status) && hasAnyReceipt) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${proposal.status} action ${proposal.id} has receipts`
    )
  }
  if (['applied', 'failed'].includes(proposal.status) && !hasExecution) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action proposal ${proposal.id} status requires an execution receipt`
    )
  }
  const hasVerifiedChain = hasExecution && hasVerification
  if (proposal.status === 'verified' && (!hasVerifiedChain || hasRollback)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `verified action ${proposal.id} requires execution and verification without rollback`
    )
  }
  const isRollbackStatus = ['rolled-back', 'rollback-failed'].includes(proposal.status)
  if (isRollbackStatus && (!hasVerifiedChain || !hasRollback)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `rolled back action ${proposal.id} requires execution, verification, and rollback receipts`
    )
  }
}

function validateProposal(workspace: KnowledgeWorkspace, proposal: ActionProposal): void {
  validateProposalBasis(workspace, proposal)
  validateProposalSteps(proposal)
  validateProposalCapabilities(proposal)
  validateProposalAuthorization(proposal)
  validateProposalReceiptLinks(workspace, proposal)
  validateProposalStatus(proposal)
}

function validateExecution(
  workspace: KnowledgeWorkspace,
  receipt: Extract<ActionLifecycleObject, { type: 'action-execution-receipt' }>
): void {
  const proposal = requireHistoricalRevision(
    workspace,
    receipt.proposal,
    'action-proposal',
    `action execution receipt ${receipt.id}`
  )
  if (proposal.type !== 'action-proposal' || proposal.executionReceipt?.objectId !== receipt.id) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action execution receipt ${receipt.id} must be the proposal's execution receipt`
    )
  }
  requireUnique(
    receipt.results.map((result) => result.stepId),
    `action execution receipt ${receipt.id} results`
  )
  const steps = new Map(proposal.steps.map((step) => [step.id, step]))
  if (
    receipt.results.length !== steps.size ||
    receipt.results.some((result) => steps.get(result.stepId)?.target.ref !== result.targetRef)
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action execution receipt ${receipt.id} must classify every exact proposal step once`
    )
  }
  const allApplied = receipt.results.every((result) => result.status === 'applied')
  if (
    (receipt.status === 'applied') !== allApplied ||
    !receipt.idempotencyKey ||
    !receipt.executorId
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action execution receipt ${receipt.id} has an invalid execution outcome`
    )
  }
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

function validateVerification(
  workspace: KnowledgeWorkspace,
  receipt: Extract<ActionLifecycleObject, { type: 'action-verification-receipt' }>
): void {
  const proposal = requireHistoricalRevision(
    workspace,
    receipt.proposal,
    'action-proposal',
    `action verification receipt ${receipt.id}`
  )
  const execution = requireExactRevision(
    workspace,
    receipt.execution,
    'action-execution-receipt',
    `action verification receipt ${receipt.id}`
  )
  if (proposal.type !== 'action-proposal' || execution.type !== 'action-execution-receipt') return
  if (
    proposal.verificationReceipt?.objectId !== receipt.id ||
    proposal.executionReceipt?.objectId !== execution.id ||
    execution.proposal.objectId !== proposal.id
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action verification receipt ${receipt.id} must preserve the exact proposal and execution chain`
    )
  }
  requireUnique(
    receipt.checks.map((check) => check.id),
    `action verification receipt ${receipt.id} checks`
  )
  const targetRefs = new Set(proposal.steps.map((step) => step.target.ref))
  const invalidCheck = receipt.checks.some(
    (check) =>
      !check.evidenceRef ||
      !check.resultDigest ||
      !targetRefs.has(check.targetRef) ||
      !check.observedAt
  )
  if (invalidCheck) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action verification receipt ${receipt.id} contains an invalid verification check`
    )
  }
  const passingKinds = new Set(
    receipt.checks.filter((check) => check.passed).map((check) => check.kind)
  )
  const hasRequiredChecks = [...requiredVerificationKinds(proposal)].every((kind) =>
    passingKinds.has(kind)
  )
  const verified =
    execution.status === 'applied' &&
    receipt.checks.length > 0 &&
    receipt.checks.every((check) => check.passed) &&
    hasRequiredChecks
  if ((receipt.outcome === 'verified') !== verified) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action verification receipt ${receipt.id} may be verified only with all required passing evidence`
    )
  }
}

type RollbackReceipt = Extract<ActionLifecycleObject, { type: 'action-rollback-receipt' }>

function requireRollbackChain(workspace: KnowledgeWorkspace, receipt: RollbackReceipt) {
  const proposal = requireHistoricalRevision(
    workspace,
    receipt.proposal,
    'action-proposal',
    `action rollback receipt ${receipt.id}`
  )
  const execution = requireExactRevision(
    workspace,
    receipt.execution,
    'action-execution-receipt',
    `action rollback receipt ${receipt.id}`
  )
  const verification = requireExactRevision(
    workspace,
    receipt.verification,
    'action-verification-receipt',
    `action rollback receipt ${receipt.id}`
  )
  if (
    proposal.type !== 'action-proposal' ||
    execution.type !== 'action-execution-receipt' ||
    verification.type !== 'action-verification-receipt'
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action rollback receipt ${receipt.id} references the wrong lifecycle object types`
    )
  }
  return { execution, proposal, verification }
}

function validateRollbackLinks(
  receipt: RollbackReceipt,
  chain: ReturnType<typeof requireRollbackChain>
): void {
  const { execution, proposal, verification } = chain
  const linksMatch =
    proposal.rollbackReceipt?.objectId === receipt.id &&
    proposal.executionReceipt?.objectId === execution.id &&
    proposal.verificationReceipt?.objectId === verification.id &&
    execution.proposal.objectId === proposal.id &&
    verification.proposal.objectId === proposal.id &&
    verification.outcome === 'verified'
  if (!linksMatch) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action rollback receipt ${receipt.id} must preserve the verified proposal chain`
    )
  }
}

function validateRollbackCompleteness(receipt: RollbackReceipt, proposal: ActionProposal): void {
  requireUnique(
    receipt.results.map((result) => result.stepId),
    `action rollback receipt ${receipt.id} results`
  )
  requireUnique(
    receipt.authorization.grantedScopes,
    `action rollback receipt ${receipt.id} granted scopes`
  )
  const steps = new Map(proposal.steps.map((step) => [step.id, step]))
  const classifiesEveryStep =
    receipt.results.length === steps.size &&
    receipt.results.every((result) => steps.get(result.stepId)?.target.ref === result.targetRef)
  const hasAllScopes = proposal.requestedCapabilities.requiredScopes.every((scope) =>
    receipt.authorization.grantedScopes.includes(scope)
  )
  const requiredText = [
    receipt.authorization.actorId,
    receipt.authorization.authorizedAt,
    receipt.idempotencyKey,
    receipt.reason,
    receipt.rolledBackAt,
    receipt.rolledBackBy
  ]
  if (!classifiesEveryStep || !hasAllScopes || requiredText.some((value) => !value)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action rollback receipt ${receipt.id} has incomplete authorization or results`
    )
  }
}

function validateRollback(workspace: KnowledgeWorkspace, receipt: RollbackReceipt): void {
  const chain = requireRollbackChain(workspace, receipt)
  validateRollbackLinks(receipt, chain)
  validateRollbackCompleteness(receipt, chain.proposal)
  const restored = receipt.results.every(
    (result) =>
      result.status === 'restored' && Boolean(result.beforeHash) && Boolean(result.afterHash)
  )
  if ((receipt.status === 'restored') !== restored) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `action rollback receipt ${receipt.id} may be restored only with exact restored hashes`
    )
  }
}

export function validateActionLifecycleObject(
  workspace: KnowledgeWorkspace,
  object: WorkspaceObject
): void {
  if (object.type === 'action-proposal') validateProposal(workspace, object)
  if (object.type === 'action-execution-receipt') validateExecution(workspace, object)
  if (object.type === 'action-verification-receipt') validateVerification(workspace, object)
  if (object.type === 'action-rollback-receipt') validateRollback(workspace, object)
}
