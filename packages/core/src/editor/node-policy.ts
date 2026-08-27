import type { NodeType } from '@open-pencil/scene-graph'

/**
 * Node kinds that are first-class, directly authorable Board objects.
 *
 * Component, component-set, and instance nodes intentionally stay outside this
 * list. The scene graph can still load them for .fig interoperability, but new
 * reusable or app-like objects belong in the Code Object model.
 */
export const BOARD_NATIVE_CREATE_TYPES = [
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'TEXT',
  'LINE',
  'STAR',
  'POLYGON',
  'VECTOR',
  'BOOLEAN_OPERATION',
  'GROUP',
  'SECTION',
  'CONNECTOR',
  'SHAPE_WITH_TEXT'
] as const satisfies readonly NodeType[]

export type BoardNativeCreateType = (typeof BOARD_NATIVE_CREATE_TYPES)[number]

const boardNativeCreateTypes = new Set<NodeType>(BOARD_NATIVE_CREATE_TYPES)

export function isBoardNativeCreateType(value: unknown): value is BoardNativeCreateType {
  return typeof value === 'string' && boardNativeCreateTypes.has(value as NodeType)
}

export const LEGACY_DESIGN_NODE_TYPES = [
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE'
] as const satisfies readonly NodeType[]

export type LegacyDesignNodeType = (typeof LEGACY_DESIGN_NODE_TYPES)[number]

const legacyDesignNodeTypes = new Set<NodeType>(LEGACY_DESIGN_NODE_TYPES)

export function isLegacyDesignNodeType(value: unknown): value is LegacyDesignNodeType {
  return typeof value === 'string' && legacyDesignNodeTypes.has(value as NodeType)
}
