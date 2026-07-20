import { readContentSource } from '@open-pencil/core/io'
import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import type { CadDrawingSource } from './types'

const PLUGIN_ID = 'open-pencil'
const KIND_KEY = 'cad-drawing/kind'
const KIND = 'dxf'

export function cadDrawingPluginData(): PluginDataEntry[] {
  return [{ key: KIND_KEY, pluginId: PLUGIN_ID, value: KIND }]
}

export function cadDrawingSource(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): CadDrawingSource | null {
  if (
    !node?.pluginData.some(
      (entry) => entry.pluginId === PLUGIN_ID && entry.key === KIND_KEY && entry.value === KIND
    )
  ) {
    return null
  }
  const metadata = readContentSource(node)
  if (!metadata || metadata.format !== KIND) return null
  const assetHash = assetHashFromReference(metadata.source)
  if (!assetHash) return null
  return {
    assetHash,
    fileName: metadata.fileName ?? 'Untitled.dxf',
    format: KIND,
    metadata
  }
}
