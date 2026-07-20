export type SourceVerificationKind = 'runtime' | 'test'

export type SourceVerificationProfile = {
  args: string[]
  command: string
  cwd?: string
  id: string
  kind: SourceVerificationKind
  timeoutMs?: number
}

export type SourceActionAuthorization = {
  authorizedAt: string
  authorizedBy: string
  expectedBeforeHash: string
  grantedScopes: string[]
  payloadDigest: string
  proposalId: string
  stepId: string
  targetRef: string
}

export type SourceApplyRequest = {
  authorization: SourceActionAuthorization
  content: string
  idempotencyKey: string
  relativePath: string
  verificationProfileIds: string[]
}

export type SourceVerificationEvidence = {
  command: string
  evidenceRef: string
  exitCode: number | null
  id: string
  kind: SourceVerificationKind
  observedAt: string
  passed: boolean
  resultDigest: string
  targetRef: string
  timedOut: boolean
  truncated: boolean
}

export type SourceApplyReceipt = {
  afterHash: string
  appliedAt: string
  authorityId: 'openpencil-local-source-adapter-v1'
  automaticRollback?: SourceRollbackEvidence
  beforeHash: string
  checks: SourceVerificationEvidence[]
  executionResult: {
    afterHash: string
    beforeHash: string
    status: 'applied'
    stepId: string
    targetRef: string
  }
  idempotencyKey: string
  immutable: true
  proposalId: string
  receiptDigest: string
  receiptId: string
  relativePath: string
  rollbackToken?: string
  status: 'rolled-back' | 'verified'
  stepId: string
  targetRef: string
}

export type SourceRollbackRequest = {
  actorId: string
  grantedScopes: string[]
  idempotencyKey: string
  reason: string
  rollbackToken: string
}

export type SourceRollbackEvidence = {
  afterHash: string
  beforeHash: string
  reason: string
  restoredAt: string
  status: 'restored'
}

export type SourceRollbackReceipt = {
  actorId: string
  authorityId: 'openpencil-local-source-adapter-v1'
  grantedScopes: string[]
  idempotencyKey: string
  immutable: true
  proposalId: string
  reason: string
  receiptDigest: string
  receiptId: string
  restoredAt: string
  result: {
    afterHash: string
    beforeHash: string
    status: 'restored'
    stepId: string
    targetRef: string
  }
  status: 'restored'
  stepId: string
  targetRef: string
}

export type SourceActionAdapterOptions = {
  maxFileBytes?: number
  maxOutputBytes?: number
  root: string
  stateDirectory?: string
  verificationProfiles: SourceVerificationProfile[]
}

export type SourceActionAdapter = {
  apply(request: SourceApplyRequest): Promise<SourceApplyReceipt>
  rollback(request: SourceRollbackRequest): Promise<SourceRollbackReceipt>
}
