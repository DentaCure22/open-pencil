import type {
  PluginDataEntry,
  SceneGraph,
  SceneNode,
  Stroke,
  StyleRun
} from '@open-pencil/scene-graph'

import { colorToFill, parseColor } from '#core/color'

export interface TextSceneNodeOptions {
  color?: string
  fontSize?: number
  fontWeight?: number
  layoutAlignSelf?: SceneNode['layoutAlignSelf']
  layoutGrow?: number
  lineHeight?: number
  name: string
  pluginData?: PluginDataEntry[]
  styleRuns?: StyleRun[]
  textAlignHorizontal?: SceneNode['textAlignHorizontal']
  width: number
}

interface TextSceneNodeDefaults {
  color: string
  fontSize: number
  lineHeightMultiplier: number
}

export function solidStroke(color: string, weight = 1): Stroke {
  const parsed = parseColor(color)
  return {
    align: 'INSIDE',
    cap: 'NONE',
    color: parsed,
    dashPattern: [],
    join: 'MITER',
    opacity: parsed.a,
    visible: parsed.a > 0,
    weight
  }
}

function estimatedTextHeight(
  text: string,
  fontSize: number,
  width: number,
  lineHeight: number
): number {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.56)))
  const lineCount = text
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0)
  return Math.max(lineHeight, Math.ceil(lineCount * lineHeight))
}

export function createTextSceneNode(
  graph: SceneGraph,
  parentId: string,
  text: string,
  options: TextSceneNodeOptions,
  defaults: TextSceneNodeDefaults
): SceneNode {
  const fontSize = options.fontSize ?? defaults.fontSize
  const lineHeight = options.lineHeight ?? fontSize * defaults.lineHeightMultiplier
  return graph.createNode('TEXT', parentId, {
    fills: [colorToFill(options.color ?? defaults.color)],
    fontSize,
    fontWeight: options.fontWeight ?? 400,
    height: estimatedTextHeight(text, fontSize, options.width, lineHeight),
    layoutAlignSelf: options.layoutAlignSelf ?? 'STRETCH',
    layoutGrow: options.layoutGrow ?? 0,
    lineHeight,
    name: options.name,
    pluginData: options.pluginData ?? [],
    styleRuns: options.styleRuns ?? [],
    text,
    textAlignHorizontal: options.textAlignHorizontal ?? 'LEFT',
    textAutoResize: 'HEIGHT',
    width: options.width
  })
}
