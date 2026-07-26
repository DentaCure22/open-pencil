import type { Editor } from '@open-pencil/core/editor'
import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  BOARD_AUTHORITY_API_VERSION,
  BOARD_COMPONENT_PERMISSIONS,
  BOARD_PAGE_PERMISSIONS,
  BOARD_SHAPE_PERMISSIONS,
  BOARD_TARGET_PERMISSIONS,
  type BoardAuthorityGrant,
  type BoardAuthorityGrantDescriptor,
  type BoardAuthorityPermission
} from './contracts'

const grants = new WeakMap<Editor, Map<string, BoardAuthorityGrant>>()
const validPermissions = new Set<BoardAuthorityPermission>([
  ...BOARD_COMPONENT_PERMISSIONS,
  ...BOARD_PAGE_PERMISSIONS,
  ...BOARD_SHAPE_PERMISSIONS,
  ...BOARD_TARGET_PERMISSIONS
])

function validDescriptor(store: Editor, descriptor: BoardAuthorityGrantDescriptor): boolean {
  const targetNodeIds = descriptor.targetNodeIds ?? []
  return Boolean(
    store.graph.getNode(descriptor.pageId) &&
    descriptor.actorId.trim() &&
    descriptor.name.trim() &&
    descriptor.marker.key.trim() &&
    descriptor.marker.pluginId.trim() &&
    descriptor.marker.value.trim() &&
    descriptor.permissions.every((permission) => validPermissions.has(permission)) &&
    targetNodeIds.every(
      (nodeId) =>
        Boolean(store.graph.getNode(nodeId)) && store.graph.isDescendant(nodeId, descriptor.pageId)
    )
  )
}

export function issueBoardAuthorityGrant(
  store: Editor,
  descriptor: BoardAuthorityGrantDescriptor
): BoardAuthorityGrant | null {
  if (!validDescriptor(store, descriptor)) return null
  const targetNodeIds = descriptor.targetNodeIds ? [...new Set(descriptor.targetNodeIds)] : []
  const grant = Object.freeze({
    ...descriptor,
    apiVersion: BOARD_AUTHORITY_API_VERSION,
    defaultOrigin: Object.freeze(structuredClone(descriptor.defaultOrigin)),
    grantId: `board-grant:${randomHex(8)}`,
    labels: Object.freeze(structuredClone(descriptor.labels)),
    marker: Object.freeze(structuredClone(descriptor.marker)),
    permissions: Object.freeze([...new Set(descriptor.permissions)]),
    targetNodeIds: Object.freeze(targetNodeIds)
  }) as BoardAuthorityGrant
  const storeGrants = grants.get(store) ?? new Map<string, BoardAuthorityGrant>()
  storeGrants.set(grant.grantId, grant)
  grants.set(store, storeGrants)
  return grant
}

export function isBoardAuthorityGrantActive(store: Editor, grant: BoardAuthorityGrant): boolean {
  return grants.get(store)?.get(grant.grantId) === grant
}

export function boardNodeMatchesGrant(node: SceneNode, grant: BoardAuthorityGrant): boolean {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === grant.marker.pluginId &&
      entry.key === grant.marker.key &&
      entry.value === grant.marker.value
  )
}

export function revokeBoardAuthorityGrant(store: Editor, grant: BoardAuthorityGrant): boolean {
  const storeGrants = grants.get(store)
  if (storeGrants?.get(grant.grantId) !== grant) return false
  storeGrants.delete(grant.grantId)
  if (storeGrants.size === 0) grants.delete(store)
  return true
}
