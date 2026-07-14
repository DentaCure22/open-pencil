import { WorkspaceDomainError } from './errors'
import { createWorkspaceId } from './id'
import type {
  ArchiveObjectOperation,
  ArchiveViewOperation,
  ConnectRelationOperation,
  CreateObjectOperation,
  CreateViewOperation,
  DisconnectRelationOperation,
  RemoveProjectionOperation,
  RestoreObjectOperation,
  SetProjectionOperation,
  SetRuntimeOwnerOperation,
  UpdateObjectOperation,
  UpdateViewOperation,
  WorkspaceMutationEnvelope,
  WorkspaceOperation
} from './operations'
import { rememberMutationReceipt, replayReceipt, requestFingerprint } from './receipts'
import type {
  KnowledgeWorkspace,
  LiveAppBlock,
  WorkspaceMutationOutcome,
  WorkspaceObject,
  WorkspaceRelation,
  WorkspaceView
} from './types'

type MutableSummary = {
  affected: Set<string>
  archived: Set<string>
  created: Set<string>
  operations: string[]
  warnings: string[]
}

function withoutRecordKey<Value>(record: Record<string, Value>, excludedKey: string) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== excludedKey))
}

function requireExpectedRevision(expected: number, current: number, label: string): void {
  if (!Number.isInteger(expected) || expected !== current) {
    throw new WorkspaceDomainError(
      'revision_conflict',
      `${label} expected revision ${expected}, current revision ${current}`
    )
  }
}

function requireObject(workspace: KnowledgeWorkspace, objectId: string): WorkspaceObject {
  if (!Object.hasOwn(workspace.objects, objectId)) {
    throw new WorkspaceDomainError('not_found', `workspace object ${objectId}`)
  }
  return workspace.objects[objectId]
}

function requireView(workspace: KnowledgeWorkspace, viewId: string): WorkspaceView {
  if (!Object.hasOwn(workspace.views, viewId)) {
    throw new WorkspaceDomainError('not_found', `workspace view ${viewId}`)
  }
  return workspace.views[viewId]
}

function requireRelation(workspace: KnowledgeWorkspace, relationId: string): WorkspaceRelation {
  if (!Object.hasOwn(workspace.relations, relationId)) {
    throw new WorkspaceDomainError('not_found', `workspace relation ${relationId}`)
  }
  return workspace.relations[relationId]
}

function validateObjectScope(workspace: KnowledgeWorkspace, object: WorkspaceObject): void {
  if (
    object.workspaceId !== workspace.id ||
    object.documentId !== workspace.documentId ||
    object.pageId !== workspace.pageId
  ) {
    throw new WorkspaceDomainError(
      'scope_conflict',
      `object ${object.id} must belong to workspace ${workspace.id}, document ${workspace.documentId}, page ${workspace.pageId}`
    )
  }
}

function stampObject(object: WorkspaceObject, now: string): WorkspaceObject {
  return { ...structuredClone(object), revision: object.revision + 1, updatedAt: now }
}

function updateCollectionMembership(
  workspace: KnowledgeWorkspace,
  object: WorkspaceObject,
  now: string,
  summary: MutableSummary
): void {
  if (object.type !== 'collection-record' && object.type !== 'saved-view') return
  const collection = requireObject(workspace, object.collectionId)
  if (collection.type !== 'collection') {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${object.collectionId} is not a collection`
    )
  }
  const property = object.type === 'collection-record' ? 'recordIds' : 'savedViewIds'
  if (collection[property].includes(object.id)) return
  workspace.objects[collection.id] = stampObject(
    { ...collection, [property]: [...collection[property], object.id] },
    now
  )
  summary.affected.add(collection.id)
}

function updateDocumentParent(
  workspace: KnowledgeWorkspace,
  object: WorkspaceObject,
  now: string,
  summary: MutableSummary
): void {
  if (object.type !== 'document-block' || !object.parentId) return
  const parent = requireObject(workspace, object.parentId)
  if (parent.type !== 'document-block') {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${object.parentId} is not a document block`
    )
  }
  if (parent.childIds.includes(object.id)) return
  workspace.objects[parent.id] = stampObject(
    { ...parent, childIds: [...parent.childIds, object.id] },
    now
  )
  summary.affected.add(parent.id)
}

