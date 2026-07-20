import { createWorkspaceId } from './id'
import { WORKSPACE_SCHEMA_VERSION } from './types'
import type {
  ActionExecutionReceipt,
  ActionProposal,
  ActionRollbackReceipt,
  ActionVerificationReceipt,
  CanvasObject,
  CanvasObjectKind,
  Collection,
  CollectionProperty,
  CollectionRecord,
  DecisionReceipt,
  DecisionRecommendation,
  DesignArtifact,
  DesignArtifactKind,
  DesignOwnership,
  DocumentBlock,
  DocumentBlockKind,
  EvidenceManifest,
  EvidenceManifestItem,
  GraphDirection,
  GraphEdge,
  GraphKind,
  GraphNode,
  IntentRecord,
  KnowledgeWorkspace,
  LearningReceipt,
  LiveAppBlock,
  LiveAppCapture,
  LiveAppRuntime,
  LiveAppViewport,
  ReviewObject,
  ReviewObjectKind,
  ReviewStatus,
  SavedView,
  SavedViewFilter,
  SavedViewKind,
  SavedViewSort,
  SurfaceInteraction,
  SurfaceRun,
  WorkspaceCreateContext,
  WorkspaceObjectBase,
  WorkspaceObjectId,
  WorkspacePermissions,
  WorkspaceProjection,
  WorkspacePropertyValue,
  WorkspaceProvenance,
  WorkspaceHtmlArtifactRevisionRef,
  WorkspaceObjectRevisionRef,
  WorkspaceRelation,
  WorkspaceView,
  WorkspaceViewKind
} from './types'

const DEFAULT_PERMISSIONS: WorkspacePermissions = {
  canComment: true,
  canEdit: true,
  canView: true
}
const DEFAULT_PROVENANCE: WorkspaceProvenance = { kind: 'user' }

export type CreateKnowledgeWorkspaceInput = {
  createdBy?: string
  documentId: string
  id?: string
  name: string
  now?: string
  pageId: string
}

export type ObjectMetadataInput = {
  collectionId?: WorkspaceObjectId
  commentIds?: WorkspaceObjectId[]
  createdBy?: string
  id?: WorkspaceObjectId
  parentId?: WorkspaceObjectId
  permissions?: WorkspacePermissions
  projections?: Record<string, WorkspaceProjection>
  provenance?: WorkspaceProvenance
  tags?: string[]
}

export type CreateWorkspaceViewInput = {
  experienceProjection?: WorkspaceView['experienceProjection']
  id?: string
  kind: WorkspaceViewKind
  name: string
  now?: string
  primary?: boolean
  settings?: Record<string, WorkspacePropertyValue>
  workspaceId: string
}

function timestamp(value?: string): string {
  return value ?? new Date().toISOString()
}

function objectBase(
  context: WorkspaceCreateContext,
  objectType: Parameters<typeof createWorkspaceId>[0],
  metadata: ObjectMetadataInput
): WorkspaceObjectBase {
  const now = timestamp(context.now)
  return {
    collectionId: metadata.collectionId,
    commentIds: [...(metadata.commentIds ?? [])],
    createdAt: now,
    createdBy: metadata.createdBy ?? context.createdBy,
    documentId: context.documentId,
    id: metadata.id ?? createWorkspaceId(objectType),
    lastWorkspaceRevision: 0,
    lifecycle: 'active',
    pageId: context.pageId,
    parentId: metadata.parentId,
    permissions: structuredClone(metadata.permissions ?? DEFAULT_PERMISSIONS),
    projections: structuredClone(metadata.projections ?? {}),
    provenance: structuredClone(metadata.provenance ?? context.provenance ?? DEFAULT_PROVENANCE),
    revision: 0,
    tags: [...new Set(metadata.tags)],
    updatedAt: now,
    workspaceId: context.workspaceId
  }
}

export function createKnowledgeWorkspace(input: CreateKnowledgeWorkspaceInput): KnowledgeWorkspace {
  const now = timestamp(input.now)
  return {
    createdAt: now,
    createdBy: input.createdBy,
    documentId: input.documentId,
    id: input.id ?? createWorkspaceId('workspace'),
    mutationReceipts: {},
    name: input.name,
    objects: {},
    pageId: input.pageId,
    relations: {},
    revision: 0,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    updatedAt: now,
    views: {}
  }
}

