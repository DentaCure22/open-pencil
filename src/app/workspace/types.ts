import type { Vector } from '@open-pencil/scene-graph/primitives'

export const WORKSPACE_SCHEMA_VERSION = 15 as const

export type WorkspaceSchemaVersion = typeof WORKSPACE_SCHEMA_VERSION
export type WorkspaceId = string
export type WorkspaceObjectId = string
export type WorkspaceRelationId = string
export type WorkspaceViewId = string
export type WorkspaceLifecycle = 'active' | 'archived'
export type WorkspaceMutationScope = 'workspace-metadata'
export type WorkspaceViewKind = 'document' | 'canvas' | 'graph' | 'atlas' | 'review'

export type WorkspacePoint = Vector
export type WorkspaceGeometry = WorkspacePoint & {
  height: number
  rotation?: number
  width: number
}
export type WorkspacePermissions = {
  canComment: boolean
  canEdit: boolean
  canView: boolean
}
export type WorkspaceProvenance = {
  actorId?: string
  kind: 'user' | 'agent' | 'import' | 'runtime-capture' | 'discovery'
  sourceRef?: string
}
export type WorkspaceProjection = {
  collapsed?: boolean
  geometry?: WorkspaceGeometry
  hidden?: boolean
  order?: number
  presentation?: Record<string, string | number | boolean | null>
}

export type WorkspaceObjectBase = {
  archivedAt?: string
  collectionId?: WorkspaceObjectId
  commentIds: WorkspaceObjectId[]
  createdAt: string
  createdBy?: string
  documentId: string
  id: WorkspaceObjectId
  lastWorkspaceRevision: number
  lifecycle: WorkspaceLifecycle
  pageId: string
  parentId?: WorkspaceObjectId
  permissions: WorkspacePermissions
  projections: Record<WorkspaceViewId, WorkspaceProjection>
  provenance: WorkspaceProvenance
  revision: number
  tags: string[]
  updatedAt: string
  workspaceId: WorkspaceId
}

export type DocumentBlockKind =
  | 'heading'
  | 'paragraph'
  | 'bulleted-list'
  | 'numbered-list'
  | 'task'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'table'
  | 'image'
  | 'file'
  | 'embed'
export type WorkspaceScalar = string | number | boolean | null
export type WorkspacePropertyValue = WorkspaceScalar | WorkspaceScalar[]
export type DocumentBlock = WorkspaceObjectBase & {
  attributes: Record<string, WorkspacePropertyValue>
  blockKind: DocumentBlockKind
  checked?: boolean
  childIds: WorkspaceObjectId[]
  language?: string
  order: number
  text: string
  type: 'document-block'
}

export type CollectionPropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'date'
  | 'checkbox'
  | 'relation'
  | 'url'
  | 'email'
  | 'status'
export type CollectionPropertyOption = {
  color?: string
  id: string
  label: string
}
export type CollectionProperty = {
  id: string
  label: string
  options?: CollectionPropertyOption[]
  relationCollectionId?: WorkspaceObjectId
  required?: boolean
  type: CollectionPropertyType
}
export type Collection = WorkspaceObjectBase & {
  description?: string
  name: string
  properties: CollectionProperty[]
  recordIds: WorkspaceObjectId[]
  savedViewIds: WorkspaceObjectId[]
  type: 'collection'
}
export type CollectionRecord = WorkspaceObjectBase & {
  bodyBlockIds: WorkspaceObjectId[]
  collectionId: WorkspaceObjectId
  properties: Record<string, WorkspacePropertyValue>
  title: string
  type: 'collection-record'
}

export type SavedViewKind = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'graph' | 'canvas'
export type SavedViewFilterOperator =
  | 'equals'
  | 'not-equals'
  | 'contains'
  | 'is-empty'
  | 'is-not-empty'
  | 'in'
  | 'greater-than-or-equal'
  | 'less-than-or-equal'
export type SavedViewFilter = {
  operator: SavedViewFilterOperator
  propertyId: string
  value?: WorkspacePropertyValue
}
export type SavedViewSort = {
  direction: 'ascending' | 'descending'
  propertyId: string
}
export type SavedView = WorkspaceObjectBase & {
  collectionId: WorkspaceObjectId
  filters: SavedViewFilter[]
  groupByPropertyId?: string
  name: string
  sorts: SavedViewSort[]
  type: 'saved-view'
  viewKind: SavedViewKind
  visiblePropertyIds: string[]
}

