import type { SceneGraph, SceneGraphEvents, SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'

type EmittedGraphEventName = keyof SceneGraphEvents

type GraphEventOptions = {
  getGraph: () => SceneGraph
  getRenderers: () => Iterable<SkiaRenderer>
  scheduleComponentSync: (nodeId: string) => void
  requestRender: () => void
  emitEditorEvent: <K extends EmittedGraphEventName>(
    event: K,
    ...args: Parameters<SceneGraphEvents[K]>
  ) => void
}

const GEOMETRY_CACHE_KEYS = new Set<keyof SceneNode>([
  'vectorNetwork',
  'fillGeometry',
  'strokeGeometry'
])

const NODE_PICTURE_STABLE_KEYS = new Set<keyof SceneNode>([
  'x',
  'y',
  'rotation',
  'flipX',
  'flipY',
  'parentId'
])

const PARAGRAPH_CACHE_KEYS = new Set<keyof SceneNode>([
  'fills',
  'fontFamily',
  'fontFeatures',
  'fontSize',
  'fontVariations',
  'fontWeight',
  'height',
  'italic',
  'leadingTrim',
  'letterSpacing',
  'lineHeight',
  'maxLines',
  'styleRuns',
  'text',
  'textAlignHorizontal',
  'textAutoResize',
  'textDecoration',
  'textDecorationFills',
  'textDecorationStyle',
  'textDecorationThickness',
  'textDirection',
  'textTruncation',
  'width'
])

export type RendererInvalidation = {
  geometryCache: boolean
  nodePicture: boolean
  paragraphCache: boolean
}

export function rendererInvalidationForChanges(
  changes: Partial<SceneNode>,
  options: { preview: boolean }
): RendererInvalidation {
  const keys = Object.keys(changes) as (keyof SceneNode)[]
  const geometryCache = keys.some((key) => GEOMETRY_CACHE_KEYS.has(key))
  const nodePicture = keys.some((key) => !NODE_PICTURE_STABLE_KEYS.has(key))
  const paragraphCache = keys.some((key) => PARAGRAPH_CACHE_KEYS.has(key))
  return { geometryCache, nodePicture, paragraphCache }
}

function invalidateRenderersForChange(
  renderers: Iterable<SkiaRenderer>,
  graph: SceneGraph,
  id: string,
  changes: Partial<SceneNode>,
  invalidateNodePicture: boolean
) {
  const invalidation = rendererInvalidationForChanges(changes, { preview: !invalidateNodePicture })
  for (const renderer of renderers) {
    if (invalidation.geometryCache) renderer.invalidateVectorPath(id)
    if (invalidation.nodePicture) renderer.invalidateNodePicture(id)
    if (invalidation.paragraphCache) renderer.invalidateParagraphCache(id)
    const subtreeId = renderer.pageId ? topLevelSubtreeId(graph, id, renderer.pageId) : null
    if (subtreeId) renderer.invalidateSubtreePicture(subtreeId)
  }
}

function topLevelSubtreeId(graph: SceneGraph, nodeId: string, pageId: string): string | null {
  let node = graph.getNode(nodeId)
  while (node?.parentId) {
    if (node.parentId === pageId) return node.id
    node = graph.getNode(node.parentId)
  }
  return null
}

export function createGraphEventSubscription(options: GraphEventOptions) {
  let unbindGraphEvents: (() => void) | null = null

  function onNodeUpdated(id: string, changes: Partial<SceneNode>) {
    invalidateRenderersForChange(options.getRenderers(), options.getGraph(), id, changes, true)
    options.emitEditorEvent('node:updated', id, changes)
    options.scheduleComponentSync(id)
    options.requestRender()
  }

  function onNodePreviewUpdated(id: string, changes: Partial<SceneNode>) {
    const { nodePicture } = rendererInvalidationForChanges(changes, { preview: true })
    invalidateRenderersForChange(
      options.getRenderers(),
      options.getGraph(),
      id,
      changes,
      nodePicture
    )
    options.emitEditorEvent('node:previewUpdated', id, changes)
  }

  function invalidateStructure(nodeIds: Array<string | null | undefined>) {
    const graph = options.getGraph()
    for (const renderer of options.getRenderers()) {
      let targeted = false
      for (const nodeId of nodeIds) {
        if (!nodeId) continue
        renderer.invalidateNodePicture(nodeId)
        renderer.invalidateParagraphCache(nodeId)
        const subtreeId = renderer.pageId ? topLevelSubtreeId(graph, nodeId, renderer.pageId) : null
        if (subtreeId) {
          renderer.invalidateSubtreePicture(subtreeId)
          targeted = true
        }
      }
      if (!targeted) renderer.clearSubtreePictureCache()
    }
  }

  function onNodeStructureChanged(nodeId: string, extraIds: Array<string | null | undefined> = []) {
    invalidateStructure([nodeId, ...extraIds])
    options.scheduleComponentSync(nodeId)
    options.requestRender()
  }

  function subscribeToGraph() {
    unbindGraphEvents?.()
    unbindGraphEvents = options.getGraph().onNodeEvents({
      updated: onNodeUpdated,
      previewUpdated: onNodePreviewUpdated,
      created: (node) => {
        options.emitEditorEvent('node:created', node)
        onNodeStructureChanged(node.id, [node.parentId])
      },
      deleted: (id) => {
        options.emitEditorEvent('node:deleted', id)
        onNodeStructureChanged(id)
      },
      reparented: (nodeId, oldParentId, newParentId) => {
        options.emitEditorEvent('node:reparented', nodeId, oldParentId, newParentId)
        onNodeStructureChanged(nodeId, [oldParentId, newParentId])
      },
      reordered: (nodeId, parentId, index) => {
        options.emitEditorEvent('node:reordered', nodeId, parentId, index)
        onNodeStructureChanged(nodeId, [parentId])
      }
    })
  }

  return { subscribeToGraph }
}
