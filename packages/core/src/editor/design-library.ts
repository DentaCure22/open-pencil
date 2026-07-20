import type { SceneNode, Variable, VariableCollection } from '@open-pencil/scene-graph'

import {
  applyOpenPencilLibrary,
  type DesignLibraryReview,
  type OpenPencilLibrary
} from '#core/io/design-library'

import type { EditorContext } from './types'

interface LibraryApplySnapshot {
  nodes: Map<string, SceneNode>
  images: Map<string, Uint8Array>
  variables: Map<string, Variable>
  variableCollections: Map<string, VariableCollection>
  activeMode: Map<string, string>
  instanceIndex: Map<string, Set<string>>
}

function graphSnapshot(ctx: EditorContext): LibraryApplySnapshot {
  return {
    nodes: new Map([...ctx.graph.nodes].map(([id, node]) => [id, structuredClone(node)])),
    images: new Map([...ctx.graph.images].map(([hash, bytes]) => [hash, bytes.slice()])),
    variables: new Map(
      [...ctx.graph.variables].map(([id, variable]) => [id, structuredClone(variable)])
    ),
    variableCollections: new Map(
      [...ctx.graph.variableCollections].map(([id, collection]) => [
        id,
        structuredClone(collection)
      ])
    ),
    activeMode: new Map(ctx.graph.activeMode),
    instanceIndex: new Map(
      [...ctx.graph.instanceIndex].map(([id, instances]) => [id, new Set(instances)])
    )
  }
}

function restoreGraphSnapshot(ctx: EditorContext, snapshot: LibraryApplySnapshot) {
  ctx.graph.nodes = new Map([...snapshot.nodes].map(([id, node]) => [id, structuredClone(node)]))
  ctx.graph.images = new Map([...snapshot.images].map(([hash, bytes]) => [hash, bytes.slice()]))
  ctx.graph.variables = new Map(
    [...snapshot.variables].map(([id, variable]) => [id, structuredClone(variable)])
  )
  ctx.graph.variableCollections = new Map(
    [...snapshot.variableCollections].map(([id, collection]) => [id, structuredClone(collection)])
  )
  ctx.graph.activeMode = new Map(snapshot.activeMode)
  ctx.graph.instanceIndex = new Map(
    [...snapshot.instanceIndex].map(([id, instances]) => [id, new Set(instances)])
  )
  ctx.graph.clearAbsPosCache()
  ctx.requestRender()
}

export function createDesignLibraryActions(ctx: EditorContext) {
  function applyDesignLibraryPackage(library: OpenPencilLibrary, review: DesignLibraryReview) {
    const previous = graphSnapshot(ctx)
    const packageSnapshot = structuredClone(library)
    const reviewSnapshot = structuredClone(review)
    const apply = () => {
      applyOpenPencilLibrary(ctx.graph, packageSnapshot, reviewSnapshot)
      ctx.requestRender()
    }
    apply()
    ctx.undo.push({
      label: 'Apply library update',
      forward: apply,
      inverse: () => restoreGraphSnapshot(ctx, previous)
    })
  }

  return { applyDesignLibraryPackage }
}