export type CanvasObjectKind =
  | 'ink'
  | 'shape'
  | 'frame'
  | 'sticky-note'
  | 'annotation'
  | 'connector'
  | 'spatial-group'
  | 'evidence-marker'
export type CanvasObject = WorkspaceObjectBase & {
  canvasKind: CanvasObjectKind
  data: Record<string, WorkspacePropertyValue>
  label?: string
  sceneNodeId?: string
  type: 'canvas-object'
}

export type GraphKind =
  | 'flow'
  | 'mind-map'
  | 'architecture'
  | 'dependency'
  | 'entity-relationship'
  | 'decision-tree'
  | 'app-atlas'
export type GraphDirection = 'directed' | 'undirected' | 'bidirectional'
export type GraphNode = WorkspaceObjectBase & {
  data: Record<string, WorkspacePropertyValue>
  graphId: string
  graphKind: GraphKind
  label: string
  layoutRole?: string
  type: 'graph-node'
}
export type GraphEdge = WorkspaceObjectBase & {
  condition?: string
  confidence?: number
  direction: GraphDirection
  graphId: string
  graphKind: GraphKind
  label?: string
  relationshipType: string
  sourceId: WorkspaceObjectId
  targetId: WorkspaceObjectId
  type: 'graph-edge'
}

export type DesignArtifactKind =
  | 'component'
  | 'instance'
  | 'pattern'
  | 'token'
  | 'asset'
  | 'mockup'
  | 'responsive-state'
  | 'design-annotation'
export type DesignOwnership =
  | 'workspace'
  | 'preview-branch'
  | 'reusable-proposal'
  | 'proposed-source-change'
export type DesignArtifact = WorkspaceObjectBase & {
  artifactKind: DesignArtifactKind
  data: Record<string, WorkspacePropertyValue>
  label: string
  ownership: DesignOwnership
  previewVersionId?: WorkspaceObjectId
  sourceRef?: string
  type: 'design-artifact'
}

export type ReviewObjectKind =
  | 'comment'
  | 'question'
  | 'decision'
  | 'comparison'
  | 'approval'
  | 'status-marker'
  | 'acceptance-criterion'
  | 'change-set-reference'
export type ReviewStatus =
  | 'open'
  | 'resolved'
  | 'preferred'
  | 'approved'
  | 'verified'
  | 'applied'
  | 'rejected'
export type ReviewObject = WorkspaceObjectBase & {
  attachedObjectIds: WorkspaceObjectId[]
  attachedRevisions: Record<WorkspaceObjectId, number>
  body: string
  reviewKind: ReviewObjectKind
  reviewStatus: ReviewStatus
  type: 'review-object'
}

export type WorkspaceObjectRevisionRef = {
  objectId: WorkspaceObjectId
  revision: number
}
export type WorkspaceCodeObjectArtifactRevisionRef = {
  artifactId: string
  boardId: string
  boardRevision: number
  boardSchemaVersion: number
  kind: 'code-object'
  sourceHash: string
}
export type EvidenceTruthScope = 'fixture' | 'captured' | 'last-known' | 'live' | 'derived'
export type EvidenceFreshnessStatus = 'current' | 'stale' | 'unknown'
export type EvidenceProviderKind =
  | 'captured-input'
  | 'code-object'
  | 'connector'
  | 'workspace-object'
export type EvidenceProviderCapabilities = {
  capturedContentRead: boolean
  externalWrites: false
  liveRuntimeRead: boolean
  networkAccess: boolean
  sourceWrites: false
  workspaceMetadataRead: boolean
}
export type EvidenceProviderFailureCode =
  | 'invalid-response'
  | 'network'
  | 'not-found'
  | 'not-supported'
  | 'permission-denied'
  | 'rate-limited'
  | 'scope-denied'
  | 'timeout'
  | 'unavailable'
  | 'unknown'
