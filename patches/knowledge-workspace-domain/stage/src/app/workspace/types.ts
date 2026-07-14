import type { Vector } from '@open-pencil/scene-graph/primitives'

export const WORKSPACE_SCHEMA_VERSION = 1 as const

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
export type WorkspacePermissions = { canComment: boolean; canEdit: boolean; canView: boolean }
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
export type CollectionPropertyOption = { color?: string; id: string; label: string }
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
export type SavedViewSort = { direction: 'ascending' | 'descending'; propertyId: string }
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

export type LiveAppRuntimeStatus =
  | 'live'
  | 'captured'
  | 'preview'
  | 'stale'
  | 'illustrative-preview'
  | 'loading'
  | 'auth-required'
  | 'unavailable'
export type LiveAppViewport = {
  deviceScaleFactor?: number
  height: number
  name?: string
  width: number
}
export type LiveAppCapture = {
  assetRef: string
  capturedAt: string
  maskedFieldIds: string[]
  provenance: 'runtime' | 'import' | 'illustrative'
  sourceRevision: string
}
export type LiveAppRuntime = {
  error?: string
  lastHandshakeAt?: string
  status: LiveAppRuntimeStatus
}
export type LiveAppBlock = WorkspaceObjectBase & {
  applicationId: string
  capture?: LiveAppCapture
  environment: string
  fixtureId?: string
  liveContainerRootId?: string
  ownerEvidenceRef?: string
  previewVersionIds: WorkspaceObjectId[]
  responsiveState?: string
  route: string
  runtime: LiveAppRuntime
  scenarioId?: string
  selectedContainerId?: string
  sourceRevision: string
  type: 'live-app-block'
  viewport: LiveAppViewport
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

export type WorkspaceObject =
  | DocumentBlock
  | Collection
  | CollectionRecord
  | SavedView
  | CanvasObject
  | GraphNode
  | GraphEdge
  | DesignArtifact
  | LiveAppBlock
  | ReviewObject
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
  activeRuntimeBlockId?: WorkspaceObjectId
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