function createObject(
  workspace: KnowledgeWorkspace,
  operation: CreateObjectOperation,
  now: string,
  summary: MutableSummary
): void {
  const object = structuredClone(operation.object)
  validateObjectScope(workspace, object)
  if (Object.hasOwn(workspace.objects, object.id)) {
    throw new WorkspaceDomainError('duplicate_id', `workspace object ${object.id}`)
  }
  if (object.revision !== 0) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `new object ${object.id} must have revision 0`
    )
  }
  if (object.type === 'graph-edge') {
    requireObject(workspace, object.sourceId)
    requireObject(workspace, object.targetId)
  }
  const created = stampObject(object, now)
  workspace.objects[created.id] = created
  updateCollectionMembership(workspace, created, now, summary)
  updateDocumentParent(workspace, created, now, summary)
  summary.affected.add(created.id)
  summary.created.add(created.id)
  summary.operations.push(`Created ${created.type} ${created.id}`)
}

function updateObject(
  workspace: KnowledgeWorkspace,
  operation: UpdateObjectOperation,
  now: string,
  summary: MutableSummary
): void {
  const current = requireObject(workspace, operation.objectId)
  requireExpectedRevision(
    operation.expectedObjectRevision,
    current.revision,
    `object ${current.id}`
  )
  if (current.type !== operation.objectType) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `object ${current.id} is ${current.type}, not ${operation.objectType}`
    )
  }
  const updated = stampObject(
    { ...current, ...structuredClone(operation.patch) } as WorkspaceObject,
    now
  )
  validateObjectScope(workspace, updated)
  workspace.objects[current.id] = updated
  summary.affected.add(current.id)
  summary.operations.push(`Updated ${current.type} ${current.id}`)
}

function setObjectLifecycle(
  workspace: KnowledgeWorkspace,
  operation: ArchiveObjectOperation | RestoreObjectOperation,
  now: string,
  summary: MutableSummary
): void {
  const object = requireObject(workspace, operation.objectId)
  requireExpectedRevision(operation.expectedObjectRevision, object.revision, `object ${object.id}`)
  const archive = operation.type === 'archive-object'
  if ((archive && object.lifecycle === 'archived') || (!archive && object.lifecycle === 'active')) {
    throw new WorkspaceDomainError(
      'archive_conflict',
      `object ${object.id} is already ${object.lifecycle}`
    )
  }
  const next = stampObject(
    {
      ...object,
      archivedAt: archive ? now : undefined,
      lifecycle: archive ? 'archived' : 'active'
    },
    now
  )
  workspace.objects[object.id] = next
  summary.affected.add(object.id)
  if (archive) summary.archived.add(object.id)
  summary.operations.push(`${archive ? 'Archived' : 'Restored'} ${object.type} ${object.id}`)
}

function setProjection(
  workspace: KnowledgeWorkspace,
  operation: SetProjectionOperation | RemoveProjectionOperation,
  now: string,
  summary: MutableSummary
): void {
  const object = requireObject(workspace, operation.objectId)
  requireExpectedRevision(operation.expectedObjectRevision, object.revision, `object ${object.id}`)
  requireView(workspace, operation.viewId)
  const projections =
    operation.type === 'set-projection'
      ? {
          ...structuredClone(object.projections),
          [operation.viewId]: structuredClone(operation.projection)
        }
      : withoutRecordKey(object.projections, operation.viewId)
  workspace.objects[object.id] = stampObject({ ...object, projections }, now)
  summary.affected.add(object.id)
  summary.operations.push(
    `${operation.type === 'set-projection' ? 'Set' : 'Removed'} projection ${operation.viewId} for ${object.id}`
  )
}

function createView(
  workspace: KnowledgeWorkspace,
  operation: CreateViewOperation,
  now: string,
  summary: MutableSummary
): void {
  const view = structuredClone(operation.view)
  if (view.workspaceId !== workspace.id) {
    throw new WorkspaceDomainError('scope_conflict', `view ${view.id} belongs to another workspace`)
  }
  if (Object.hasOwn(workspace.views, view.id)) {
    throw new WorkspaceDomainError('duplicate_id', `workspace view ${view.id}`)
  }
  if (view.revision !== 0) {
    throw new WorkspaceDomainError('validation_failed', `new view ${view.id} must have revision 0`)
  }
  if (view.primary) {
    for (const current of Object.values(workspace.views)) {
      if (!current.primary || current.lifecycle === 'archived') continue
      workspace.views[current.id] = {
        ...current,
        primary: false,
        revision: current.revision + 1,
        updatedAt: now
      }
      summary.affected.add(current.id)
    }
  }
  workspace.views[view.id] = { ...view, revision: 1, updatedAt: now }
  summary.affected.add(view.id)
  summary.created.add(view.id)
  summary.operations.push(`Created ${view.kind} view ${view.id}`)
}