export type EvidenceProviderRun = {
  access: 'allowed' | 'redacted'
  attemptCount?: number
  capabilities: EvidenceProviderCapabilities
  completedAt: string
  errorCode?: EvidenceProviderFailureCode
  freshness: EvidenceFreshnessStatus
  grantedScopes: string[]
  id: string
  providerId: string
  providerKind: EvidenceProviderKind
  providerRequestId?: string
  requestedScopes: string[]
  requestId: string
  responseStatus?: number
  sourceRef: string
  status: 'collected' | 'redacted' | 'unavailable'
  truthScope: EvidenceTruthScope
}
export type EvidenceCollectionReceipt = {
  actorId?: string
  completedAt: string
  grantedScopes: string[]
  id: string
  providerRuns: EvidenceProviderRun[]
  requestedAt: string
}
export type EvidenceManifestItem = {
  access: 'allowed' | 'redacted'
  facts: Record<string, WorkspacePropertyValue>
  freshness: EvidenceFreshnessStatus
  id: string
  observedAt?: string
  permissionScopes: string[]
  providerRunId?: string
  retrievedAt: string
  sourceObject?: WorkspaceObjectRevisionRef
  sourceRef: string
  staleAt?: string
  summary: string
  title: string
  truthScope: EvidenceTruthScope
}
export type IntentRecord = WorkspaceObjectBase & {
  capturedAt: string
  constraints: string[]
  desiredOutcome: string
  inputMode: 'text' | 'trace'
  locked: true
  statement: string
  type: 'intent-record'
}
export type EvidenceManifest = WorkspaceObjectBase & {
  collectionReceipt?: EvidenceCollectionReceipt
  immutable: true
  intent: WorkspaceObjectRevisionRef
  items: EvidenceManifestItem[]
  snapshotAt: string
  status: 'ready' | 'partial'
  type: 'evidence-manifest'
}
export type DecisionRecommendation = {
  evidenceItemIds: string[]
  id: string
  rank: number
  rationale: string
  status: 'active' | 'preferred' | 'rejected' | 'revised'
  title: string
  tradeoff: string
  uncertainty: string
}
export type SurfaceInteractionAction =
  | 'reorder'
  | 'reject'
  | 'restore'
  | 'revise'
  | 'compare'
  | 'prefer'
  | 'unprefer'
  | 'adjust'
  | 'approve'
export type SurfaceInteraction = {
  action: SurfaceInteractionAction
  actorId?: string
  basis: {
    artifactRevision: number
    surfaceRevision: number
  }
  fromIndex?: number
  id: string
  inputId?: string
  note?: string
  occurredAt: string
  recommendationId?: string
  toIndex?: number
  value?: WorkspacePropertyValue
}
export type SurfaceJobKind =
  | 'compare'
  | 'decide'
  | 'design'
  | 'explain'
  | 'plan'
  | 'simulate'
  | 'triage'
export type SurfaceModeKind = 'compare' | 'focus' | 'overview' | 'review'
export type SurfaceMode = {
  id: string
  kind: SurfaceModeKind
  label: string
  rendererViewId?: string
  viewId?: WorkspaceViewId
}
export type SurfaceRun = WorkspaceObjectBase & {
  artifact: WorkspaceCodeObjectArtifactRevisionRef
  capabilities: {
    externalWrites: false
    networkAccess: false
    sourceWrites: false
  }
  evidenceManifest: WorkspaceObjectRevisionRef
  bindings: {
    evidenceItemIds: string[]
    objectRefs: WorkspaceObjectRevisionRef[]
    viewIds: WorkspaceViewId[]
  }
  form: {
    alternativesConsidered: string[]
    kind:
      | 'weekly-decision'
      | 'flow-studio'
      | 'evidence-brief'
      | 'interactive-program'
      | 'record-explorer'
      | 'spatial-map'
      | 'sequential-presentation'
      | 'workflow-state'
    rationale: string
  }
  formChoice: {
    basis?: 'human-self-report' | 'trait-fallback'
    consideredRendererIds: string[]
    composition?: {
      id: string
      instanceId: string
      recipeDigest: string
      role: 'primary' | 'support'
      schemaVersion: 1
      surfaceCount: number
      surfaceIndex: number
    }
    learningGate?: 'eligible' | 'insufficient'
    learningQualifyingCount?: number
    learningReceiptRefs?: WorkspaceObjectRevisionRef[]
    proposalDigest?: string
    proposalId?: string
    proposalOrigin?: 'agent' | 'human'
    rationale: string
    selectedRendererId?: string
    selection?: 'suggestion' | 'user-override'
    suggestedRendererId?: string
    traitSignature?: string[]
    userOverrideRendererId?: string
  }
  intent: WorkspaceObjectRevisionRef
  interactions: SurfaceInteraction[]
  jobKind: SurfaceJobKind
  modes: SurfaceMode[]
  name: string
  recommendations: DecisionRecommendation[]
  rendererId: string
  status: 'in-review' | 'decided' | 'failed'
  type: 'surface-run'
}
export type ExperienceFamilyRelationRef = {
  relationId: string
  revision: number
}
type ExperienceFamilyMemberBaseV1 = {
  artifact: WorkspaceCodeObjectArtifactRevisionRef
  formKind: SurfaceRun['form']['kind']
  instanceId: string
  rendererId: string
  surfaceIndex: number
  surfaceRun: WorkspaceObjectRevisionRef
}
export type PrimaryExperienceFamilyMemberV1 = ExperienceFamilyMemberBaseV1 & {
  role: 'primary'
}
export type SupportExperienceFamilyMemberV1 = ExperienceFamilyMemberBaseV1 & {
  relation: ExperienceFamilyRelationRef
  role: 'support'
}
export type ExperienceFamilyMemberV1 =
  | PrimaryExperienceFamilyMemberV1
  | SupportExperienceFamilyMemberV1
