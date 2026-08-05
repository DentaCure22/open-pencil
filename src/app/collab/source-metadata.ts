import type * as Y from 'yjs'

import type { SceneNode } from '@open-pencil/scene-graph'
import { sourceMetadataInvalidationsForEdit } from '@open-pencil/scene-graph/source-metadata'
import { TEXT_PICTURE_KEYS } from '@open-pencil/scene-graph/text-picture'

const Y_SOURCE_RAW_SIZE_INVALIDATED = '__openPencilCollab.source.rawSizeInvalidated'
const Y_SOURCE_RAW_TRANSFORM_INVALIDATED = '__openPencilCollab.source.rawTransformInvalidated'
const Y_SOURCE_RAW_NODE_FIELDS_INVALIDATED = '__openPencilCollab.source.rawNodeFieldsInvalidated'
const Y_SOURCE_EXPORT_SETTINGS_INVALIDATED = '__openPencilCollab.source.exportSettingsInvalidated'

const SOURCE_INVALIDATION_KEYS: ReadonlySet<string> = new Set([
  Y_SOURCE_RAW_SIZE_INVALIDATED,
  Y_SOURCE_RAW_TRANSFORM_INVALIDATED,
  Y_SOURCE_RAW_NODE_FIELDS_INVALIDATED,
  Y_SOURCE_EXPORT_SETTINGS_INVALIDATED
])

function setInvalidation(ynode: Y.Map<unknown>, key: string, invalidated: boolean) {
  if (invalidated) {
    if (ynode.get(key) !== true) ynode.set(key, true)
  } else if (ynode.has(key)) {
    ynode.delete(key)
  }
}

function isSourceMetadata(value: unknown): value is SceneNode['source'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fig' in value &&
    typeof value.fig === 'object' &&
    value.fig !== null
  )
}

export function isSourceInvalidationYKey(key: string): boolean {
  return SOURCE_INVALIDATION_KEYS.has(key)
}

export function expandDerivedNodeChanges(
  node: SceneNode,
  changes: Partial<SceneNode>
): Partial<SceneNode> {
  if (node.type !== 'TEXT' || !Object.keys(changes).some((key) => TEXT_PICTURE_KEYS.has(key))) {
    return changes
  }
  return {
    ...changes,
    figmaDerivedTextGlyphs: node.figmaDerivedTextGlyphs,
    textPicture: node.textPicture
  }
}

export function syncFullSourceInvalidationState(node: SceneNode, ynode: Y.Map<unknown>) {
  const rawNodeFields = node.source.fig.rawNodeFields
  setInvalidation(ynode, Y_SOURCE_RAW_SIZE_INVALIDATED, node.source.fig.rawSize === null)
  setInvalidation(ynode, Y_SOURCE_RAW_TRANSFORM_INVALIDATED, node.source.fig.rawTransform === null)
  setInvalidation(
    ynode,
    Y_SOURCE_RAW_NODE_FIELDS_INVALIDATED,
    Object.keys(rawNodeFields).length === 0
  )
  setInvalidation(
    ynode,
    Y_SOURCE_EXPORT_SETTINGS_INVALIDATED,
    !Object.hasOwn(rawNodeFields, 'exportSettings')
  )
}

export function syncSourceInvalidationsForChanges(
  node: SceneNode,
  changes: Partial<SceneNode>,
  ynode: Y.Map<unknown>
) {
  const changeKeys = Object.keys(changes)
  if (Object.hasOwn(changes, 'source')) syncFullSourceInvalidationState(node, ynode)
  const invalidations = sourceMetadataInvalidationsForEdit(changeKeys)
  if (invalidations.rawSize) setInvalidation(ynode, Y_SOURCE_RAW_SIZE_INVALIDATED, true)
  if (invalidations.rawTransform) {
    setInvalidation(ynode, Y_SOURCE_RAW_TRANSFORM_INVALIDATED, true)
  }
  if (invalidations.rawNodeFields) {
    setInvalidation(ynode, Y_SOURCE_RAW_NODE_FIELDS_INVALIDATED, true)
  }
  if (invalidations.exportSettings) {
    setInvalidation(ynode, Y_SOURCE_EXPORT_SETTINGS_INVALIDATED, true)
  }
}

export function resolveYjsSourceMetadata(ynode: Y.Map<unknown>): SceneNode['source'] | undefined {
  const value = ynode.get('source')
  if (!isSourceMetadata(value)) return undefined
  const source = structuredClone(value)
  if (ynode.get(Y_SOURCE_RAW_SIZE_INVALIDATED) === true) {
    source.fig.rawSize = null
  }
  if (ynode.get(Y_SOURCE_RAW_TRANSFORM_INVALIDATED) === true) {
    source.fig.rawTransform = null
  }
  if (ynode.get(Y_SOURCE_RAW_NODE_FIELDS_INVALIDATED) === true) {
    source.fig.rawNodeFields = {}
  } else if (ynode.get(Y_SOURCE_EXPORT_SETTINGS_INVALIDATED) === true) {
    delete source.fig.rawNodeFields.exportSettings
  }
  return source
}