function updateView(
  workspace: KnowledgeWorkspace,
  operation: UpdateViewOperation,
  now: string,
  summary: MutableSummary
): void {
  const view = requireView(workspace, operation.viewId)
  requireExpectedRevision(operation.expectedViewRevision, view.revision, `view ${view.id}`)
  if (operation.patch.primary) {
    for (const current of Object.values(workspace.views)) {
      if (current.id === view.id || !current.primary || current.lifecycle === 'archived') continue
      workspace.views[current.id] = {
        ...current,
        primary: false,
        revision: current.revision + 1,
        updatedAt: now
      }
      summary.affected.add(current.id)
    }
  }
  workspace.views[view.id] = {
    ...view,
    ...structuredClone(operation.patch),
    revision: view.revision + 1,
    updatedAt: now
  }
  summary.affected.add(view.id)
  summary.operations.push(`Updated view ${view.id}`)
}

function archiveView(
  workspace: KnowledgeWorkspace,
  operation: ArchiveViewOperation,
  now: string,
  summary: MutableSummary
): void {
  const view = requireView(workspace, operation.viewId)
  requireExpectedRevision(operation.expectedViewRevision, view.revision, `view ${view.id}`)
  if (view.lifecycle === 'archived') {
    throw new WorkspaceDomainError('archive_conflict', `view ${view.id} is already archived`)
  }
  workspace.views[view.id] = {
    ...view,
    archivedAt: now,
    lifecycle: 'archived',
    primary: false,
    revision: view.revision + 1,
    updatedAt: now
  }
  summary.affected.add(view.id)
  summary.archived.add(view.id)
  summary.operations.push(`Archived view ${view.id}`)
}

function connectRelation(
  workspace: KnowledgeWorkspace,
  operation: ConnectRelationOperation,
  now: string,
  summary: MutableSummary
): void {
  const relation = structuredClone(operation.relation)
  if (relation.workspaceId !== workspace.id) {
    throw new WorkspaceDomainError(
      'scope_conflict',
      `relation ${relation.id} belongs to another workspace`
    )
  }
  if (Object.hasOwn(workspace.relations, relation.id)) {
    throw new WorkspaceDomainError('duplicate_id', `workspace relation ${relation.id}`)
  }
  if (relation.revision !== 0) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `new relation ${relation.id} must have revision 0`
    )
  }
  requireObject(workspace, relation.sourceId)
  requireObject(workspace, relation.targetId)
  workspace.relations[relation.id] = { ...relation, revision: 1, updatedAt: now }
  summary.affected.add(relation.id)
  summary.created.add(relation.id)
  summary.operations.push(`Connected ${relation.sourceId} to ${relation.targetId}`)
}

function disconnectRelation(
  workspace: KnowledgeWorkspace,
  operation: DisconnectRelationOperation,
  now: string,
  summary: MutableSummary
): void {
  const relation = requireRelation(workspace, operation.relationId)
  requireExpectedRevision(
    operation.expectedRelationRevision,
    relation.revision,
    `relation ${relation.id}`
  )
  if (relation.lifecycle === 'archived') {
    throw new WorkspaceDomainError(
      'archive_conflict',
      `relation ${relation.id} is already archived`
    )
  }
  workspace.relations[relation.id] = {
    ...relation,
    archivedAt: now,
    lifecycle: 'archived',
    revision: relation.revision + 1,
    updatedAt: now
  }
  summary.affected.add(relation.id)
  summary.archived.add(relation.id)
  summary.operations.push(`Disconnected relation ${relation.id}`)
}

function inactiveRuntimeStatus(block: LiveAppBlock): LiveAppBlock['runtime']['status'] {
  if (block.runtime.status === 'preview') return 'preview'
  if (block.capture)
    return block.capture.sourceRevision === block.sourceRevision ? 'captured' : 'stale'
  return 'unavailable'
}

function setRuntimeOwner(
  workspace: KnowledgeWorkspace,
  operation: SetRuntimeOwnerOperation,
  now: string,
  summary: MutableSummary
): void {
  const previousId = workspace.activeRuntimeBlockId
  if (previousId && previousId !== operation.blockId) {
    const previous = requireObject(workspace, previousId)
    if (previous.type === 'live-app-block') {
      workspace.objects[previous.id] = stampObject(
        { ...previous, runtime: { ...previous.runtime, status: inactiveRuntimeStatus(previous) } },
        now
      )
      summary.affected.add(previous.id)
    }
  }
  if (operation.blockId === null) {
    workspace.activeRuntimeBlockId = undefined
    summary.operations.push('Released the shared live runtime')
    return
  }
  const object = requireObject(workspace, operation.blockId)
  if (object.type !== 'live-app-block') {
    throw new WorkspaceDomainError('validation_failed', `${object.id} is not a Live App Block`)
  }
  if (!operation.handshakeAt) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'a successful handshake timestamp is required before a block can claim Live'
    )
  }
  workspace.objects[object.id] = stampObject(
    {
      ...object,
      runtime: { error: undefined, lastHandshakeAt: operation.handshakeAt, status: 'live' }
    },
    now
  )
  workspace.activeRuntimeBlockId = object.id
  summary.affected.add(object.id)
  summary.operations.push(`Assigned the shared live runtime to ${object.id}`)
}