export type ResolvedExperienceFamilyV1 = {
  complete: true
  compositionId: string
  evidenceManifest: WorkspaceObjectRevisionRef
  familyDigest: string
  intent: WorkspaceObjectRevisionRef
  members: ExperienceFamilyMemberV1[]
  primary: PrimaryExperienceFamilyMemberV1
  recipeDigest: string
  relations: ExperienceFamilyRelationRef[]
  schemaVersion: 1
  supports: SupportExperienceFamilyMemberV1[]
  surfaceCount: number
}
export type DecisionReceipt = WorkspaceObjectBase & {
  artifact: WorkspaceCodeObjectArtifactRevisionRef
  corrections: SurfaceInteraction[]
  evidenceManifest: WorkspaceObjectRevisionRef
  immutable: true
  intent: WorkspaceObjectRevisionRef
  outcome: {
    actorId?: string
    decidedAt: string
    finalOrder: string[]
    note?: string
    rejectedRecommendationIds: string[]
    selectedRecommendationIds: string[]
    status: 'approved' | 'rejected' | 'revised'
  }
  surfaceRun: WorkspaceObjectRevisionRef
  type: 'decision-receipt'
}

export type LearningExecutionKind = 'automated' | 'human'
export type LearningOutcome = 'abandoned' | 'failed' | 'passed'
export type LearningFormDisposition = 'accepted' | 'abandoned' | 'overridden'
export type LearningComparisonOutcome = 'better' | 'not-run' | 'same' | 'worse'
export type LearningAttestationKind =
  | 'authenticated-session'
  | 'automated-run'
  | 'observed-session'
  | 'self-report'
