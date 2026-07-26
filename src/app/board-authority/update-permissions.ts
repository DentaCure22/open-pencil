import type {
  BoardAuthorityPermission,
  BoardComponentUpdateInput,
  BoardShapeUpdateInput
} from './contracts'

export function requiredComponentUpdatePermissions(
  input: BoardComponentUpdateInput
): BoardAuthorityPermission[] {
  const permissions = new Set<BoardAuthorityPermission>()
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

export function requiredShapeUpdatePermissions(
  input: BoardShapeUpdateInput
): BoardAuthorityPermission[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const permissions = new Set<BoardAuthorityPermission>()
  if (
    input.x !== undefined ||
    input.y !== undefined ||
    input.width !== undefined ||
    input.height !== undefined ||
    input.rotation !== undefined
  ) {
    permissions.add('shape.update.geometry')
  }
  if (
    input.fill !== undefined ||
    input.name !== undefined ||
    input.opacity !== undefined ||
    input.visible !== undefined
  ) {
    permissions.add('shape.update.appearance')
  }
  return [...permissions]
}
