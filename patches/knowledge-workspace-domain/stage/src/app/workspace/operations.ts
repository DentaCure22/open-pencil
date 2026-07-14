import type {
  WorkspaceObject,
  WorkspaceObjectBase,
  WorkspaceObjectType,
  WorkspaceProjection,
  WorkspacePropertyValue,
  WorkspaceRelation,
  WorkspaceView
} from './types'

type ProtectedObjectKey =
  | keyof WorkspaceObjectBase
  | 'type'
  | 'collectionId'
  | 'runtime'
  | 'capture'

export type WorkspaceObjectPatchByType = {
  [ObjectType in WorkspaceObjectType]: Partial<
    Omit<Extract<WorkspaceObject, { type: ObjectType }>, ProtectedObjectKey>
  >
}

export type CreateObjectOperation = { object: WorkspaceObject; type: 'create-object' }
export type UpdateObjectOperation = {
  [ObjectType in WorkspaceObjectType]: {
    expectedObjectRevision: number
    objectId: string
    objectType: ObjectType
    patch: WorkspaceObjectPatchByType[ObjectType]
    type: 'update-object'
  }
}[WorkspaceObjectType]
export type ArchiveObjectOperation = {
  expectedObjectRevision: number
  objectId: string
  type: 'archive-object'
}
export type RestoreObjectOperation = {
  expectedObjectRevision: number
  objectId: string
  type: 'restore-object'
}
export type SetProjectionOperation = {
  expectedObjectRevision: number
  objectId: string
  projection: WorkspaceProjection
  type: 'set-projection'
  viewId: string
}
export type RemoveProjectionOperation = {
  expectedObjectRevision: number
  objectId: string
  type: 'remove-projection'
  viewId: string
}
export type CreateViewOperation = { type: 'create-view'; view: WorkspaceView }
export type UpdateViewOperation = {
  expectedViewRevision: number
  patch: { name?: string; primary?: boolean; settings?: Record<string, WorkspacePropertyValue> }
  type: 'update-view'
  viewId: string
}
export type ArchiveViewOperation = {
  expectedViewRevision: number
  type: 'archive-view'
  viewId: string
}
export type ConnectRelationOperation = { relation: WorkspaceRelation; type: 'connect-relation' }
export type DisconnectRelationOperation = {
  expectedRelationRevision: number
  relationId: string
  type: 'disconnect-relation'
}
export type SetRuntimeOwnerOperation = {
  blockId: string | null
  handshakeAt?: string
  type: 'set-runtime-owner'
}

export type WorkspaceOperation =
  | CreateObjectOperation
  | UpdateObjectOperation
  | ArchiveObjectOperation
  | RestoreObjectOperation
  | SetProjectionOperation
  | RemoveProjectionOperation
  | CreateViewOperation
  | UpdateViewOperation
  | ArchiveViewOperation
  | ConnectRelationOperation
  | DisconnectRelationOperation
  | SetRuntimeOwnerOperation

export type WorkspaceMutationEnvelope = {
  dryRun: boolean
  expectedRevision: number
  idempotencyKey: string
  operations: WorkspaceOperation[]
}
