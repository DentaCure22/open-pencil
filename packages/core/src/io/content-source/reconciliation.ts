import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

const PLUGIN_ID = 'open-pencil'
const KEY_PREFIX = 'source-reconciliation/'
const STATUS_KEY = `${KEY_PREFIX}status`
const MESSAGE_KEY = `${KEY_PREFIX}message`
const BASELINE_KEY = `${KEY_PREFIX}baseline`
const REVISION_KEY = `${KEY_PREFIX}revision`

export type SourceReconciliationStatus = 'current' | 'regenerated' | 'conflict' | 'unsupported'

export interface SourceReconciliationResult {
  status: SourceReconciliationStatus
  source: string
  revision: number
  message: string
}

export interface SourceReconciliationMetadata {
  status: SourceReconciliationStatus
  message: string
  baseline: string | null
  revision: number
}

function entry(key: string, value: string): PluginDataEntry {
  return { pluginId: PLUGIN_ID, key, value }
}

function isSourceReconciliationStatus(value: string): value is SourceReconciliationStatus {
  return ['current', 'regenerated', 'conflict', 'unsupported'].includes(value)
}

function valueFor(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  return (
    node.pluginData.find((item) => item.pluginId === PLUGIN_ID && item.key === key)?.value ?? null
  )
}

export function sourceReconciliationPluginData(
  metadata: SourceReconciliationMetadata
): PluginDataEntry[] {
  const data = [
    entry(STATUS_KEY, metadata.status),
    entry(MESSAGE_KEY, metadata.message),
    entry(REVISION_KEY, String(metadata.revision))
  ]
  if (metadata.baseline) data.push(entry(BASELINE_KEY, metadata.baseline))
  return data
}

export function mergeSourceReconciliationPluginData(
  existing: PluginDataEntry[],
  metadata: SourceReconciliationMetadata
): PluginDataEntry[] {
  return [
    ...existing.filter((item) => item.pluginId !== PLUGIN_ID || !item.key.startsWith(KEY_PREFIX)),
    ...sourceReconciliationPluginData(metadata)
  ]
}

export function readSourceReconciliation(
  node: Pick<SceneNode, 'pluginData'>
): SourceReconciliationMetadata | null {
  const status = valueFor(node, STATUS_KEY)
  const message = valueFor(node, MESSAGE_KEY)
  const revisionValue = valueFor(node, REVISION_KEY)
  const revision = revisionValue ? Number.parseInt(revisionValue, 10) : Number.NaN
  if (
    !status ||
    !isSourceReconciliationStatus(status) ||
    message === null ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    return null
  }
  return { status, message, baseline: valueFor(node, BASELINE_KEY), revision }
}

function visualNodeSnapshot(graph: SceneGraph, node: SceneNode): unknown {
  const { id: _id, parentId: _parentId, childIds, pluginData: _pluginData, ...visual } = node
  return {
    visual,
    children: childIds.flatMap((childId) => {
      const child = graph.getNode(childId)
      return child ? [visualNodeSnapshot(graph, child)] : []
    })
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable visual signature used to detect native divergence without storing a second source copy. */
export function sourceSceneSignature(graph: SceneGraph, rootId: string): string | null {
  const root = graph.getNode(rootId)
  return root ? fnv1a(JSON.stringify(visualNodeSnapshot(graph, root))) : null
}
