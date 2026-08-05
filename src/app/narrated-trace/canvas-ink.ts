import { colorToCSS, parseColor } from '@open-pencil/core/color'
import type { SceneNode, VectorNetwork } from '@open-pencil/scene-graph'
import { getWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import Matrix from '@open-pencil/scene-graph/matrix'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
import type { EditorPresentationViewport } from '@/app/editor/presentation'

import type { NarratedTraceInk, NarratedTracePoint, NarratedTraceTarget } from './types'

const CANVAS_INK_PLUGIN_ID = 'open-pencil.narrated-trace'
const CANVAS_INK_KIND_KEY = 'kind'
const CANVAS_INK_KIND = 'canvas-ink'

export type NarratedTraceCanvasInkProjection = {
  color: string
  id: string
  opacity: number
  path: string
  points: Vector[]
  selected: boolean
  strokeWidth: number
}

function canvasPoints(store: EditorStore, points: NarratedTracePoint[]) {
  return points.map((point) => store.screenToCanvas(point.x, point.y))
}

function boundsForCanvasPoints(points: Vector[], padding: number): Rect {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding
  return {
    height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2),
    x: minX,
    y: minY
  }
}

function inkNetwork(points: Vector[], bounds: Rect): VectorNetwork {
  const vertices = points.map((point) => ({
    x: point.x - bounds.x,
    y: point.y - bounds.y
  }))
  return {
    regions: [],
    segments: vertices.slice(1).map((_, index) => ({
      end: index + 1,
      start: index,
      tangentEnd: { x: 0, y: 0 },
      tangentStart: { x: 0, y: 0 }
    })),
    vertices
  }
}

function canvasInkPluginData() {
  return [{ key: CANVAS_INK_KIND_KEY, pluginId: CANVAS_INK_PLUGIN_ID, value: CANVAS_INK_KIND }]
}

export function isNarratedTraceCanvasInkNode(node: SceneNode | null | undefined) {
  return Boolean(
    node?.pluginData.some(
      (entry) =>
        entry.pluginId === CANVAS_INK_PLUGIN_ID &&
        entry.key === CANVAS_INK_KIND_KEY &&
        entry.value === CANVAS_INK_KIND
    )
  )
}

export function narratedTraceCanvasInkNodes(store: Pick<EditorStore, 'graph'>): SceneNode[] {
  return [...store.graph.nodes.values()].filter(isNarratedTraceCanvasInkNode)
}

function canvasInkTarget(store: EditorStore, node: SceneNode): NarratedTraceTarget {
  const page = store.graph.getNode(store.state.currentPageId)
  return {
    bounds: { height: node.height, width: node.width, x: node.x, y: node.y },
    name: node.name,
    path: [page?.name ?? 'Canvas', node.name],
    stableId: node.id
  }
}

export function createNarratedTraceCanvasInk(
  store: EditorStore,
  ink: NarratedTraceInk
): { node: SceneNode; target: NarratedTraceTarget } | null {
  const points = canvasPoints(store, ink.points)
  if (points.length < 2) return null
  const strokeWeight = ink.strokeWidth / Math.max(store.state.zoom, 0.01)
  const bounds = boundsForCanvasPoints(points, strokeWeight / 2)
  const parentId = store.state.currentPageId
  const node = store.graph.createNode('VECTOR', parentId, {
    fills: [],
    height: bounds.height,
    name: 'Intent drawing',
    pluginData: canvasInkPluginData(),
    strokes: [
      {
        align: 'CENTER',
        cap: 'ROUND',
        color: parseColor(ink.color),
        join: 'ROUND',
        opacity: 1,
        visible: true,
        weight: strokeWeight
      }
    ],
    vectorNetwork: inkNetwork(points, bounds),
    width: bounds.width,
    x: bounds.x,
    y: bounds.y
  })
  const snapshot = structuredClone(node)
  store.pushUndoEntry({
    forward: () => {
      store.graph.createNode(snapshot.type, parentId, structuredClone(snapshot))
      store.select([snapshot.id])
    },
    inverse: () => {
      store.graph.deleteNode(snapshot.id)
      store.select([])
    },
    label: 'Draw intent stroke'
  })
  store.select([node.id])
  store.requestRender()
  return { node, target: canvasInkTarget(store, node) }
}

function screenPoint(viewport: EditorPresentationViewport, point: Vector) {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY
  }
}

function transformedPoint(viewport: EditorPresentationViewport, matrix: number[], point: Vector) {
  return screenPoint(viewport, Matrix.mapPoint(matrix, point))
}

function projectedPath(store: EditorStore, node: SceneNode, viewport: EditorPresentationViewport) {
  const network = node.vectorNetwork
  if (!network) return { path: '', points: [] }
  const matrix = getWorldMatrix(node, store.graph)
  const points = network.vertices.map((vertex) => transformedPoint(viewport, matrix, vertex))
  const path = network.segments
    .map((segment) => {
      const start = network.vertices.at(segment.start)
      const end = network.vertices.at(segment.end)
      if (!start || !end) return ''
      const startPoint = transformedPoint(viewport, matrix, start)
      const endPoint = transformedPoint(viewport, matrix, end)
      const controlStart = transformedPoint(viewport, matrix, {
        x: start.x + segment.tangentStart.x,
        y: start.y + segment.tangentStart.y
      })
      const controlEnd = transformedPoint(viewport, matrix, {
        x: end.x + segment.tangentEnd.x,
        y: end.y + segment.tangentEnd.y
      })
      return [
        `M ${startPoint.x.toFixed(2)} ${startPoint.y.toFixed(2)}`,
        `C ${controlStart.x.toFixed(2)} ${controlStart.y.toFixed(2)}`,
        `${controlEnd.x.toFixed(2)} ${controlEnd.y.toFixed(2)}`,
        `${endPoint.x.toFixed(2)} ${endPoint.y.toFixed(2)}`
      ].join(' ')
    })
    .join(' ')
  return { path, points }
}

export function narratedTraceCanvasInkProjections(
  store: EditorStore,
  viewport: EditorPresentationViewport,
  nodes: Iterable<SceneNode>
): NarratedTraceCanvasInkProjection[] {
  return [...nodes].flatMap((node) => {
    if (!node.visible || !node.vectorNetwork) return []
    const stroke = node.strokes.find((candidate) => candidate.visible)
    if (!stroke) return []
    const projected = projectedPath(store, node, viewport)
    return [
      {
        color: colorToCSS(stroke.color),
        id: node.id,
        opacity: node.opacity * stroke.opacity,
        path: projected.path,
        points: projected.points,
        selected: store.state.selectedIds.has(node.id),
        strokeWidth: stroke.weight * viewport.zoom
      }
    ]
  })
}
