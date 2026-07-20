import { readContentSource } from '@open-pencil/core/io'
import {
  writeMarkdownDocument,
  type MarkdownWriteResult
} from '@open-pencil/core/io/formats/markdown'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export type MarkdownSourceWriter = (data: Uint8Array) => Promise<void>

function markdownDocumentFrame(graph: SceneGraph): SceneNode {
  const document = [...graph.getAllNodes()].find(
    (node) => readContentSource(node)?.format === 'markdown'
  )
  if (!document) throw new Error('Scene graph does not contain a source-backed Markdown document')
  return document
}

export async function persistMarkdownSource(
  graph: SceneGraph,
  write: MarkdownSourceWriter
): Promise<MarkdownWriteResult> {
  const document = markdownDocumentFrame(graph)
  const previousPluginData = structuredClone(document.pluginData)
  const result = writeMarkdownDocument(graph)
  try {
    await write(new TextEncoder().encode(result.source))
    return result
  } catch (error) {
    graph.updateNode(document.id, { pluginData: previousPluginData })
    throw error
  }
}
