import {
  mermaidDiagramOwner,
  reconcileMermaidDiagramSource
} from '@open-pencil/core/editor'
import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'

export type AuthorityMermaidReadback = {
  appearance: string | null
  bounds: Rect
  diagram_id: string | null
  editable_layers: number
  node_ids: string[]
  owner_id: string
  parser: string | null
  reconciliation: {
    message: string
    revision: number
    status: string
  }
  source: string
  source_revision: string | null
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

export function readAuthorityMermaidSource(
  document: AuthorityBoardDocument,
  pageId: string,
  ownerId: string
): AuthorityMermaidReadback {
  const owner = mermaidDiagramOwner(document.graph, ownerId)
  if (!owner || owner.id !== ownerId || owner.parentId !== pageId) {
    throw new Error(`Mermaid owner "${ownerId}" was not found on Board "${pageId}".`)
  }
  const source = pluginValue(owner, 'mermaid/source')
  const reconciliation = reconcileMermaidDiagramSource(document.graph, owner.id)
  if (!source || !reconciliation) {
    throw new Error(`Mermaid source metadata is unavailable for "${ownerId}".`)
  }
  return {
    appearance: pluginValue(owner, 'mermaid/appearance'),
    bounds: document.graph.getAbsoluteBounds(owner.id),
    diagram_id: pluginValue(owner, 'mermaid/diagram-id'),
    editable_layers: owner.childIds.length,
    node_ids: [...owner.childIds],
    owner_id: owner.id,
    parser: pluginValue(owner, 'mermaid/parser'),
    reconciliation: {
      message: reconciliation.message,
      revision: reconciliation.revision,
      status: reconciliation.status
    },
    source,
    source_revision: pluginValue(owner, 'mermaid/revision')
  }
}
