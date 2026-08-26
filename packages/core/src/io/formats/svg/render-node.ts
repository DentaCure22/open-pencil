import type { CharacterStyleOverride, Fill, SceneNode, Stroke } from '@open-pencil/scene-graph'

import { resolveNodeTextDirection } from '#core/text/direction'

import {
  createFilterDef,
  formatColor,
  nextDefId,
  resolveFill,
  SVG_BLEND_MODE,
  type SVGExportContext,
  SVG_STROKE_CAP,
  SVG_STROKE_JOIN
} from './defs'
import { svg, type SVGNode } from './node'
import {
  arcPath,
  geometryBlobToSVGPath,
  hasRadius,
  makePolygonPoints,
  round,
  roundedRectPath,
  vectorNetworkToSVGPaths
} from './paths'

function vectorShapeElements(
  node: SceneNode,
  common: Record<string, string | number | undefined>,
  strokeAttrs: Record<string, string | number | undefined>
): SVGNode[] {
  const elements: SVGNode[] = []
  if (node.fillGeometry.length > 0) {
    for (const geometry of node.fillGeometry) {
      const path = geometryBlobToSVGPath(geometry.commandsBlob)
      if (path) {
        elements.push(
          svg('path', {
            d: path,
            'fill-rule': geometry.windingRule === 'EVENODD' ? 'evenodd' : undefined,
            ...common
          })
        )
      }
    }
  } else if (node.vectorNetwork) {
    for (const path of vectorNetworkToSVGPaths(node.vectorNetwork)) {
      elements.push(svg('path', { d: path, ...common }))
    }
  }
  if (node.strokeGeometry.length > 0 && strokeAttrs.stroke && strokeAttrs.stroke !== 'none') {
    for (const geometry of node.strokeGeometry) {
      const path = geometryBlobToSVGPath(geometry.commandsBlob)
      if (path) {
        elements.push(
          svg('path', {
            d: path,
            fill: strokeAttrs.stroke as string,
            'fill-opacity': strokeAttrs['stroke-opacity'],
            stroke: 'none'
          })
        )
      }
    }
  }
  return elements.length > 0
    ? elements
    : [svg('rect', { width: round(node.width), height: round(node.height), ...common })]
}

function nodeShapeElements(
  node: SceneNode,
  fillAttr: string | null,
  strokeAttrs: Record<string, string | number | undefined>
): SVGNode[] {
  const common: Record<string, string | number | undefined> = {
    fill: fillAttr ?? 'none',
    ...strokeAttrs
  }

  switch (node.type) {
    case 'ELLIPSE':
      if (node.arcData) return [svg('path', { d: arcPath(node), ...common })]
      return [
        svg('ellipse', {
          cx: round(node.width / 2),
          cy: round(node.height / 2),
          rx: round(node.width / 2),
          ry: round(node.height / 2),
          ...common
        })
      ]
    case 'LINE':
      return [
        svg('line', {
          x1: 0,
          y1: 0,
          x2: round(node.width),
          y2: round(node.height),
          fill: 'none',
          ...strokeAttrs
        })
      ]
    case 'STAR':
    case 'POLYGON':
      return [svg('polygon', { points: makePolygonPoints(node), ...common })]
    case 'VECTOR':
      return vectorShapeElements(node, common, strokeAttrs)
    default:
      if (hasRadius(node)) {
        if (node.independentCorners) {
          return [svg('path', { d: roundedRectPath(node), ...common })]
        }
        return [
          svg('rect', {
            width: round(node.width),
            height: round(node.height),
            rx: round(node.cornerRadius),
            ry: round(node.cornerRadius),
            ...common
          })
        ]
      }
      return [svg('rect', { width: round(node.width), height: round(node.height), ...common })]
  }
}

function styleOverrideToTspanAttrs(
  style: CharacterStyleOverride,
  colorSpace: 'srgb' | 'display-p3'
): Record<string, string | number | undefined> {
  const attrs: Record<string, string | number | undefined> = {}
  if (style.fontFamily) attrs['font-family'] = style.fontFamily
  if (style.fontSize) attrs['font-size'] = style.fontSize
  if (style.fontWeight) attrs['font-weight'] = style.fontWeight
  if (style.italic) attrs['font-style'] = 'italic'
  if (style.letterSpacing) attrs['letter-spacing'] = round(style.letterSpacing)
  if (style.textDecoration === 'UNDERLINE') attrs['text-decoration'] = 'underline'
  if (style.textDecoration === 'STRIKETHROUGH') attrs['text-decoration'] = 'line-through'
  if (style.fills) {
    const visibleFill = style.fills.find((fill) => fill.visible && fill.type === 'SOLID')
    if (visibleFill) attrs.fill = formatColor(visibleFill.color, visibleFill.opacity, colorSpace)
  }
  return attrs
}

