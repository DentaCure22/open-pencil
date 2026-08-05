import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

const PLUGIN_ID = 'open-pencil'
const KEY_PREFIX = 'content-source/'
const FORMAT_KEY = `${KEY_PREFIX}format`
const MIME_TYPE_KEY = `${KEY_PREFIX}mime-type`
const FILE_NAME_KEY = `${KEY_PREFIX}file-name`
const REVISION_KEY = `${KEY_PREFIX}revision`
const SOURCE_KEY = `${KEY_PREFIX}source`

export const CONTENT_SOURCE_REVISION = 1

export interface ContentSourceMetadata {
  format: string
  mimeType: string
  fileName: string | null
  revision: number
  source: string
}

function entry(key: string, value: string): PluginDataEntry {
  return { pluginId: PLUGIN_ID, key, value }
}

export function contentSourcePluginData(metadata: ContentSourceMetadata): PluginDataEntry[] {
  const data = [
    entry(FORMAT_KEY, metadata.format),
    entry(MIME_TYPE_KEY, metadata.mimeType),
    entry(REVISION_KEY, String(metadata.revision)),
    entry(SOURCE_KEY, metadata.source)
  ]
  if (metadata.fileName) data.push(entry(FILE_NAME_KEY, metadata.fileName))
  return data
}

export function mergeContentSourcePluginData(
  existing: PluginDataEntry[],
  metadata: ContentSourceMetadata
): PluginDataEntry[] {
  return [
    ...existing.filter((item) => item.pluginId !== PLUGIN_ID || !item.key.startsWith(KEY_PREFIX)),
    ...contentSourcePluginData(metadata)
  ]
}

function valueFor(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  return (
    node.pluginData.find((item) => item.pluginId === PLUGIN_ID && item.key === key)?.value ?? null
  )
}

export function readContentSource(
  node: Pick<SceneNode, 'pluginData'>
): ContentSourceMetadata | null {
  const format = valueFor(node, FORMAT_KEY)
  const mimeType = valueFor(node, MIME_TYPE_KEY)
  const revisionValue = valueFor(node, REVISION_KEY)
  const source = valueFor(node, SOURCE_KEY)
  if (!format || !mimeType || !revisionValue || source === null) return null

  const revision = Number.parseInt(revisionValue, 10)
  if (!Number.isSafeInteger(revision) || revision < 1) return null

  return {
    format,
    mimeType,
    fileName: valueFor(node, FILE_NAME_KEY),
    revision,
    source
  }
}

export {
  mergeSourceReconciliationPluginData,
  readSourceReconciliation,
  sourceReconciliationPluginData,
  sourceSceneContentsSignature,
  sourceSceneSignature,
  type SourceReconciliationMetadata,
  type SourceReconciliationResult,
  type SourceReconciliationStatus
} from './reconciliation'
