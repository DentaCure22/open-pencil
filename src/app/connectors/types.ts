import type {
  ActionExecutionTargetResult,
  ActionProposal,
  ActionProposalStep,
  ActionVerificationCheck,
  ActionExecutionReceipt,
  EvidenceFreshnessStatus,
  EvidenceTruthScope,
  WorkspacePropertyValue
} from '@/app/workspace'

export type ConnectorDescriptor = {
  actionReadbackScopes: string[]
  actionWriteScopes: string[]
  capabilities: {
    actionReadback: boolean
    actionWrite: boolean
    evidenceRead: boolean
    networkAccess: boolean
  }
  evidenceReadScopes: string[]
  id: string
  name: string
}

export type ConnectorEvidenceRequest = {
  connectorId: string
  id: string
  query?: Record<string, WorkspacePropertyValue>
  requiredScopes?: string[]
  resourceRef: string
}

export type ConnectorEvidenceResult = {
  facts: Record<string, WorkspacePropertyValue>
  freshness: EvidenceFreshnessStatus
  observedAt?: string
  sourceRef: string
  staleAt?: string
  summary: string
  title: string
  transport?: ConnectorTransportEvidence
  truthScope: Extract<EvidenceTruthScope, 'captured' | 'derived' | 'last-known' | 'live'>
}

export type ConnectorFailureCode =
  | 'invalid-response'
  | 'network'
  | 'not-found'
  | 'permission-denied'
  | 'rate-limited'
  | 'timeout'
  | 'unavailable'

export type ConnectorTransportEvidence = {
  attemptCount: number
  etag?: string
  providerRequestId?: string
  responseStatus: number
}

export type ConnectorEvidenceContext = {
  grantedScopes: string[]
  now: string
  request: ConnectorEvidenceRequest
}

export type ConnectorActionContext = {
  grantedScopes: string[]
  idempotencyKey: string
  proposal: ActionProposal
  steps: ActionProposalStep[]
}

export type ConnectorVerificationContext = ConnectorActionContext & {
  execution: ActionExecutionReceipt
  observedAt: string
}

export type OpenPencilConnector = {
  descriptor: ConnectorDescriptor
  executeAction?: (context: ConnectorActionContext) => Promise<ActionExecutionTargetResult[]>
  readEvidence?: (context: ConnectorEvidenceContext) => Promise<ConnectorEvidenceResult>
  verifyAction?: (context: ConnectorVerificationContext) => Promise<ActionVerificationCheck[]>
}