export type ObservedSessionDataPolicy = 'phi-free-declared-v1'
export type ObservedSessionTarget = {
  artifact: WorkspaceCodeObjectArtifactRevisionRef
  evidenceManifest: WorkspaceObjectRevisionRef
  intent: WorkspaceObjectRevisionRef
  surfaceRun: WorkspaceObjectRevisionRef
}
export type ObservedExperienceFamilyScopeV2 = {
  family: ResolvedExperienceFamilyV1
  kind: 'experience-family'
  schemaVersion: 1
}
export type ObservedExperienceFamilyFinalMemberV2 = {
  finalArtifactRevision: number
  finalSurfaceRevision: number
  surfaceRunId: string
  taskInteractionCount: number
}
export type ObservedExperienceFamilyFinalV2 = {
  familyDigest: string
  members: ObservedExperienceFamilyFinalMemberV2[]
}
export type ObservedSessionTaskInteraction = {
  after: {
    artifactRevision: number
    surfaceRevision: number
  }
  before: {
    artifactRevision: number
    surfaceRevision: number
  }
  eventId: string
  frameId: string
  kind: 'keydown' | 'pointerdown'
  occurredAt: string
  surfaceRunId: string
}
type ObservedSessionClaimCommon = {
  actorId: string
  dataPolicy: ObservedSessionDataPolicy
  decisionReceiptId: string
  fieldSessionId: string
  finalSurfaceRevision: number
  occurredAt: string
  recordedAt: string
  reviewDigest: string
  runId: string
  surfaceRunId: string
  target: ObservedSessionTarget
  taskInteractionCount: number
  taskInteractionDigest: string
}
export type ObservedSingleSurfaceClaimV1 = ObservedSessionClaimCommon & {
  finalFamily?: never
  scope?: never
  version?: 1
}
export type ObservedExperienceFamilyClaimV2 = ObservedSessionClaimCommon & {
  finalFamily: ObservedExperienceFamilyFinalV2
  scope: ObservedExperienceFamilyScopeV2
  version: 2
}
export type ObservedSessionClaim = ObservedSingleSurfaceClaimV1 | ObservedExperienceFamilyClaimV2
export type ObservedSessionProofMaterial = {
  algorithm: 'ECDSA-P256-SHA256'
  claim: ObservedSessionClaim
  claimDigest: string
  publicKey: JsonWebKey
  signature: string
  taskInteractions: ObservedSessionTaskInteraction[]
}
export type LearningAttestation = {
  attestedAt: string
  attestedBy: string
  authorityRef?: string
  interactionCount?: number
  kind: LearningAttestationKind
  proof?: ObservedSessionProofMaterial
  proofDigest?: string
  sessionId?: string
  sessionStartedAt?: string
}
export type LearningQualitativeFeedback = {
  frictions: string[]
  strengths: string[]
  suggestedChanges: string[]
  summary: string
}
export type LearningComparisonBaseline = {
  contentHash: string
  evidenceManifest: WorkspaceObjectRevisionRef
  intent: WorkspaceObjectRevisionRef
  kind: 'static-answer'
  rendererId: 'static-answer-v1'
  reviewedAt: string
}
export type LearningCompositionOutcome = 'distracted' | 'duplicated' | 'helped'
export type LearningCompositionEvaluation = {
  companionSurface: WorkspaceObjectRevisionRef
  outcome: LearningCompositionOutcome
  primarySurface: WorkspaceObjectRevisionRef
  relation: {
    relationId: WorkspaceRelationId
    revision: number
  }
  reviewedAt: string
}
export type LearningReceipt = WorkspaceObjectBase & {
  attestation: LearningAttestation
  comparisonBaseline?: LearningComparisonBaseline
  comparisonOutcome: LearningComparisonOutcome
  compositionEvaluations?: LearningCompositionEvaluation[]
  decisionReceipt?: WorkspaceObjectRevisionRef
  durableOutcome: boolean
  evidenceManifest: WorkspaceObjectRevisionRef
  evidenceTraceable: boolean
  executionKind: LearningExecutionKind
  formDisposition: LearningFormDisposition
  formId: 'brief' | 'compare' | 'dashboard' | 'decision' | 'map' | 'presentation' | 'tool'
  immutable: true
  intent: WorkspaceObjectRevisionRef
  intentCompleted: boolean
  keyboardAccepted: boolean
  modelId?: string
  occurredAt: string
  outcome: LearningOutcome
  qualitativeFeedback?: LearningQualitativeFeedback
  recordedAt: string
  recordedBy: string
  rendererId: string
  repairCount: number
  runId: string
  safetyViolation: boolean
  surfaceRun: WorkspaceObjectRevisionRef
  type: 'learning-receipt'
  visualAccepted: boolean
}

export type ActionTargetKind = 'external-system' | 'source' | 'workspace'
export type ActionTarget = {
  connectorId?: string
  kind: ActionTargetKind
  label: string
  ref: string
  revision?: string
  route?: string
}
export type ActionProposalStep = {
  description: string
  id: string
  operation: 'create' | 'delete' | 'execute' | 'update'
  payloadDigest: string
  target: ActionTarget
}
export type ActionProposal = WorkspaceObjectBase & {
  authorization: {
    actorId?: string
    authorizedAt?: string
    grantedScopes: string[]
    required: true
    status: 'granted' | 'required' | 'revoked'
  }
  decisionReceipt: WorkspaceObjectRevisionRef
  evidenceManifest: WorkspaceObjectRevisionRef
  executionReceipt?: WorkspaceObjectRevisionRef
  name: string
  requestedCapabilities: {
    externalWrites: boolean
    requiredScopes: string[]
    sourceWrites: boolean
    workspaceWrites: boolean
  }
  rollbackReceipt?: WorkspaceObjectRevisionRef
  status:
    | 'applied'
    | 'authorized'
    | 'failed'
    | 'proposed'
    | 'rollback-failed'
    | 'rolled-back'
    | 'verified'
  steps: ActionProposalStep[]
  type: 'action-proposal'
  verificationReceipt?: WorkspaceObjectRevisionRef
}
export type ActionExecutionTargetResult = {
  afterHash?: string
  beforeHash?: string
  error?: string
  status: 'applied' | 'failed'
  stepId: string
  targetRef: string
}
export type ActionExecutionReceipt = WorkspaceObjectBase & {
  appliedAt: string
  executorId: string
  idempotencyKey: string
  immutable: true
  proposal: WorkspaceObjectRevisionRef
  results: ActionExecutionTargetResult[]
  status: 'applied' | 'failed'
  type: 'action-execution-receipt'
}
export type ActionVerificationCheck = {
  command?: string
  evidenceRef: string
  id: string
  kind: 'external-readback' | 'runtime' | 'test' | 'workspace'
  observedAt: string
  passed: boolean
  resultDigest: string
  targetRef: string
}
export type ActionVerificationReceipt = WorkspaceObjectBase & {
  checks: ActionVerificationCheck[]
  execution: WorkspaceObjectRevisionRef
  immutable: true
  outcome: 'failed' | 'verified'
  proposal: WorkspaceObjectRevisionRef
  type: 'action-verification-receipt'
  verifiedAt: string
  verifiedBy: string
}
export type ActionRollbackTargetResult = {
  afterHash?: string
  beforeHash?: string
  error?: string
  status: 'failed' | 'restored'
  stepId: string
  targetRef: string
}
export type ActionRollbackReceipt = WorkspaceObjectBase & {
  authorization: {
    actorId: string
    authorizedAt: string
    grantedScopes: string[]
  }
  execution: WorkspaceObjectRevisionRef
  idempotencyKey: string
  immutable: true
  proposal: WorkspaceObjectRevisionRef
  reason: string
  results: ActionRollbackTargetResult[]
  rolledBackAt: string
  rolledBackBy: string
  status: 'failed' | 'restored'
  type: 'action-rollback-receipt'
  verification: WorkspaceObjectRevisionRef
}

