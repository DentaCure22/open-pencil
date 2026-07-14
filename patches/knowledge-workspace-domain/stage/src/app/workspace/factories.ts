import { createWorkspaceId } from './id'
import { WORKSPACE_SCHEMA_VERSION } from './types'
import type {
  CanvasObject,
  CanvasObjectKind,
  Collection,
  CollectionProperty,
  CollectionRecord,
  DesignArtifact,
  DesignArtifactKind,
  DesignOwnership,
  DocumentBlock,
  DocumentBlockKind,
  GraphDirection,
  GraphEdge,
  GraphKind,
  GraphNode,
  KnowledgeWorkspace,
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
  WorkspaceCreateContext,
  WorkspaceObjectBase,
  WorkspaceObjectId,
  WorkspacePermissions,
  WorkspaceProjection,
  WorkspacePropertyValue,
  WorkspaceProvenance,
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
