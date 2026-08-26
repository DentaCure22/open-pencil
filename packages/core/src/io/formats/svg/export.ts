import type { SceneGraph } from '@open-pencil/scene-graph'

import { computeContentBounds } from '#core/io/formats/raster'

import type { SVGExportContext } from './defs'
import { renderSVGNode, svg, type SVGNode } from './node'
import { round } from './paths'
import { renderSVGSceneNode } from './render-node'

export { geometryBlobToSVGPath, vectorNetworkToSVGPaths } from './paths'

export interface SVGExportOptions {
  /** Include XML declaration (default: true) */
  xmlDeclaration?: boolean
  /** Target export color space (default: srgb) */
  colorSpace?: 'srgb' | 'display-p3'
}

export function renderNodesToSVG(
  graph: SceneGraph,
  _pageId: string,
  nodeIds: string[],
  options: SVGExportOptions = {}
): string | null {
  const bounds = computeContentBounds(graph, nodeIds)
  if (!bounds) return null

  const { minX, minY, maxX, maxY } = bounds
  const width = round(maxX - minX)
  const height = round(maxY - minY)

  const context: SVGExportContext = {
    defs: [],
    defIdCounter: 0,
    graph,
    colorSpace: options.colorSpace ?? 'srgb'
  }

  const contentNodes: SVGNode[] = []
  for (const id of nodeIds) {
    const node = graph.getNode(id)
    if (!node?.visible) continue

    const absolutePosition = graph.getAuthoritativeAbsolutePosition(id)
    const offsetX = absolutePosition.x - minX
    const offsetY = absolutePosition.y - minY
    const needsOffset = offsetX !== node.x || offsetY !== node.y
    const exportNode = needsOffset ? { ...node, x: round(offsetX), y: round(offsetY) } : node

    const rendered = renderSVGSceneNode(exportNode, context)
    if (rendered) contentNodes.push(rendered)
  }

  if (contentNodes.length === 0) return null

  const rootChildren: SVGNode[] = []
  if (context.defs.length > 0) rootChildren.push(svg('defs', {}, ...context.defs))
  rootChildren.push(...contentNodes)

  const root = svg(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      width,
      height,
      viewBox: `0 0 ${width} ${height}`
    },
    ...rootChildren
  )

  const xmlDeclaration =
    options.xmlDeclaration !== false ? '<?xml version="1.0" encoding="UTF-8"?>\n' : ''
  return xmlDeclaration + renderSVGNode(root)
}