export type WorkspaceObject =
  | DocumentBlock
  | Collection
  | CollectionRecord
  | SavedView
  | CanvasObject
  | GraphNode
  | GraphEdge
  | DesignArtifact
  | ReviewObject
  | IntentRecord
  | EvidenceManifest
  | SurfaceRun
  | DecisionReceipt
  | LearningReceipt
  | ActionProposal
  | ActionExecutionReceipt
  | ActionVerificationReceipt
  | ActionRollbackReceipt
export type WorkspaceObjectType = WorkspaceObject['type']

export type WorkspaceRelation = {
  archivedAt?: string
  createdAt: string
  direction: GraphDirection
  id: WorkspaceRelationId
  lastWorkspaceRevision: number
  label?: string
  lifecycle: WorkspaceLifecycle
  relationType: string
  revision: number
  sourceId: WorkspaceObjectId
  targetId: WorkspaceObjectId
  updatedAt: string
  workspaceId: WorkspaceId
}
export type WorkspaceView = {
  archivedAt?: string
  createdAt: string
  id: WorkspaceViewId
  kind: WorkspaceViewKind
  lastWorkspaceRevision: number
  lifecycle: WorkspaceLifecycle
  name: string
  primary: boolean
  revision: number
  settings: Record<string, WorkspacePropertyValue>
  updatedAt: string
  workspaceId: WorkspaceId
}
export type WorkspaceMutationReceipt = {
  affectedStableIds: string[]
  archivedStableIds: string[]
  baseRevision: number
  createdStableIds: string[]
  idempotencyKey: string
  mutationId: string
  operationSummaries: string[]
  requestFingerprint: string
  revision: number
  scope: WorkspaceMutationScope
  warnings: string[]
}
export type KnowledgeWorkspace = {
  createdAt: string
  createdBy?: string
  documentId: string
  id: WorkspaceId
  mutationReceipts: Record<string, WorkspaceMutationReceipt>
  name: string
  objects: Record<WorkspaceObjectId, WorkspaceObject>
  pageId: string
  relations: Record<WorkspaceRelationId, WorkspaceRelation>
  revision: number
  schemaVersion: WorkspaceSchemaVersion
  updatedAt: string
  views: Record<WorkspaceViewId, WorkspaceView>
}
export type WorkspaceCreateContext = {
  createdBy?: string
  documentId: string
  now?: string
  pageId: string
  provenance?: WorkspaceProvenance
  workspaceId: WorkspaceId
}
export type WorkspaceMutationResult = {
  affectedStableIds: string[]
  archivedStableIds: string[]
  baseRevision: number
  createdStableIds: string[]
  dryRun: boolean
  idempotentReplay: boolean
  mutationId?: string
  operationSummaries: string[]
  revision: number
  scope: WorkspaceMutationScope
  warnings: string[]
}
export type WorkspaceMutationOutcome = {
  result: WorkspaceMutationResult
  workspace: KnowledgeWorkspace
}
