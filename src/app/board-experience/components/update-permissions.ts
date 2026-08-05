import type { BoardPermission } from '@/app/board-permissions'

import type { BoardComponentUpdateInput } from './contracts'

export function requiredComponentUpdatePermissions(
  input: BoardComponentUpdateInput
): BoardPermission[] {
  const permissions = new Set<BoardPermission>()
  if (
    input.x !== undefined ||
    input.y !== undefined ||
    input.width !== undefined ||
    input.height !== undefined ||
    input.rotation !== undefined
  ) {
    permissions.add('component.update.geometry')
  }
  if (input.name !== undefined || input.opacity !== undefined || input.visible !== undefined) {
    permissions.add('component.update.appearance')
  }
  if (input.props !== undefined) permissions.add('component.update.props')
  if (input.source !== undefined) permissions.add('component.update.source')
  if (input.state !== undefined) permissions.add('component.update.state')
  return [...permissions]
}
