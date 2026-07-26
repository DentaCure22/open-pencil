import type { SceneNode } from '@open-pencil/scene-graph'

import type { NarratedTraceChange } from './types'

const MEANINGFUL_NODE_PROPERTIES = new Set<string>([
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
    if (!MEANINGFUL_NODE_PROPERTIES.has(String(property))) return []
    const after = traceValue(changes[property])
    const before = traceValue(previous?.[property])
    if (after === before) return []
    return [{ after, before, property: String(property) }]
  })
}
