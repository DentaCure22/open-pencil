import type {
  DecisionReceipt,
  EvidenceCollectionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  GraphEdge,
  GraphNode,
  IntentRecord,
  SurfaceRun,
  WorkspaceObjectRevisionRef
} from '@/app/workspace'

export type SpatialMapSharedLineage = {
  evidenceManifest: WorkspaceObjectRevisionRef
  intent: WorkspaceObjectRevisionRef
  primarySurfaceRun: WorkspaceObjectRevisionRef
}

export type SpatialMapNodeKind = 'capability' | 'constraint' | 'foundation' | 'intent' | 'outcome'

export type SpatialMapNodeStatus = 'missing' | 'partial' | 'proven'

export type SpatialMapNodeSpec = {
  evidenceItemIds: string[]
  id: string
  kind: SpatialMapNodeKind
  label: string
  status: SpatialMapNodeStatus
  summary: string
}

export type SpatialMapEdgeSpec = {
  confidence: number
  id: string
  label: string
  relationshipType: 'blocks' | 'depends-on' | 'enables' | 'produces'
  sourceId: string
  targetId: string
}

export type SpatialMapSpec = {
  capturedAt: string
  collectionReceipt?: EvidenceCollectionReceipt
  defaultFocusedNodeId: string
  edges: SpatialMapEdgeSpec[]
  evidence: EvidenceManifestItem[]
  formChoice?: SurfaceRun['formChoice']
  id: string
  insight: string
  intent: {
    constraints: string[]
    desiredOutcome: string
    statement: string
  }
  nodes: SpatialMapNodeSpec[]
  question: string
  sharedLineage?: SpatialMapSharedLineage
  title: string
}

export type SpatialMapLayoutNode = SpatialMapNodeSpec & {
  layer: number
  workspaceObjectId: string
  x: number
  y: number
}

export type SpatialMapLayoutEdge = SpatialMapEdgeSpec & {
  path: string
  workspaceObjectId: string
}

export type SpatialMapModel = {
  criticalPathNodeIds: string[]
  edges: SpatialMapLayoutEdge[]
  focusedNodeId: string
  leafNodeIds: string[]
  nodes: SpatialMapLayoutNode[]
  rootNodeIds: string[]
}

export type SpatialMapObjectIds = {
  board: string
  edges: Record<string, string>
  evidenceManifest: string
  graph: string
  intent: string
  nodes: Record<string, string>
  surface: string
}

export type SpatialMapRenderState = {
  artifactRevision: number
  evidence: EvidenceManifest
  graphEdges: GraphEdge[]
  graphNodes: GraphNode[]
  intent: IntentRecord
  model: SpatialMapModel
  receipt?: DecisionReceipt
  spec: SpatialMapSpec
  surface: SurfaceRun
  workspaceRevision: number
}

export type SpatialMapEventRequest = {
  action: 'approve' | 'focus-node'
  actorId?: string
  eventId: string
  expected: {
    artifactRevision: number
    surfaceRevision: number
    workspaceRevision: number
  }
  nodeId?: string
  note?: string
  surfaceRunId: string
}

export type SpatialMapEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: SpatialMapRenderState
  status: 'applied' | 'rejected' | 'replayed'
}

export type SpatialMapCreationResult = {
  boardId: string
  created: boolean
  formRationale: string
  surfaceRunId: string
}
