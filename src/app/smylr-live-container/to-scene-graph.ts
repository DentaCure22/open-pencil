import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { cloneNodeProps } from '@open-pencil/scene-graph/copy'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import { parseColor } from '@open-pencil/core/color'

import { designDocumentToSceneGraph } from '../../../packages/dom-css/src/to-scene-graph'
import { smylrLiveContainerToDesignDocuments } from './to-design-document'
import type { SmylrLiveContainerDocument, SmylrLiveContainerNode } from './types'

export function copySmylrLiveContainerGraphResources(source: SceneGraph, target: SceneGraph): void {
  for (const [hash, bytes] of source.images) target.images.set(hash, bytes)
  for (const [id, variable] of source.variables) target.variables.set(id, structuredClone(variable))
  for (const [id, collection] of source.variableCollections) {
    target.variableCollections.set(id, structuredClone(collection))
  }
  for (const [collectionId, modeId] of source.activeMode)
    target.activeMode.set(collectionId, modeId)
}

function cloneIntoGraph(
  source: SceneGraph,
  sourceNode: SceneNode,
  target: SceneGraph,
  targetParentId: string
): SceneNode {
  const clone = target.createNode(sourceNode.type, targetParentId, cloneNodeProps(sourceNode, null))

  for (const childId of sourceNode.childIds) {
    const child = source.getNode(childId)
    if (child) cloneIntoGraph(source, child, target, clone.id)
  }

  return clone
}

function scaleVectorNetwork(network: NonNullable<SceneNode['vectorNetwork']>, width: number, height: number) {
  if (network.vertices.length === 0) return
  const xs = network.vertices.map((vertex) => vertex.x)
  const ys = network.vertices.map((vertex) => vertex.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sourceWidth = maxX - minX
  const sourceHeight = maxY - minY
  if (sourceWidth <= 0 || sourceHeight <= 0) return
  const scaleX = width / sourceWidth
  const scaleY = height / sourceHeight

  for (const vertex of network.vertices) {
    vertex.x = (vertex.x - minX) * scaleX
    vertex.y = (vertex.y - minY) * scaleY
  }
  for (const segment of network.segments) {
    segment.tangentStart = {
      x: segment.tangentStart.x * scaleX,
      y: segment.tangentStart.y * scaleY
    }
    segment.tangentEnd = {
      x: segment.tangentEnd.x * scaleX,
      y: segment.tangentEnd.y * scaleY
    }
  }
}

function nativeStrokeCap(value: string | undefined): SceneNode['strokeCap'] {
  if (value === 'round') return 'ROUND'
  if (value === 'square') return 'SQUARE'
  return 'NONE'
}

function nativeStrokeJoin(value: string | undefined): SceneNode['strokeJoin'] {
  if (value === 'round') return 'ROUND'
  if (value === 'bevel') return 'BEVEL'
  return 'MITER'
}

function nativeColor(value: string | undefined) {
  if (!value || value === 'none' || value === 'transparent') return null
  return parseColor(value)
}

function restoreNativeSvgPaths(graph: SceneGraph, root: SmylrLiveContainerNode) {
  const visit = (liveNode: SmylrLiveContainerNode) => {
    const path = liveNode.attrs?.['data-smylr-vector-path']
    if (path) {
      const placeholder = Array.from(graph.getAllNodes()).find(
        (candidate) => candidate.name === liveNode.id
      )
      if (placeholder?.parentId) {
        const network = parseSVGPath(path)
        scaleVectorNetwork(network, placeholder.width, placeholder.height)
        const vector = graph.createNode('VECTOR', placeholder.parentId, {
          height: placeholder.height,
          layoutPositioning: placeholder.layoutPositioning,
          name: liveNode.label || 'SVG path',
          opacity: placeholder.opacity,
          pluginData: structuredClone(placeholder.pluginData),
          width: placeholder.width,
          x: placeholder.x,
          y: placeholder.y
        })
        vector.vectorNetwork = network
        const fillColor = nativeColor(liveNode.computedStyle?.fill)
        vector.fills = fillColor
          ? [{ type: 'SOLID', color: fillColor, opacity: fillColor.a, visible: true }]
          : []
        const strokeColor = nativeColor(liveNode.computedStyle?.stroke)
        const strokeWeight = Number.parseFloat(liveNode.computedStyle?.['stroke-width'] ?? '')
        vector.strokes = strokeColor && strokeWeight > 0
          ? [{
              align: 'INSIDE',
              color: strokeColor,
              opacity: strokeColor.a,
              visible: true,
              weight: strokeWeight
            }]
          : []
        vector.strokeCap = nativeStrokeCap(liveNode.computedStyle?.['stroke-linecap'])
        vector.strokeJoin = nativeStrokeJoin(liveNode.computedStyle?.['stroke-linejoin'])
        graph.deleteNode(placeholder.id)
      }
    }
    for (const child of liveNode.children ?? []) visit(child)
  }

  visit(root)
}

export function smylrLiveContainerToSceneGraph(document: SmylrLiveContainerDocument): SceneGraph {
  const entries = smylrLiveContainerToDesignDocuments(document)
  const graph = new SceneGraph()
  const firstPage = graph.getPages()[0] ?? graph.addPage(document.title)

  entries.forEach(({ designDocument, page }, index) => {
    const sourceGraph = designDocumentToSceneGraph(designDocument, {
      pageName: page.title
    })
    restoreNativeSvgPaths(sourceGraph, page.tree)
    const sourcePage = sourceGraph.getPages()[0]

    copySmylrLiveContainerGraphResources(sourceGraph, graph)

    const targetPage = index === 0 ? firstPage : graph.addPage(page.title)
    graph.updateNode(targetPage.id, {
      height: sourcePage.height,
      name: page.title,
      width: sourcePage.width
    })

    for (const child of sourceGraph.getChildren(sourcePage.id)) {
      cloneIntoGraph(sourceGraph, child, graph, targetPage.id)
    }
  })

  return graph
}