export function createWorkspaceContext(
  workspace: KnowledgeWorkspace,
  overrides: Pick<WorkspaceCreateContext, 'createdBy' | 'now' | 'provenance'> = {}
): WorkspaceCreateContext {
  return {
    createdBy: overrides.createdBy ?? workspace.createdBy,
    documentId: workspace.documentId,
    now: overrides.now,
    pageId: workspace.pageId,
    provenance: overrides.provenance,
    workspaceId: workspace.id
  }
}

export function createWorkspaceView(input: CreateWorkspaceViewInput): WorkspaceView {
  const now = timestamp(input.now)
  return {
    createdAt: now,
    experienceProjection: structuredClone(input.experienceProjection),
    id: input.id ?? createWorkspaceId('view'),
    kind: input.kind,
    lastWorkspaceRevision: 0,
    lifecycle: 'active',
    name: input.name,
    primary: input.primary ?? false,
    revision: 0,
    settings: structuredClone(input.settings ?? {}),
    updatedAt: now,
    workspaceId: input.workspaceId
  }
}

export type CreateDocumentBlockInput = ObjectMetadataInput & {
  attributes?: Record<string, WorkspacePropertyValue>
  blockKind: DocumentBlockKind
  checked?: boolean
  childIds?: WorkspaceObjectId[]
  language?: string
  order?: number
  text?: string
}

export function createDocumentBlock(
  context: WorkspaceCreateContext,
  input: CreateDocumentBlockInput
): DocumentBlock {
  return {
    ...objectBase(context, 'document-block', input),
    attributes: structuredClone(input.attributes ?? {}),
    blockKind: input.blockKind,
    checked: input.checked,
    childIds: [...(input.childIds ?? [])],
    language: input.language,
    order: input.order ?? 0,
    text: input.text ?? '',
    type: 'document-block'
  }
}

export type CreateCollectionInput = ObjectMetadataInput & {
  description?: string
  name: string
  properties?: CollectionProperty[]
  recordIds?: WorkspaceObjectId[]
  savedViewIds?: WorkspaceObjectId[]
}

export function createCollection(
  context: WorkspaceCreateContext,
  input: CreateCollectionInput
): Collection {
  return {
    ...objectBase(context, 'collection', input),
    description: input.description,
    name: input.name,
    properties: structuredClone(input.properties ?? []),
    recordIds: [...(input.recordIds ?? [])],
    savedViewIds: [...(input.savedViewIds ?? [])],
    type: 'collection'
  }
}

export type CreateCollectionRecordInput = ObjectMetadataInput & {
  bodyBlockIds?: WorkspaceObjectId[]
  collectionId: WorkspaceObjectId
  properties?: Record<string, WorkspacePropertyValue>
  title: string
}

export function createCollectionRecord(
  context: WorkspaceCreateContext,
  input: CreateCollectionRecordInput
): CollectionRecord {
  return {
    ...objectBase(context, 'collection-record', { ...input, collectionId: input.collectionId }),
    bodyBlockIds: [...(input.bodyBlockIds ?? [])],
    collectionId: input.collectionId,
    properties: structuredClone(input.properties ?? {}),
    title: input.title,
    type: 'collection-record'
  }
}

export type CreateSavedViewInput = ObjectMetadataInput & {
  collectionId: WorkspaceObjectId
  filters?: SavedViewFilter[]
  groupByPropertyId?: string
  name: string
  sorts?: SavedViewSort[]
  viewKind: SavedViewKind
  visiblePropertyIds?: string[]
}

export function createSavedView(
  context: WorkspaceCreateContext,
  input: CreateSavedViewInput
): SavedView {
  return {
    ...objectBase(context, 'saved-view', { ...input, collectionId: input.collectionId }),
    collectionId: input.collectionId,
    filters: structuredClone(input.filters ?? []),
    groupByPropertyId: input.groupByPropertyId,
    name: input.name,
    sorts: structuredClone(input.sorts ?? []),
    type: 'saved-view',
    viewKind: input.viewKind,
    visiblePropertyIds: [...(input.visiblePropertyIds ?? [])]
  }
}

