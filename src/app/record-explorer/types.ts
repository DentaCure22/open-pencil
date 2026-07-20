import type {
  CollectionProperty,
  CollectionRecord,
  DecisionReceipt,
  EvidenceCollectionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  IntentRecord,
  SavedView,
  SavedViewFilter,
  SavedViewSort,
  SurfaceRun,
  WorkspacePropertyValue
} from '@/app/workspace'

export type RecordExplorerViewKind = 'board' | 'list' | 'table'

export type RecordExplorerRecordDefinition = {
  evidenceItemIds?: string[]
  id: string
  properties: Record<string, WorkspacePropertyValue>
  title: string
}

export type RecordExplorerViewDefinition = {
  filters: SavedViewFilter[]
  groupByPropertyId?: string
  id: string
  kind: RecordExplorerViewKind
  label: string
  sorts: SavedViewSort[]
  visiblePropertyIds: string[]
}

export type RecordExplorerDefinition = {
  defaultViewId: string
  fields: CollectionProperty[]
  records: RecordExplorerRecordDefinition[]
  subtitle: string
  views: RecordExplorerViewDefinition[]
}

export type RecordExplorerSpec = RecordExplorerDefinition & {
  capturedAt: string
  collectionReceipt?: EvidenceCollectionReceipt
  evidence: EvidenceManifestItem[]
  formChoice?: SurfaceRun['formChoice']
  id: string
  intent: {
    constraints: string[]
    desiredOutcome: string
    statement: string
  }
  title: string
}

export type RecordExplorerRenderState = {
  activeView: SavedView
  artifactRevision: number
  collectionId: string
  evidence: EvidenceManifest
  focusedRecordId?: string
  intent: IntentRecord
  receipt?: DecisionReceipt
  records: CollectionRecord[]
  spec: RecordExplorerSpec
  surface: SurfaceRun
  workspaceRevision: number
}

export type RecordExplorerEventRequest = {
  action: 'activate-view' | 'approve' | 'focus-record'
  actorId?: string
  eventId: string
  expected: {
    artifactRevision: number
    surfaceRevision: number
    workspaceRevision: number
  }
  note?: string
  surfaceRunId: string
  targetId?: string
}

export type RecordExplorerEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: RecordExplorerRenderState
  status: 'applied' | 'rejected' | 'replayed'
}

export type RecordExplorerCreationResult = {
  boardId: string
  created: boolean
  formRationale: string
  surfaceRunId: string
}
