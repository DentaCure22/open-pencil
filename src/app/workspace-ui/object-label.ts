import type { WorkspaceObject, WorkspaceOperation } from '@/app/workspace'

export function labelPatchOperation(
  object: WorkspaceObject,
  value: string
): WorkspaceOperation | null {
  switch (object.type) {
    case 'document-block':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { text: value },
        type: 'update-object'
      }
    case 'collection':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { name: value },
        type: 'update-object'
      }
    case 'collection-record':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { title: value },
        type: 'update-object'
      }
    case 'saved-view':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { name: value },
        type: 'update-object'
      }
    case 'graph-node':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { label: value },
        type: 'update-object'
      }
    case 'graph-edge':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { label: value },
        type: 'update-object'
      }
    case 'design-artifact':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { label: value },
        type: 'update-object'
      }
    case 'review-object':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { body: value },
        type: 'update-object'
      }
    case 'surface-run':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { name: value },
        type: 'update-object'
      }
    case 'action-proposal':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { name: value },
        type: 'update-object'
      }
    case 'intent-record':
    case 'evidence-manifest':
    case 'decision-receipt':
    case 'action-execution-receipt':
    case 'action-verification-receipt':
    case 'action-rollback-receipt':
      return null
    case 'canvas-object':
      return {
        expectedObjectRevision: object.revision,
        objectId: object.id,
        objectType: object.type,
        patch: { label: value },
        type: 'update-object'
      }
    case 'live-app-block':
      return null
  }
  return null
}
