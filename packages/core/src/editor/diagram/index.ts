import { generateId, type SceneNode } from '@open-pencil/scene-graph'

import { mermaidDiagramPluginData, type MermaidSceneSpec } from '#core/diagram'
import type { EditorContext } from '#core/editor/types'

export interface InsertMermaidDiagramPosition {
  x: number
  y: number
}

interface MermaidDiagramSnapshot {
  owner: SceneNode
  children: SceneNode[]
}

function restoreDiagram(
  ctx: EditorContext,
  parentId: string,
  snapshot: MermaidDiagramSnapshot
): void {
  const owner = ctx.graph.createNodeWithId(snapshot.owner.id, 'FRAME', parentId, {
    ...structuredClone(snapshot.owner),
    childIds: []
  })
  for (const child of snapshot.children) {
    ctx.graph.createNodeWithId(child.id, child.type, owner.id, {
      ...structuredClone(child),
      childIds: []
    })
  }
}

export function createDiagramActions(ctx: EditorContext) {
  function insertMermaidDiagram(
    diagram: MermaidSceneSpec,
    position: InsertMermaidDiagramPosition
  ): string[] {
    const parentId = ctx.state.currentPageId
    const previousSelection = new Set(ctx.state.selectedIds)
    const diagramId = generateId()
    const diagramMetadata = mermaidDiagramPluginData(diagramId, diagram)
    const owner = ctx.graph.createNode('FRAME', parentId, {
      name: 'Mermaid diagram',
      x: position.x,
      y: position.y,
      width: diagram.width,
      height: diagram.height,
      fills: [],
      strokes: [],
      blendMode: 'NORMAL',
      clipsContent: false,
      pluginData: diagramMetadata.map((entry) => structuredClone(entry))
    })
    const nodeIds = diagram.nodes.map((node) => {
      const pluginData = [
        ...(node.props.pluginData ?? []).map((entry) => structuredClone(entry)),
        ...diagramMetadata.map((entry) => structuredClone(entry))
      ]
      return ctx.graph.createNode(node.type, owner.id, {
        ...structuredClone(node.props),
        x: node.props.x ?? 0,
        y: node.props.y ?? 0,
        pluginData
      }).id
    })

    const childSnapshots = nodeIds.flatMap((id) => {
      const node = ctx.graph.getNode(id)
      return node ? [structuredClone(node)] : []
    })
    const snapshot: MermaidDiagramSnapshot = {
      owner: structuredClone(owner),
      children: childSnapshots
    }
    ctx.setSelectedIds(new Set([owner.id]))

    ctx.undo.push({
      label: 'Insert Mermaid diagram',
      forward: () => {
        restoreDiagram(ctx, parentId, snapshot)
        ctx.setSelectedIds(new Set([owner.id]))
      },
      inverse: () => {
        ctx.graph.deleteNode(owner.id)
        ctx.setSelectedIds(new Set(previousSelection))
      }
    })

    return nodeIds
  }

  return { insertMermaidDiagram }
}