function applyOperation(
  workspace: KnowledgeWorkspace,
  operation: WorkspaceOperation,
  now: string,
  summary: MutableSummary
): void {
  switch (operation.type) {
    case 'create-object':
      createObject(workspace, operation, now, summary)
      return
    case 'update-object':
      updateObject(workspace, operation, now, summary)
      return
    case 'archive-object':
    case 'restore-object':
      setObjectLifecycle(workspace, operation, now, summary)
      return
    case 'set-projection':
    case 'remove-projection':
      setProjection(workspace, operation, now, summary)
      return
    case 'create-view':
      createView(workspace, operation, now, summary)
      return
    case 'update-view':
      updateView(workspace, operation, now, summary)
      return
    case 'archive-view':
      archiveView(workspace, operation, now, summary)
      return
    case 'connect-relation':
      connectRelation(workspace, operation, now, summary)
      return
    case 'disconnect-relation':
      disconnectRelation(workspace, operation, now, summary)
      return
    case 'set-runtime-owner':
      setRuntimeOwner(workspace, operation, now, summary)
  }
}

export function applyWorkspaceMutation(
  source: KnowledgeWorkspace,
  envelope: WorkspaceMutationEnvelope
): WorkspaceMutationOutcome {
  if (!envelope.idempotencyKey.trim()) {
    throw new WorkspaceDomainError('invalid_operation', 'idempotencyKey is required')
  }
  if (envelope.operations.length === 0) {
    throw new WorkspaceDomainError('invalid_operation', 'at least one operation is required')
  }

  const fingerprint = requestFingerprint(envelope)
  if (Object.hasOwn(source.mutationReceipts, envelope.idempotencyKey) && !envelope.dryRun) {
    const receipt = source.mutationReceipts[envelope.idempotencyKey]
    if (receipt.requestFingerprint !== fingerprint) {
      throw new WorkspaceDomainError(
        'idempotency_conflict',
        `key ${envelope.idempotencyKey} was already used for another mutation`
      )
    }
    return replayReceipt(source, receipt)
  }

  requireExpectedRevision(envelope.expectedRevision, source.revision, `workspace ${source.id}`)
  const workspace = structuredClone(source)
  const now = new Date().toISOString()
  const summary: MutableSummary = {
    affected: new Set(),
    archived: new Set(),
    created: new Set(),
    operations: [],
    warnings: []
  }
  for (const operation of envelope.operations) applyOperation(workspace, operation, now, summary)

  const baseRevision = source.revision
  const revision = envelope.dryRun ? source.revision : source.revision + 1
  if (!envelope.dryRun) {
    for (const id of summary.affected) {
      if (Object.hasOwn(workspace.objects, id)) {
        const object = workspace.objects[id]
        workspace.objects[id] = { ...object, lastWorkspaceRevision: revision }
      }
      if (Object.hasOwn(workspace.views, id)) {
        const view = workspace.views[id]
        workspace.views[id] = { ...view, lastWorkspaceRevision: revision }
      }
      if (Object.hasOwn(workspace.relations, id)) {
        const relation = workspace.relations[id]
        workspace.relations[id] = { ...relation, lastWorkspaceRevision: revision }
      }
    }
    workspace.revision = revision
    workspace.updatedAt = now
  }
  const resultBase = {
    affectedStableIds: [...summary.affected],
    archivedStableIds: [...summary.archived],
    baseRevision,
    createdStableIds: [...summary.created],
    idempotentReplay: false,
    operationSummaries: summary.operations,
    revision,
    scope: 'workspace-metadata' as const,
    warnings: summary.warnings
  }
  if (envelope.dryRun) {
    return {
      result: { ...resultBase, dryRun: true, mutationId: undefined },
      workspace: structuredClone(source)
    }
  }

  const mutationId = createWorkspaceId('mutation')
  const result = { ...resultBase, dryRun: false, mutationId }

  rememberMutationReceipt(workspace, envelope, result, mutationId, fingerprint)
  return { result, workspace }
}