function isLogicalTextEnd(node: SceneNode, direction: 'LTR' | 'RTL'): boolean {
  return (
    (direction === 'LTR' && node.textAlignHorizontal === 'RIGHT') ||
    (direction === 'RTL' && node.textAlignHorizontal === 'LEFT')
  )
}

function textAnchorForNode(
  node: SceneNode,
  direction: 'LTR' | 'RTL'
): 'middle' | 'end' | undefined {
  if (node.textAlignHorizontal === 'CENTER') return 'middle'
  if (isLogicalTextEnd(node, direction)) return 'end'
  return undefined
}

function textXForNode(node: SceneNode, direction: 'LTR' | 'RTL'): number {
  if (node.textAlignHorizontal === 'CENTER') return round(node.width / 2)
  if (isLogicalTextEnd(node, direction)) return round(node.width)
  return 0
}

function renderTextNode(
  node: SceneNode,
  fillAttr: string | null,
  colorSpace: 'srgb' | 'display-p3'
): SVGNode {
  const direction = resolveNodeTextDirection(node)
  const textAnchor = textAnchorForNode(node, direction)

  let textDecoration: 'underline' | 'line-through' | undefined
  if (node.textDecoration === 'UNDERLINE') textDecoration = 'underline'
  else if (node.textDecoration === 'STRIKETHROUGH') textDecoration = 'line-through'

  const attrs: Record<string, string | number | undefined> = {
    'font-family': node.fontFamily || undefined,
    'font-size': node.fontSize || undefined,
    'font-weight': node.fontWeight !== 400 ? node.fontWeight : undefined,
    'font-style': node.italic ? 'italic' : undefined,
    fill: fillAttr ?? undefined,
    direction: direction === 'RTL' ? 'rtl' : undefined,
    'text-anchor': textAnchor,
    'text-decoration': textDecoration,
    'letter-spacing': node.letterSpacing ? round(node.letterSpacing) : undefined
  }

  const x = textXForNode(node, direction)
  const y = node.fontSize || 14

  if (node.styleRuns.length > 0) {
    const spans: SVGNode[] = []
    let position = 0
    for (const run of node.styleRuns) {
      const text = node.text.slice(position, position + run.length)
      position += run.length
      spans.push(svg('tspan', styleOverrideToTspanAttrs(run.style, colorSpace), text))
    }
    return svg('text', { x, y, ...attrs }, ...spans)
  }

  return svg('text', { x, y, ...attrs }, node.text)
}

function buildTransformAttr(node: SceneNode): string | undefined {
  const transforms: string[] = []
  if (node.x !== 0 || node.y !== 0) transforms.push(`translate(${round(node.x)}, ${round(node.y)})`)
  if (node.rotation !== 0) {
    transforms.push(
      `rotate(${round(node.rotation)}, ${round(node.width / 2)}, ${round(node.height / 2)})`
    )
  }
  if (node.flipX || node.flipY) {
    const tx = node.flipX ? node.width : 0
    const ty = node.flipY ? node.height : 0
    const sx = node.flipX ? -1 : 1
    const sy = node.flipY ? -1 : 1
    transforms.push(`translate(${round(tx)}, ${round(ty)}) scale(${sx}, ${sy})`)
  }
  return transforms.length > 0 ? transforms.join(' ') : undefined
}

function buildGroupAttrs(
  node: SceneNode,
  context: SVGExportContext
): { attrs: Record<string, string | number | undefined>; clipId?: string } {
  const attrs: Record<string, string | number | undefined> = {}
  const transform = buildTransformAttr(node)
  if (transform) attrs.transform = transform
  if (node.opacity < 1) attrs.opacity = round(node.opacity)

  const blend = SVG_BLEND_MODE[node.blendMode]
  if (blend && blend !== 'normal' && node.blendMode !== 'PASS_THROUGH') {
    attrs.style = `mix-blend-mode: ${blend}`
  }

  const filterDef = createFilterDef(node.effects, context)
  if (filterDef) {
    context.defs.push(filterDef.node)
    attrs.filter = `url(#${filterDef.id})`
  }

  let clipId: string | undefined
  if (node.clipsContent && node.childIds.length > 0) {
    clipId = nextDefId(context, 'clip')
    context.defs.push(
      svg(
        'clipPath',
        { id: clipId },
        svg('rect', { width: round(node.width), height: round(node.height) })
      )
    )
  }
  return { attrs, clipId }
}

