import type { SceneNode } from '@open-pencil/scene-graph'

const MEMORY_PLUGIN_ID = 'openpencil.memory'
const CANONICAL_OBJECT_KEY = 'canonical-object-id'
const CANONICAL_SOURCE_NODE_KEY = 'canonical-source-node-id'
const DERIVED_FROM_CANONICAL_OBJECT_KEY = 'derived-from-canonical-object-id'

export type CanonicalMemoryObjectMetadata = {
  canonicalObjectId?: string
  derivedFromCanonicalObjectId?: string
  sourceNodeId?: string
}

export function canonicalMemoryObjectId(node: SceneNode): string {
  const assigned = node.pluginData?.find(
    (entry) => entry.pluginId === MEMORY_PLUGIN_ID && entry.key === CANONICAL_OBJECT_KEY
  )?.value
  return assigned?.trim() || node.id
}

export function canonicalMemorySourceNodeId(node: SceneNode): string | undefined {
  return node.pluginData
    ?.find(
      (entry) => entry.pluginId === MEMORY_PLUGIN_ID && entry.key === CANONICAL_SOURCE_NODE_KEY
    )
    ?.value.trim()
}

export function canonicalMemoryDerivedFromId(node: SceneNode): string | undefined {
  return node.pluginData
    ?.find(
      (entry) =>
        entry.pluginId === MEMORY_PLUGIN_ID && entry.key === DERIVED_FROM_CANONICAL_OBJECT_KEY
    )
    ?.value.trim()
}

export function canonicalMemoryObjectPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  metadata: CanonicalMemoryObjectMetadata
): SceneNode['pluginData'] {
  const pluginData = node.pluginData.filter(
    (entry) =>
      !(
        entry.pluginId === MEMORY_PLUGIN_ID &&
        (entry.key === CANONICAL_OBJECT_KEY ||
          entry.key === CANONICAL_SOURCE_NODE_KEY ||
          entry.key === DERIVED_FROM_CANONICAL_OBJECT_KEY)
      )
  )
  if (metadata.canonicalObjectId) {
    pluginData.push({
      key: CANONICAL_OBJECT_KEY,
      pluginId: MEMORY_PLUGIN_ID,
      value: metadata.canonicalObjectId
    })
  }
  if (metadata.sourceNodeId) {
    pluginData.push({
      key: CANONICAL_SOURCE_NODE_KEY,
      pluginId: MEMORY_PLUGIN_ID,
      value: metadata.sourceNodeId
    })
  }
  if (metadata.derivedFromCanonicalObjectId) {
    pluginData.push({
      key: DERIVED_FROM_CANONICAL_OBJECT_KEY,
      pluginId: MEMORY_PLUGIN_ID,
      value: metadata.derivedFromCanonicalObjectId
    })
  }
  return pluginData
}
