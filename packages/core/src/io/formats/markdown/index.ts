import { SceneGraph } from '@open-pencil/scene-graph'

import { markdownTokens } from './parse'
import { renderMarkdownDocument } from './render'
import type { MarkdownImportOptions } from './types'

export type {
  MarkdownImageAsset,
  MarkdownImportOptions,
  MarkdownInlineContent,
  MarkdownInlineLink,
  MarkdownInlineRun,
  MarkdownInlineStyle,
  MarkdownRepresentation,
  MarkdownSourceMode
} from './types'
export {
  markdownFromSceneGraph,
  writeMarkdownDocument,
  type MarkdownWriteResult
} from './serialize'

export async function markdownToSceneGraph(
  source: string,
  options: MarkdownImportOptions = {}
): Promise<SceneGraph> {
  const graph = new SceneGraph()
  const tokens =
    options.representation === 'native' ? markdownTokens(source, options.sourceMode) : null
  await renderMarkdownDocument(graph, tokens, source, options)
  return graph
}

export async function readMarkdownFile(
  data: Uint8Array,
  options: MarkdownImportOptions = {}
): Promise<SceneGraph> {
  return markdownToSceneGraph(new TextDecoder().decode(data), options)
}
