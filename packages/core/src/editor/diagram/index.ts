import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  isMermaidDiagramContainer,
  mermaidDiagramName,
  mermaidDiagramOwnerPluginData,
  type MermaidSceneSpec
} from '#core/diagram'
import type { EditorContext } from '#core/editor/types'

import { initializeMermaidSourceReconciliation } from './reconcile'

export {
  initializeMermaidSourceReconciliation,
  mermaidDiagramOwner,
  reconcileMermaidDiagramSource
} from './reconcile'

export interface InsertMermaidDiagramPosition {
  x: number
  y: number
}

interface MermaidDiagramSnapshot {
  owner: SceneNode
  children: SceneNode[]
}

export interface MermaidDiagramIdentity {
  diagramId: string
  ownerId: string
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

function snapshotDiagram(ctx: EditorContext, ownerId: string): MermaidDiagramSnapshot | null {
  const owner = ctx.graph.getNode(ownerId)
  if (!owner) return null
  const children: SceneNode[] = []
  const visit = (parent: SceneNode): void => {
    for (const id of parent.childIds) {
      const child = ctx.graph.getNode(id)
      if (!child) continue
      children.push(structuredClone(child))
      visit(child)
    }
  }
  visit(owner)
  return { owner: structuredClone(owner), children }
}

function restoreDiagram(
  ctx: EditorContext,
  parentId: string,
  snapshot: MermaidDiagramSnapshot
): void {
  const owner = ctx.graph.createNodeWithId(snapshot.owner.id, snapshot.owner.type, parentId, {
    ...structuredClone(snapshot.owner),
    childIds: []
  })
  for (const child of snapshot.children) {
    const childParentId = child.parentId === snapshot.owner.id ? owner.id : child.parentId
    if (!childParentId || !ctx.graph.getNode(childParentId)) {
      throw new Error(`Mermaid diagram child "${child.id}" has an unknown parent.`)
    }
    ctx.graph.createNodeWithId(child.id, child.type, childParentId, {
      ...structuredClone(child),
      childIds: []
    })
  }
}

export function createMermaidDiagramInGraph(
  graph: SceneGraph,
  parentId: string,
  diagram: MermaidSceneSpec,
  position: InsertMermaidDiagramPosition,
  identity?: MermaidDiagramIdentity
): { nodeIds: string[]; ownerId: string } {
  const ownerProps: Partial<SceneNode> = {
    name: mermaidDiagramName(diagram.source),
    x: position.x,
    y: position.y,
    width: diagram.width,
    height: diagram.height,
    fills: [],
    strokes: [],
    blendMode: 'NORMAL',
    clipsContent: false,
    pluginData: []
  }
  const owner = identity
    ? graph.createNodeWithId(identity.ownerId, 'FRAME', parentId, ownerProps)
    : graph.createNode('FRAME', parentId, ownerProps)
  const diagramId = identity?.diagramId ?? owner.id
  graph.updateNode(owner.id, {
    pluginData: mermaidDiagramOwnerPluginData(diagramId, diagram).map((entry) =>
      structuredClone(entry)
    )
  })

  initializeMermaidSourceReconciliation(graph, owner.id)
  return { nodeIds: [owner.id], ownerId: owner.id }
}

export function replaceMermaidDiagramInGraph(
  graph: SceneGraph,
  parentId: string,
  ownerId: string,
  diagram: MermaidSceneSpec,
  position?: InsertMermaidDiagramPosition
): string[] {
  const owner = graph.getNode(ownerId)
  if (!owner || !isMermaidDiagramContainer(owner) || owner.parentId !== parentId) {
    throw new Error(`Mermaid diagram "${ownerId}" was not found on the current page.`)
  }
  const diagramId = pluginValue(owner, 'mermaid/diagram-id')
  if (!diagramId) throw new Error(`Mermaid diagram "${ownerId}" has no diagram identity.`)
  const nextPosition = position ?? { x: owner.x, y: owner.y }
  const siblingIndex = graph.getNode(parentId)?.childIds.indexOf(ownerId) ?? -1
  graph.deleteNode(ownerId)
  const created = createMermaidDiagramInGraph(
    graph,
    parentId,
    { ...diagram, width: owner.width, height: owner.height },
    nextPosition,
    {
      diagramId,
      ownerId
    }
  )
  if (siblingIndex >= 0) graph.reorderChild(ownerId, parentId, siblingIndex)
  return created.nodeIds
}

function createDiagram(
  ctx: EditorContext,
  parentId: string,
  diagram: MermaidSceneSpec,
  position: InsertMermaidDiagramPosition,
  identity?: MermaidDiagramIdentity
): { nodeIds: string[]; snapshot: MermaidDiagramSnapshot } {
  const created = createMermaidDiagramInGraph(ctx.graph, parentId, diagram, position, identity)
  const snapshot = snapshotDiagram(ctx, created.ownerId)
  if (!snapshot) throw new Error('Failed to snapshot Mermaid diagram.')
  return { nodeIds: created.nodeIds, snapshot }
}

export function createDiagramActions(ctx: EditorContext) {
  function insertMermaidDiagram(
    diagram: MermaidSceneSpec,
    position: InsertMermaidDiagramPosition
  ): string[] {
    const parentId = ctx.state.currentPageId
    const previousSelection = new Set(ctx.state.selectedIds)
    const created = createDiagram(ctx, parentId, diagram, position)
    const ownerId = created.snapshot.owner.id
    ctx.setSelectedIds(new Set([ownerId]))

    ctx.undo.push({
      label: 'Insert Mermaid diagram',
      forward: () => {
        restoreDiagram(ctx, parentId, created.snapshot)
        ctx.setSelectedIds(new Set([ownerId]))
      },
      inverse: () => {
        ctx.graph.deleteNode(ownerId)
        ctx.setSelectedIds(new Set(previousSelection))
      }
    })

    return created.nodeIds
  }

  function replaceMermaidDiagram(
    ownerId: string,
    diagram: MermaidSceneSpec,
    position?: InsertMermaidDiagramPosition
  ): string[] {
    const parentId = ctx.state.currentPageId
    const owner = ctx.graph.getNode(ownerId)
    if (!isMermaidDiagramContainer(owner) || owner?.parentId !== parentId) {
      throw new Error(`Mermaid diagram "${ownerId}" was not found on the current page.`)
    }
    const diagramId = pluginValue(owner, 'mermaid/diagram-id')
    if (!diagramId) throw new Error(`Mermaid diagram "${ownerId}" has no diagram identity.`)
    const original = snapshotDiagram(ctx, ownerId)
    if (!original) throw new Error(`Mermaid diagram "${ownerId}" could not be read.`)
    const previousSelection = new Set(ctx.state.selectedIds)
    const nextPosition = position ?? { x: owner.x, y: owner.y }

    ctx.graph.deleteNode(ownerId)
    const replacement = createDiagram(
      ctx,
      parentId,
      { ...diagram, width: owner.width, height: owner.height },
      nextPosition,
      {
        diagramId,
        ownerId
      }
    )
    ctx.setSelectedIds(new Set([ownerId]))

    ctx.undo.push({
      label: 'Update Mermaid diagram',
      forward: () => {
        ctx.graph.deleteNode(ownerId)
        restoreDiagram(ctx, parentId, replacement.snapshot)
        ctx.setSelectedIds(new Set([ownerId]))
      },
      inverse: () => {
        ctx.graph.deleteNode(ownerId)
        restoreDiagram(ctx, parentId, original)
        ctx.setSelectedIds(new Set(previousSelection))
      }
    })

    return replacement.nodeIds
  }

  return { insertMermaidDiagram, replaceMermaidDiagram }
}