function buildSVGStrokeAttrs(
  visibleStrokes: Stroke[],
  node: SceneNode,
  context: SVGExportContext
): Record<string, string | number | undefined> {
  if (visibleStrokes.length === 0) return {}
  const stroke = visibleStrokes[0]
  const attrs: Record<string, string | number | undefined> = {
    stroke: stroke.paint
      ? (resolveFill(stroke.paint, node, context) ??
        formatColor(stroke.color, 1, context.colorSpace))
      : formatColor(stroke.color, 1, context.colorSpace),
    'stroke-width': round(stroke.weight)
  }
  if (stroke.opacity < 1) attrs['stroke-opacity'] = round(stroke.opacity)
  if (stroke.cap && stroke.cap !== 'NONE') {
    attrs['stroke-linecap'] = SVG_STROKE_CAP[stroke.cap] ?? 'butt'
  }
  if (stroke.join && stroke.join !== 'MITER') {
    attrs['stroke-linejoin'] = SVG_STROKE_JOIN[stroke.join] ?? 'miter'
  }
  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    attrs['stroke-dasharray'] = stroke.dashPattern.map((value) => round(value)).join(' ')
  }
  return attrs
}

function isGroupLike(node: SceneNode): boolean {
  return node.type === 'GROUP'
}

function buildShapeChildren(
  node: SceneNode,
  visibleFills: Fill[],
  fillAttr: string | null,
  strokeAttrs: Record<string, string | number | undefined>,
  visibleStrokeCount: number,
  context: SVGExportContext
): SVGNode[] {
  if (visibleFills.length > 1) {
    const elements: SVGNode[] = []
    for (const fill of visibleFills) {
      const ref = resolveFill(fill, node, context)
      if (ref) {
        elements.push(
          ...nodeShapeElements(
            node,
            ref,
            fill === visibleFills[visibleFills.length - 1] ? strokeAttrs : {}
          )
        )
      }
    }
    return elements
  }

  const hasFillOrStroke = fillAttr || visibleStrokeCount > 0
  return hasFillOrStroke && !isGroupLike(node) ? nodeShapeElements(node, fillAttr, strokeAttrs) : []
}

export function renderSVGSceneNode(node: SceneNode, context: SVGExportContext): SVGNode | null {
  if (!node.visible) return null

  const { attrs: groupAttrs, clipId } = buildGroupAttrs(node, context)

  if (node.type === 'TEXT') {
    const firstFill = node.fills.find((fill) => fill.visible)
    const fillAttr = firstFill ? resolveFill(firstFill, node, context) : null
    return svg('g', groupAttrs, renderTextNode(node, fillAttr, context.colorSpace))
  }

  const visibleFills = node.fills.filter((fill) => fill.visible)
  const visibleStrokes = node.strokes.filter((stroke) => stroke.visible)
  const fillAttr = visibleFills.length > 0 ? resolveFill(visibleFills[0], node, context) : null
  const strokeAttrs = buildSVGStrokeAttrs(visibleStrokes, node, context)
  const children: SVGNode[] = buildShapeChildren(
    node,
    visibleFills,
    fillAttr,
    strokeAttrs,
    visibleStrokes.length,
    context
  )

  const childContent: SVGNode[] = []
  for (const child of context.graph.getChildren(node.id)) {
    const rendered = renderSVGSceneNode(child, context)
    if (rendered) childContent.push(rendered)
  }

  if (clipId && childContent.length > 0) {
    children.push(svg('g', { 'clip-path': `url(#${clipId})` }, ...childContent))
  } else {
    children.push(...childContent)
  }

  if (children.length === 0 && Object.keys(groupAttrs).length === 0) return null
  if (children.length === 1 && Object.keys(groupAttrs).length === 0) return children[0]
  return svg('g', groupAttrs, ...children)
}