export type CreateCanvasObjectInput = ObjectMetadataInput & {
  canvasKind: CanvasObjectKind
  data?: Record<string, WorkspacePropertyValue>
  label?: string
  sceneNodeId?: string
}

export function createCanvasObject(
  context: WorkspaceCreateContext,
  input: CreateCanvasObjectInput
): CanvasObject {
  return {
    ...objectBase(context, 'canvas-object', input),
    canvasKind: input.canvasKind,
    data: structuredClone(input.data ?? {}),
    label: input.label,
    sceneNodeId: input.sceneNodeId,
    type: 'canvas-object'
  }
}

export type CreateGraphNodeInput = ObjectMetadataInput & {
  data?: Record<string, WorkspacePropertyValue>
  graphId: string
  graphKind: GraphKind
  label: string
  layoutRole?: string
}

export function createGraphNode(
  context: WorkspaceCreateContext,
  input: CreateGraphNodeInput
): GraphNode {
  return {
    ...objectBase(context, 'graph-node', input),
    data: structuredClone(input.data ?? {}),
    graphId: input.graphId,
    graphKind: input.graphKind,
    label: input.label,
    layoutRole: input.layoutRole,
    type: 'graph-node'
  }
}

export type CreateGraphEdgeInput = ObjectMetadataInput & {
  condition?: string
  confidence?: number
  direction?: GraphDirection
  graphId: string
  graphKind: GraphKind
  label?: string
  relationshipType: string
  sourceId: WorkspaceObjectId
  targetId: WorkspaceObjectId
}

export function createGraphEdge(
  context: WorkspaceCreateContext,
  input: CreateGraphEdgeInput
): GraphEdge {
  return {
    ...objectBase(context, 'graph-edge', input),
    condition: input.condition,
    confidence: input.confidence,
    direction: input.direction ?? 'directed',
    graphId: input.graphId,
    graphKind: input.graphKind,
    label: input.label,
    relationshipType: input.relationshipType,
    sourceId: input.sourceId,
    targetId: input.targetId,
    type: 'graph-edge'
  }
}

export type CreateDesignArtifactInput = ObjectMetadataInput & {
  artifactKind: DesignArtifactKind
  data?: Record<string, WorkspacePropertyValue>
  label: string
  ownership?: DesignOwnership
  previewVersionId?: WorkspaceObjectId
  sourceRef?: string
}

export function createDesignArtifact(
  context: WorkspaceCreateContext,
  input: CreateDesignArtifactInput
): DesignArtifact {
  return {
    ...objectBase(context, 'design-artifact', input),
    artifactKind: input.artifactKind,
    data: structuredClone(input.data ?? {}),
    label: input.label,
    ownership: input.ownership ?? 'workspace',
    previewVersionId: input.previewVersionId,
    sourceRef: input.sourceRef,
    type: 'design-artifact'
  }
}

export type CreateLiveAppBlockInput = ObjectMetadataInput & {
  applicationId: string
  capture?: LiveAppCapture
  environment: string
  fixtureId?: string
  liveContainerRootId?: string
  ownerEvidenceRef?: string
  previewVersionIds?: WorkspaceObjectId[]
  responsiveState?: string
  route: string
  runtime?: LiveAppRuntime
  scenarioId?: string
  selectedContainerId?: string
  sourceRevision: string
  viewport: LiveAppViewport
}

export function createLiveAppBlock(
  context: WorkspaceCreateContext,
  input: CreateLiveAppBlockInput
): LiveAppBlock {
  return {
    ...objectBase(context, 'live-app-block', input),
    applicationId: input.applicationId,
    capture: structuredClone(input.capture),
    environment: input.environment,
    fixtureId: input.fixtureId,
    liveContainerRootId: input.liveContainerRootId,
    ownerEvidenceRef: input.ownerEvidenceRef,
    previewVersionIds: [...(input.previewVersionIds ?? [])],
    responsiveState: input.responsiveState,
    route: input.route,
    runtime: structuredClone(input.runtime ?? { status: 'unavailable' }),
    scenarioId: input.scenarioId,
    selectedContainerId: input.selectedContainerId,
    sourceRevision: input.sourceRevision,
    type: 'live-app-block',
    viewport: structuredClone(input.viewport)
  }
}

