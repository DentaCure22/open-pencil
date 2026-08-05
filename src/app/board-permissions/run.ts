import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  BOARD_COMPONENT_PERMISSIONS,
  BOARD_PAGE_PERMISSIONS,
  BOARD_SHAPE_PERMISSIONS,
  BOARD_TARGET_PERMISSIONS,
  type BoardMutationResult,
  type BoardPermission,
  type BoardPermissionContext,
  type BoardPermissionDenialReason,
  type BoardPermissionDescriptor
} from './contracts'

const validPermissions = new Set<BoardPermission>([
  ...BOARD_COMPONENT_PERMISSIONS,
  ...BOARD_PAGE_PERMISSIONS,
  ...BOARD_SHAPE_PERMISSIONS,
  ...BOARD_TARGET_PERMISSIONS
])

function denialReason(
  editor: Editor,
  descriptor: BoardPermissionDescriptor,
  requiredPermissions: readonly BoardPermission[],
  targetNodeId?: string
): BoardPermissionDenialReason | null {
  const page = editor.graph.getNode(descriptor.pageId)
  if (!page) return 'source-missing'
  const targetNodeIds = descriptor.targetNodeIds ?? []
  if (
    !descriptor.actorId.trim() ||
    !descriptor.name.trim() ||
    !descriptor.marker.key.trim() ||
    !descriptor.marker.pluginId.trim() ||
    !descriptor.marker.value.trim() ||
    descriptor.permissions.some((permission) => !validPermissions.has(permission)) ||
    targetNodeIds.some(
      (nodeId) =>
        !editor.graph.getNode(nodeId) || !editor.graph.isDescendant(nodeId, descriptor.pageId)
    )
  ) {
    return 'context-invalid'
  }
  if (requiredPermissions.some((permission) => !descriptor.permissions.includes(permission))) {
    return 'capability-denied'
  }
  if (targetNodeId === undefined) return null
  if (!targetNodeIds.includes(targetNodeId)) return 'capability-denied'
  const target = editor.graph.getNode(targetNodeId)
  return target && editor.graph.isDescendant(target.id, descriptor.pageId) ? null : 'target-missing'
}

function permissionContext(descriptor: BoardPermissionDescriptor): BoardPermissionContext {
  return Object.freeze({
    ...descriptor,
    defaultOrigin: Object.freeze(structuredClone(descriptor.defaultOrigin)),
    labels: Object.freeze(structuredClone(descriptor.labels)),
    marker: Object.freeze(structuredClone(descriptor.marker)),
    permissions: Object.freeze([...new Set(descriptor.permissions)]),
    targetNodeIds: Object.freeze([...new Set(descriptor.targetNodeIds)])
  })
}

export function runBoardMutation<TResult>(
  editor: Editor,
  descriptor: BoardPermissionDescriptor,
  requiredPermissions: readonly BoardPermission[],
  operation: (context: BoardPermissionContext) => TResult,
  targetNodeId?: string
): BoardMutationResult<TResult> {
  const reason = denialReason(editor, descriptor, requiredPermissions, targetNodeId)
  if (reason) return { reason, status: 'denied' }
  const context = permissionContext(descriptor)
  return { context, result: operation(context), status: 'allowed' }
}

export function boardNodeMatchesOwner(
  node: SceneNode,
  owner: Pick<BoardPermissionDescriptor, 'marker'>
): boolean {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === owner.marker.pluginId &&
      entry.key === owner.marker.key &&
      entry.value === owner.marker.value
  )
}
