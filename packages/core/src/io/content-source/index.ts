import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import { pluginDataEntry, pluginDataValues } from '#core/io/plugin-data'

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

export function contentSourcePluginData(metadata: ContentSourceMetadata): PluginDataEntry[] {
  const data = [
    pluginDataEntry(PLUGIN_ID, FORMAT_KEY, metadata.format),
    pluginDataEntry(PLUGIN_ID, MIME_TYPE_KEY, metadata.mimeType),
    pluginDataEntry(PLUGIN_ID, REVISION_KEY, String(metadata.revision)),
    pluginDataEntry(PLUGIN_ID, SOURCE_KEY, metadata.source)
  ]
  if (metadata.fileName) data.push(pluginDataEntry(PLUGIN_ID, FILE_NAME_KEY, metadata.fileName))
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

export function readContentSource(
  node: Pick<SceneNode, 'pluginData'>
): ContentSourceMetadata | null {
  const values = pluginDataValues(node, PLUGIN_ID)
  const format = values.get(FORMAT_KEY)
  const mimeType = values.get(MIME_TYPE_KEY)
  const revisionValue = values.get(REVISION_KEY)
  const source = values.get(SOURCE_KEY)
  if (!format || !mimeType || !revisionValue || source === undefined) return null

  const revision = Number.parseInt(revisionValue, 10)
  if (!Number.isSafeInteger(revision) || revision < 1) return null

  return {
    format,
    mimeType,
    fileName: values.get(FILE_NAME_KEY) ?? null,
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
