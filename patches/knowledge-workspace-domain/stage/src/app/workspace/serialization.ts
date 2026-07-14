import { WorkspaceDomainError } from './errors'
import { WORKSPACE_SCHEMA_VERSION } from './types'
import type {
  KnowledgeWorkspace,
  WorkspaceObject,
  WorkspaceObjectType,
  WorkspaceRelation,
  WorkspaceView
} from './types'

const OBJECT_TYPES: ReadonlySet<WorkspaceObjectType> = new Set([
  'document-block',
  'collection',
  'collection-record',
  'saved-view',
  'canvas-object',
  'graph-node',
  'graph-edge',
  'design-artifact',
  'live-app-block',
  'review-object'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value) {
    throw new WorkspaceDomainError('validation_failed', `${key} must be a non-empty string`)
  }
  return value
}

function assertNoInlineData(value: unknown, path = 'workspace'): void {
  if (typeof value === 'string' && value.startsWith('data:')) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${path} contains inline data; store captures as asset references instead`
    )
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoInlineData(child, `${path}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) assertNoInlineData(child, `${path}.${key}`)
}

function requireObjectReference(
  workspace: KnowledgeWorkspace,
  objectId: string,
  label: string
): void {
  if (!Object.hasOwn(workspace.objects, objectId)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `${label} references missing object ${objectId}`
    )
  }
}

function validateObjectEntry(
  workspace: KnowledgeWorkspace,
  id: string,
  object: WorkspaceObject
): boolean {
  if (id !== object.id || !OBJECT_TYPES.has(object.type)) {
    throw new WorkspaceDomainError('validation_failed', `invalid workspace object entry ${id}`)
  }
  if (
    object.workspaceId !== workspace.id ||
    object.documentId !== workspace.documentId ||
    object.pageId !== workspace.pageId
  ) {
    throw new WorkspaceDomainError('scope_conflict', `object ${id} has mismatched workspace scope`)
  }
  if (object.type === 'collection-record' || object.type === 'saved-view') {
    requireObjectReference(workspace, object.collectionId, object.type)
    if (workspace.objects[object.collectionId].type !== 'collection') {
      throw new WorkspaceDomainError(
        'validation_failed',
        `${object.type} ${id} references a non-collection object`
      )
    }
  }
  if (object.type === 'graph-edge') {
    requireObjectReference(workspace, object.sourceId, `graph edge ${id}`)
    requireObjectReference(workspace, object.targetId, `graph edge ${id}`)
  }
  return object.type === 'live-app-block' && object.runtime.status === 'live'
}

function validateRuntimeOwner(workspace: KnowledgeWorkspace, liveRuntimeCount: number): void {
  if (liveRuntimeCount > 1) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'only one Live App Block may own the shared runtime'
    )
  }
  if (!workspace.activeRuntimeBlockId) {
    if (liveRuntimeCount > 0) {
      throw new WorkspaceDomainError(
        'validation_failed',
        'a Live App Block cannot be marked Live without activeRuntimeBlockId'
      )
    }
    return
  }
  requireObjectReference(workspace, workspace.activeRuntimeBlockId, 'activeRuntimeBlockId')
  const owner = workspace.objects[workspace.activeRuntimeBlockId]
  if (owner.type !== 'live-app-block' || owner.runtime.status !== 'live') {
    throw new WorkspaceDomainError(
      'validation_failed',
      'activeRuntimeBlockId must reference the single Live App Block marked Live'
    )
  }
}

function validateRelationEntry(
  workspace: KnowledgeWorkspace,
  id: string,
  relation: WorkspaceRelation
): void {
  if (id !== relation.id || relation.workspaceId !== workspace.id) {
    throw new WorkspaceDomainError('scope_conflict', `relation ${id} has mismatched scope`)
  }
  requireObjectReference(workspace, relation.sourceId, `relation ${id}`)
  requireObjectReference(workspace, relation.targetId, `relation ${id}`)
}

function validateViewEntry(workspace: KnowledgeWorkspace, id: string, view: WorkspaceView): void {
  if (id !== view.id || view.workspaceId !== workspace.id) {
    throw new WorkspaceDomainError('scope_conflict', `view ${id} has mismatched scope`)
  }
}

function validateWorkspaceHeader(workspace: KnowledgeWorkspace): void {
  if (!workspace.id || !workspace.documentId || !workspace.pageId) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'workspace id, documentId, and pageId are required'
    )
  }
  if (!Number.isInteger(workspace.revision) || workspace.revision < 0) {
    throw new WorkspaceDomainError('validation_failed', 'workspace revision must be non-negative')
  }
}

export function validateKnowledgeWorkspace(workspace: KnowledgeWorkspace): void {
  validateWorkspaceHeader(workspace)
  let liveRuntimeCount = 0
  for (const [id, object] of Object.entries(workspace.objects)) {
    if (validateObjectEntry(workspace, id, object)) liveRuntimeCount += 1
  }
  validateRuntimeOwner(workspace, liveRuntimeCount)
  for (const [id, relation] of Object.entries(workspace.relations)) {
    validateRelationEntry(workspace, id, relation)
  }
  for (const [id, view] of Object.entries(workspace.views)) {
    validateViewEntry(workspace, id, view)
  }
  assertNoInlineData(workspace)
}

export function serializeWorkspace(workspace: KnowledgeWorkspace): string {
  validateKnowledgeWorkspace(workspace)
  return JSON.stringify(workspace)
}

export function deserializeWorkspace(serialized: string): KnowledgeWorkspace {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new WorkspaceDomainError('validation_failed', 'workspace payload is not valid JSON')
  }
  if (!isRecord(parsed)) {
    throw new WorkspaceDomainError('validation_failed', 'workspace payload must be an object')
  }
  requireString(parsed, 'id')
  requireString(parsed, 'documentId')
  requireString(parsed, 'pageId')
  if (parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `unsupported workspace schema version ${String(parsed.schemaVersion)}`
    )
  }
  if (!isRecord(parsed.objects) || !isRecord(parsed.relations) || !isRecord(parsed.views)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'workspace objects, relations, and views must be records'
    )
  }
  const workspace = structuredClone(parsed) as KnowledgeWorkspace
  validateKnowledgeWorkspace(workspace)
  return workspace
}
