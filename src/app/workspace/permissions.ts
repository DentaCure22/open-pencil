import { WorkspaceDomainError } from './errors'
import type { WorkspaceObject } from './types'

export type WorkspacePermission = keyof WorkspaceObject['permissions']

export function requireWorkspacePermission(
  object: WorkspaceObject,
  permission: WorkspacePermission
): void {
  if (object.permissions[permission]) return
  throw new WorkspaceDomainError(
    'permission_denied',
    `${permission} is required for ${object.type} ${object.id}`
  )
}

export function requireWorkspaceObjectMutable(object: WorkspaceObject): void {
  requireWorkspacePermission(object, 'canEdit')
  if (object.type === 'surface-run' && object.status === 'decided') {
    throw new WorkspaceDomainError(
      'permission_denied',
      `decided surface run ${object.id} is immutable`
    )
  }
}
