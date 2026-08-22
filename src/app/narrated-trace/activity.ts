import type { SceneNode } from '@open-pencil/scene-graph'

import type { NarratedTraceChange } from './types'

const MEANINGFUL_NODE_PROPERTIES = new Set<keyof SceneNode>([
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'fills',
  'strokes',
  'effects',
  'opacity',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
  'independentCorners',
  'cornerSmoothing',
  'visible',
  'locked',
  'clipsContent',
  'blendMode',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'italic',
  'textAlignHorizontal',
  'textDirection',
  'textAlignVertical',
  'textAutoResize',
  'textCase',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationThickness',
  'textDecorationFills',
  'textDecorationSkipInk',
  'textUnderlineOffset',
  'leadingTrim',
  'lineHeight',
  'letterSpacing',
  'maxLines',
  'fontVariations',
  'fontFeatures',
  'horizontalConstraint',
  'verticalConstraint',
  'layoutMode',
  'layoutDirection',
  'layoutWrap',
  'primaryAxisAlign',
  'counterAxisAlign',
  'primaryAxisSizing',
  'counterAxisSizing',
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'layoutPositioning',
  'layoutGrow',
  'layoutAlignSelf',
  'arcData',
  'strokeCap',
  'strokeJoin',
  'dashPattern',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'independentStrokeWeights',
  'strokeMiterLimit',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'isMask',
  'maskType',
  'maskIsOutline',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnGap',
  'gridRowGap',
  'gridPosition',
  'counterAxisAlignContent',
  'itemReverseZIndex',
  'strokesIncludedInLayout',
  'textTruncation',
  'pointCount',
  'starInnerRadius',
  'boundVariables',
  'flipX',
  'flipY'
])

export type NarratedTraceNodeSnapshot = Partial<SceneNode> &
  Pick<
    SceneNode,
    'height' | 'id' | 'name' | 'parentId' | 'pluginData' | 'type' | 'width' | 'x' | 'y'
  >

export function snapshotNarratedTraceNode(node: SceneNode): NarratedTraceNodeSnapshot {
  const meaningfulProperties = Object.fromEntries(
    [...MEANINGFUL_NODE_PROPERTIES].flatMap((property) => {
      const value = node[property]
      return value === undefined ? [] : [[property, structuredClone(value)]]
    })
  ) as Partial<SceneNode>
  return {
    ...meaningfulProperties,
    height: node.height,
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    pluginData: structuredClone(node.pluginData),
    type: node.type,
    width: node.width,
    x: node.x,
    y: node.y
  }
}

function traceValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null) return 'null'
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 157)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    const serialized = JSON.stringify(value)
    if (typeof serialized !== 'string') return undefined
    return serialized.length > 320 ? `${serialized.slice(0, 317)}...` : serialized
  } catch {
    return undefined
  }
}

export function changesForNarratedTraceNodeUpdate(
  previous: Partial<SceneNode> | undefined,
  changes: Partial<SceneNode>
): NarratedTraceChange[] {
  return (Object.keys(changes) as Array<keyof SceneNode>).flatMap((property) => {
    if (!MEANINGFUL_NODE_PROPERTIES.has(property)) return []
    const after = traceValue(changes[property])
    const before = traceValue(previous?.[property])
    if (after === before) return []
    return [{ after, before, property: String(property) }]
  })
}
