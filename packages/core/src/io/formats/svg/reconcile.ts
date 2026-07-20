import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  mergeSourceReconciliationPluginData,
  readContentSource,
  readSourceReconciliation,
  sourceSceneSignature,
  type SourceReconciliationResult
} from '#core/io/content-source'

export function reconcileSVGSource(
  graph: SceneGraph,
  sourceNode: SceneNode
): SourceReconciliationResult {
  const source = readContentSource(sourceNode)
  const state = readSourceReconciliation(sourceNode)
  if (source?.format !== 'svg') {
    return {
      status: 'unsupported',
      source: source?.source ?? '',
      revision: source?.revision ?? 1,
      message: 'This node is not a source-backed SVG document.'
    }
  }

  const currentSignature = sourceSceneSignature(graph, sourceNode.id)
  if (state?.baseline && currentSignature === state.baseline) {
    return {
      status: 'current',
      source: source.source,
      revision: source.revision,
      message: 'Source matches the imported SVG projection.'
    }
  }

  return {
    status: 'unsupported',
    source: source.source,
    revision: source.revision,
    message:
      'Original SVG source was preserved. Native SVG edits cannot be regenerated without losing unsupported markup yet.'
  }
}

export function applySVGReconciliation(
  graph: SceneGraph,
  sourceNode: SceneNode,
  result: SourceReconciliationResult
): void {
  const previous = readSourceReconciliation(sourceNode)
  graph.updateNode(sourceNode.id, {
    pluginData: mergeSourceReconciliationPluginData(sourceNode.pluginData, {
      status: result.status,
      message: result.message,
      baseline: previous?.baseline ?? null,
      revision: result.revision
    })
  })
}
