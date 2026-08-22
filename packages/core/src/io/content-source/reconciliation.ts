import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { pluginDataEntry, pluginDataValues } from '#core/io/plugin-data'

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

function isSourceReconciliationStatus(value: string): value is SourceReconciliationStatus {
  return ['current', 'regenerated', 'conflict', 'unsupported'].includes(value)
}

export function sourceReconciliationPluginData(
  metadata: SourceReconciliationMetadata
): PluginDataEntry[] {
  const data = [
    pluginDataEntry(PLUGIN_ID, STATUS_KEY, metadata.status),
    pluginDataEntry(PLUGIN_ID, MESSAGE_KEY, metadata.message),
    pluginDataEntry(PLUGIN_ID, REVISION_KEY, String(metadata.revision))
  ]
  if (metadata.baseline) {
    data.push(pluginDataEntry(PLUGIN_ID, BASELINE_KEY, metadata.baseline))
  }
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
  const values = pluginDataValues(node, PLUGIN_ID)
  const status = values.get(STATUS_KEY)
  const message = values.get(MESSAGE_KEY)
  const revisionValue = values.get(REVISION_KEY)
  const revision = revisionValue ? Number.parseInt(revisionValue, 10) : Number.NaN
  if (
    !status ||
    !isSourceReconciliationStatus(status) ||
    message === undefined ||
    !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    return null
  }
  return { status, message, baseline: values.get(BASELINE_KEY) ?? null, revision }
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : (left > right ? 1 : 0)))
      .map(([key, item]) => [key, canonicalize(item)])
  )
}

function visualSignature(value: unknown): string {
  return fnv1a(JSON.stringify(canonicalize(value)))
}

/** Stable visual signature used to detect native divergence without storing a second source copy. */
export function sourceSceneSignature(graph: SceneGraph, rootId: string): string | null {
  const root = graph.getNode(rootId)
  return root ? visualSignature(visualNodeSnapshot(graph, root)) : null
}

/** Stable signature for source-backed contents whose owning container may be moved freely. */
export function sourceSceneContentsSignature(graph: SceneGraph, rootId: string): string | null {
  const root = graph.getNode(rootId)
  if (!root) return null
  const contents = root.childIds.flatMap((childId) => {
    const child = graph.getNode(childId)
    return child ? [visualNodeSnapshot(graph, child)] : []
  })
  return visualSignature(contents)
}
