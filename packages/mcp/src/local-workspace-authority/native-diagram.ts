import type { MermaidSceneSpec } from '@open-pencil/core/diagram'
import {
  createMermaidDiagramInGraph,
  mermaidDiagramOwner,
  reconcileMermaidDiagramSource,
  replaceMermaidDiagramInGraph
} from '@open-pencil/core/editor'
import type { BoardBuildPlanNativeDiagramRecipe } from '@open-pencil/core/rpc'
import type { Rect, SceneNode, Vector } from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'
import {
  parseAuthorityFreePlacementTarget,
  parseAuthorityPlacementDirections,
  parseAuthorityRelativePlacementOffset,
  requireAuthorityAnchor,
  resolveAuthorityAnchoredPlacement,
  resolveAuthorityFreePlacement,
  type AuthorityFreePlacementTarget,
  type AuthorityPlacementDirection,
  type AuthorityRelativePlacementOffset
} from './placement'

const DEFAULT_CLEARANCE = 48

type AuthorityDiagramPlacement = { anchorId: string; kind: 'anchor' } | AuthorityFreePlacementTarget

export type AuthorityDiagramOperation = {
  clearance: number
  placement: AuthorityDiagramPlacement
  preferredDirections: AuthorityPlacementDirection[]
  relativeOffset?: AuthorityRelativePlacementOffset
}

export type CreatedAuthorityNativeDiagram = {
  kind: 'native_diagram'
  nodeIds: string[]
  owner: SceneNode
}

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

function boundedClearance(value: number | undefined): number {
  const result = value ?? DEFAULT_CLEARANCE
  if (!Number.isFinite(result) || result < 0 || result > 1_024) {
    throw new Error('placement.clearance must be between 0 and 1024.')
  }
  return result
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

export function authorityDiagramOperation(options: {
  anchorId?: string
  exactPoint?: Vector
  recipe: BoardBuildPlanNativeDiagramRecipe
}): AuthorityDiagramOperation {
  const { anchorId, exactPoint, recipe } = options
  const target = exactPoint
    ? ({ kind: 'point', ...exactPoint } as const)
    : anchorId
      ? ({ anchorId, kind: 'anchor' } as const)
      : parseAuthorityFreePlacementTarget(recipe.placement?.target)
  const relativeOffset = parseAuthorityRelativePlacementOffset(recipe.placement?.relative_offset)
  if (relativeOffset && target.kind !== 'anchor' && target.kind !== 'relative') {
    throw new Error('placement.relative_offset requires an anchor or relative placement.target.')
  }
  return {
    clearance: exactPoint ? 0 : boundedClearance(recipe.placement?.clearance),
    placement: target,
    preferredDirections: parseAuthorityPlacementDirections(recipe.placement?.preferred_directions),
    ...(relativeOffset ? { relativeOffset } : {})
  }
}

export function createAuthorityNativeDiagram(options: {
  document: AuthorityBoardDocument
  operation: AuthorityDiagramOperation
  pageId: string
  scene: MermaidSceneSpec
}): CreatedAuthorityNativeDiagram {
  const { document, operation, pageId, scene } = options
  const footprint = { height: scene.height, width: scene.width }
  const placement =
    operation.placement.kind === 'anchor'
      ? resolveAuthorityAnchoredPlacement({
          anchor: document.graph.getAbsoluteBounds(
            requireAuthorityAnchor(document.graph, pageId, operation.placement.anchorId).id
          ),
          clearance: operation.clearance,
          footprint,
          graph: document.graph,
          pageId,
          preferredDirections: operation.preferredDirections,
          ...(operation.relativeOffset ? { relativeOffset: operation.relativeOffset } : {})
        })
      : resolveAuthorityFreePlacement({
          clearance: operation.clearance,
          footprint,
          graph: document.graph,
          pageId,
          preferredDirections: operation.preferredDirections,
          ...(operation.relativeOffset ? { relativeOffset: operation.relativeOffset } : {}),
          target: operation.placement
        })
  const created = createMermaidDiagramInGraph(document.graph, pageId, scene, {
    x: placement.bounds.x,
    y: placement.bounds.y
  })
  const owner = document.graph.getNode(created.ownerId)
  if (!owner) throw new Error('Headless Mermaid owner disappeared during compilation.')
  return { kind: 'native_diagram', nodeIds: created.nodeIds, owner }
}

export function replaceAuthorityNativeDiagram(options: {
  document: AuthorityBoardDocument
  ownerId: string
  pageId: string
  scene: MermaidSceneSpec
}): CreatedAuthorityNativeDiagram {
  const { document, ownerId, pageId, scene } = options
  const current = readAuthorityMermaidSource(document, pageId, ownerId)
  if (current.reconciliation.status !== 'current') {
    throw new Error(
      `Mermaid owner "${ownerId}" cannot be regenerated because source reconciliation is "${current.reconciliation.status}".`
    )
  }
  const nodeIds = replaceMermaidDiagramInGraph(document.graph, pageId, ownerId, scene)
  const owner = document.graph.getNode(ownerId)
  if (!owner) throw new Error('Headless Mermaid owner disappeared during replacement.')
  return { kind: 'native_diagram', nodeIds, owner }
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