export type CreateReviewObjectInput = ObjectMetadataInput & {
  attachedObjectIds?: WorkspaceObjectId[]
  attachedRevisions?: Record<WorkspaceObjectId, number>
  body: string
  reviewKind: ReviewObjectKind
  reviewStatus?: ReviewStatus
}

export function createReviewObject(
  context: WorkspaceCreateContext,
  input: CreateReviewObjectInput
): ReviewObject {
  return {
    ...objectBase(context, 'review-object', input),
    attachedObjectIds: [...(input.attachedObjectIds ?? [])],
    attachedRevisions: structuredClone(input.attachedRevisions ?? {}),
    body: input.body,
    reviewKind: input.reviewKind,
    reviewStatus: input.reviewStatus ?? 'open',
    type: 'review-object'
  }
}

const IMMUTABLE_PERMISSIONS: WorkspacePermissions = {
  canComment: true,
  canEdit: false,
  canView: true
}

export type CreateIntentRecordInput = ObjectMetadataInput & {
  capturedAt: string
  constraints?: string[]
  desiredOutcome: string
  inputMode?: 'text' | 'trace'
  statement: string
}

export function createIntentRecord(
  context: WorkspaceCreateContext,
  input: CreateIntentRecordInput
): IntentRecord {
  return {
    ...objectBase(context, 'intent-record', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    capturedAt: input.capturedAt,
    constraints: [...(input.constraints ?? [])],
    desiredOutcome: input.desiredOutcome,
    inputMode: input.inputMode ?? 'text',
    locked: true,
    statement: input.statement,
    type: 'intent-record'
  }
}

export type CreateEvidenceManifestInput = ObjectMetadataInput & {
  collectionReceipt?: EvidenceManifest['collectionReceipt']
  intent: WorkspaceObjectRevisionRef
  items: EvidenceManifestItem[]
  snapshotAt: string
  status?: 'ready' | 'partial'
}

export function createEvidenceManifest(
  context: WorkspaceCreateContext,
  input: CreateEvidenceManifestInput
): EvidenceManifest {
  return {
    ...objectBase(context, 'evidence-manifest', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    collectionReceipt: structuredClone(input.collectionReceipt),
    immutable: true,
    intent: structuredClone(input.intent),
    items: structuredClone(input.items),
    snapshotAt: input.snapshotAt,
    status: input.status ?? 'ready',
    type: 'evidence-manifest'
  }
}

export type CreateSurfaceRunInput = ObjectMetadataInput & {
  alternativesConsidered?: string[]
  artifact: WorkspaceHtmlArtifactRevisionRef
  bindings?: SurfaceRun['bindings']
  evidenceManifest: WorkspaceObjectRevisionRef
  formChoice?: SurfaceRun['formChoice']
  formKind?: SurfaceRun['form']['kind']
  formRationale: string
  intent: WorkspaceObjectRevisionRef
  interactions?: SurfaceInteraction[]
  jobKind?: SurfaceRun['jobKind']
  modes?: SurfaceRun['modes']
  name: string
  recommendations: DecisionRecommendation[]
  rendererId?: string
  status?: 'in-review' | 'decided' | 'failed'
}

export function createSurfaceRun(
  context: WorkspaceCreateContext,
  input: CreateSurfaceRunInput
): SurfaceRun {
  return {
    ...objectBase(context, 'surface-run', input),
    artifact: structuredClone(input.artifact),
    bindings: structuredClone(
      input.bindings ?? {
        evidenceItemIds: [],
        objectRefs: [input.intent, input.evidenceManifest],
        viewIds: []
      }
    ),
    capabilities: { externalWrites: false, networkAccess: false, sourceWrites: false },
    evidenceManifest: structuredClone(input.evidenceManifest),
    form: {
      alternativesConsidered: structuredClone(
        input.alternativesConsidered ?? ['plain-prose', 'static-priority-list']
      ),
      kind: input.formKind ?? 'weekly-decision',
      rationale: input.formRationale
    },
    formChoice: structuredClone(
      input.formChoice ?? {
        consideredRendererIds: ['weekly-decision-v1', 'plain-prose'],
        rationale: input.formRationale
      }
    ),
    intent: structuredClone(input.intent),
    interactions: structuredClone(input.interactions ?? []),
    jobKind: input.jobKind ?? 'decide',
    modes: structuredClone(
      input.modes ?? [
        { id: 'mode-focus', kind: 'focus', label: 'Focus' },
        { id: 'mode-review', kind: 'review', label: 'Review' }
      ]
    ),
    name: input.name,
    recommendations: structuredClone(input.recommendations),
    rendererId: input.rendererId ?? 'weekly-decision-v1',
    status: input.status ?? 'in-review',
    type: 'surface-run'
  }
}

export type CreateDecisionReceiptInput = ObjectMetadataInput & {
  artifact: WorkspaceHtmlArtifactRevisionRef
  corrections: SurfaceInteraction[]
  evidenceManifest: WorkspaceObjectRevisionRef
  intent: WorkspaceObjectRevisionRef
  outcome: DecisionReceipt['outcome']
  surfaceRun: WorkspaceObjectRevisionRef
}

export function createDecisionReceipt(
  context: WorkspaceCreateContext,
  input: CreateDecisionReceiptInput
): DecisionReceipt {
  return {
    ...objectBase(context, 'decision-receipt', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    artifact: structuredClone(input.artifact),
    corrections: structuredClone(input.corrections),
    evidenceManifest: structuredClone(input.evidenceManifest),
    immutable: true,
    intent: structuredClone(input.intent),
    outcome: structuredClone(input.outcome),
    surfaceRun: structuredClone(input.surfaceRun),
    type: 'decision-receipt'
  }
}

export type CreateLearningReceiptInput = ObjectMetadataInput &
  Omit<LearningReceipt, keyof WorkspaceObjectBase | 'immutable' | 'type'>

export function createLearningReceipt(
  context: WorkspaceCreateContext,
  input: CreateLearningReceiptInput
): LearningReceipt {
  return {
    ...objectBase(context, 'learning-receipt', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    attestation: structuredClone(input.attestation),
    comparisonBaseline: structuredClone(input.comparisonBaseline),
    comparisonOutcome: input.comparisonOutcome,
    compositionEvaluations: structuredClone(input.compositionEvaluations),
    decisionReceipt: structuredClone(input.decisionReceipt),
    durableOutcome: input.durableOutcome,
    evidenceManifest: structuredClone(input.evidenceManifest),
    evidenceTraceable: input.evidenceTraceable,
    executionKind: input.executionKind,
    formDisposition: input.formDisposition,
    formId: input.formId,
    immutable: true,
    intent: structuredClone(input.intent),
    intentCompleted: input.intentCompleted,
    keyboardAccepted: input.keyboardAccepted,
    modelId: input.modelId,
    occurredAt: input.occurredAt,
    outcome: input.outcome,
    qualitativeFeedback: structuredClone(input.qualitativeFeedback),
    recordedAt: input.recordedAt,
    recordedBy: input.recordedBy,
    rendererId: input.rendererId,
    repairCount: input.repairCount,
    runId: input.runId,
    safetyViolation: input.safetyViolation,
    surfaceRun: structuredClone(input.surfaceRun),
    type: 'learning-receipt',
    visualAccepted: input.visualAccepted
  }
}

export type CreateActionProposalInput = ObjectMetadataInput & {
  authorization?: ActionProposal['authorization']
  decisionReceipt: WorkspaceObjectRevisionRef
  evidenceManifest: WorkspaceObjectRevisionRef
  executionReceipt?: WorkspaceObjectRevisionRef
  name: string
  requestedCapabilities: ActionProposal['requestedCapabilities']
  rollbackReceipt?: WorkspaceObjectRevisionRef
  status?: ActionProposal['status']
  steps: ActionProposal['steps']
  verificationReceipt?: WorkspaceObjectRevisionRef
}

export function createActionProposal(
  context: WorkspaceCreateContext,
  input: CreateActionProposalInput
): ActionProposal {
  return {
    ...objectBase(context, 'action-proposal', input),
    authorization: structuredClone(
      input.authorization ?? {
        grantedScopes: [],
        required: true,
        status: 'required'
      }
    ),
    decisionReceipt: structuredClone(input.decisionReceipt),
    evidenceManifest: structuredClone(input.evidenceManifest),
    executionReceipt: structuredClone(input.executionReceipt),
    name: input.name,
    requestedCapabilities: structuredClone(input.requestedCapabilities),
    rollbackReceipt: structuredClone(input.rollbackReceipt),
    status: input.status ?? 'proposed',
    steps: structuredClone(input.steps),
    type: 'action-proposal',
    verificationReceipt: structuredClone(input.verificationReceipt)
  }
}

export type CreateActionExecutionReceiptInput = ObjectMetadataInput & {
  appliedAt: string
  executorId: string
  idempotencyKey: string
  proposal: WorkspaceObjectRevisionRef
  results: ActionExecutionReceipt['results']
  status: ActionExecutionReceipt['status']
}

export function createActionExecutionReceipt(
  context: WorkspaceCreateContext,
  input: CreateActionExecutionReceiptInput
): ActionExecutionReceipt {
  return {
    ...objectBase(context, 'action-execution-receipt', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    appliedAt: input.appliedAt,
    executorId: input.executorId,
    idempotencyKey: input.idempotencyKey,
    immutable: true,
    proposal: structuredClone(input.proposal),
    results: structuredClone(input.results),
    status: input.status,
    type: 'action-execution-receipt'
  }
}

export type CreateActionVerificationReceiptInput = ObjectMetadataInput & {
  checks: ActionVerificationReceipt['checks']
  execution: WorkspaceObjectRevisionRef
  outcome: ActionVerificationReceipt['outcome']
  proposal: WorkspaceObjectRevisionRef
  verifiedAt: string
  verifiedBy: string
}

export function createActionVerificationReceipt(
  context: WorkspaceCreateContext,
  input: CreateActionVerificationReceiptInput
): ActionVerificationReceipt {
  return {
    ...objectBase(context, 'action-verification-receipt', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    checks: structuredClone(input.checks),
    execution: structuredClone(input.execution),
    immutable: true,
    outcome: input.outcome,
    proposal: structuredClone(input.proposal),
    type: 'action-verification-receipt',
    verifiedAt: input.verifiedAt,
    verifiedBy: input.verifiedBy
  }
}

export type CreateActionRollbackReceiptInput = ObjectMetadataInput & {
  authorization: ActionRollbackReceipt['authorization']
  execution: WorkspaceObjectRevisionRef
  idempotencyKey: string
  proposal: WorkspaceObjectRevisionRef
  reason: string
  results: ActionRollbackReceipt['results']
  rolledBackAt: string
  rolledBackBy: string
  status: ActionRollbackReceipt['status']
  verification: WorkspaceObjectRevisionRef
}

export function createActionRollbackReceipt(
  context: WorkspaceCreateContext,
  input: CreateActionRollbackReceiptInput
): ActionRollbackReceipt {
  return {
    ...objectBase(context, 'action-rollback-receipt', {
      ...input,
      permissions: IMMUTABLE_PERMISSIONS
    }),
    authorization: structuredClone(input.authorization),
    execution: structuredClone(input.execution),
    idempotencyKey: input.idempotencyKey,
    immutable: true,
    proposal: structuredClone(input.proposal),
    reason: input.reason,
    results: structuredClone(input.results),
    rolledBackAt: input.rolledBackAt,
    rolledBackBy: input.rolledBackBy,
    status: input.status,
    type: 'action-rollback-receipt',
    verification: structuredClone(input.verification)
  }
}

export type CreateWorkspaceRelationInput = {
  direction?: GraphDirection
  id?: string
  label?: string
  now?: string
  relationType: string
  sourceId: WorkspaceObjectId
  targetId: WorkspaceObjectId
  workspaceId: string
}

export function createWorkspaceRelation(input: CreateWorkspaceRelationInput): WorkspaceRelation {
  const now = timestamp(input.now)
  return {
    createdAt: now,
    direction: input.direction ?? 'directed',
    id: input.id ?? createWorkspaceId('relation'),
    label: input.label,
    lastWorkspaceRevision: 0,
    lifecycle: 'active',
    relationType: input.relationType,
    revision: 0,
    sourceId: input.sourceId,
    targetId: input.targetId,
    updatedAt: now,
    workspaceId: input.workspaceId
  }
}
