import type { EditorStore } from '@/app/editor/session'
import type {
  EvidenceCollectionReceipt,
  EvidenceFreshnessStatus,
  EvidenceManifestItem,
  EvidenceTruthScope,
  KnowledgeWorkspace,
  WorkspacePropertyValue
} from '@/app/workspace'

export type EvidenceAccessGrant = {
  actorId?: string
  issuedAt: string
  scopes: string[]
}

type EvidenceRequestBase = {
  id: string
  requiredScopes?: string[]
}

export type CapturedEvidenceRequest = EvidenceRequestBase & {
  facts: Record<string, WorkspacePropertyValue>
  freshness?: EvidenceFreshnessStatus
  kind: 'captured-input'
  observedAt?: string
  sourceRef: string
  staleAt?: string
  summary: string
  title: string
  truthScope?: Extract<EvidenceTruthScope, 'captured' | 'derived' | 'fixture'>
}

export type WorkspaceObjectEvidenceRequest = EvidenceRequestBase & {
  kind: 'workspace-object'
  objectId: string
  revision: number
}

export type LiveAppFrameEvidenceRequest = EvidenceRequestBase & {
  frameId: string
  kind: 'live-app-frame'
  requireLive?: boolean
}

export type EvidenceSourceRequest =
  | CapturedEvidenceRequest
  | LiveAppFrameEvidenceRequest
  | WorkspaceObjectEvidenceRequest

export type CollectEvidenceInput = {
  collectionId: string
  grant: EvidenceAccessGrant
  now?: string
  requests: EvidenceSourceRequest[]
  store: EditorStore
  workspace?: KnowledgeWorkspace
}

export type EvidenceIntakeResult = {
  items: EvidenceManifestItem[]
  receipt: EvidenceCollectionReceipt
  status: 'partial' | 'ready'
}
