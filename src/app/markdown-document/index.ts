import {
  mergeContentSourcePluginData,
  readContentSource,
  type ContentSourceMetadata
} from '@open-pencil/core/io'
import type { MarkdownSourceMode } from '@open-pencil/core/io/formats/markdown'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

const PLUGIN_ID = 'open-pencil'
const SOURCE_MODE_KEY = 'markdown/source-mode'

interface MarkdownDocumentStore {
  graph: Pick<SceneGraph, 'getNode'>
  updateNodeWithUndo: (nodeId: string, props: Partial<SceneNode>, label: string) => void
}

export interface MarkdownDocument {
  metadata: ContentSourceMetadata
  node: SceneNode
  sourceMode: MarkdownSourceMode
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value ??
    null
  )
}

export function markdownDocument(node: SceneNode | null | undefined): MarkdownDocument | null {
  if (node?.type !== 'FRAME' || node.childIds.length > 0) return null
  const metadata = readContentSource(node)
  if (metadata?.format !== 'markdown') return null
  const mode = pluginValue(node, SOURCE_MODE_KEY)
  return {
    metadata,
    node,
    sourceMode: mode === 'mdx' || mode === 'plain-text' ? mode : 'markdown'
  }
}

export function updateMarkdownDocumentSource(
  store: MarkdownDocumentStore,
  nodeId: string,
  source: string
): boolean {
  const document = markdownDocument(store.graph.getNode(nodeId))
  if (!document || source === document.metadata.source) return false
  store.updateNodeWithUndo(
    document.node.id,
    {
      pluginData: mergeContentSourcePluginData(document.node.pluginData, {
        ...document.metadata,
        revision: document.metadata.revision + 1,
        source
      })
    },
    'Edit Markdown'
  )
  return true
}
