import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid } from '@/app/demo/colors'

const PLUGIN_ID = 'smylr-production'
const FONT = 'Inter'

export const APP_FLOW_CODE_OBJECT_MEDIUM = 'code-object'
/** @deprecated Persisted compatibility only. */
export const APP_FLOW_NATIVE_REACT_MEDIUM = 'native-react'
const LEGACY_APP_FLOW_LIVE_REACT_MEDIUM = 'app-owned-react'

function opaque(r: number, g: number, b: number): Color {
  return { a: 1, b, g, r }
}

export const APP_FLOW_COLOR = {
  amber: opaque(0.95, 0.66, 0.2),
  amberSoft: opaque(0.28, 0.21, 0.09),
  blue: opaque(0.23, 0.45, 0.96),
  blueSoft: opaque(0.9, 0.94, 1),
  canvas: opaque(0.97, 0.975, 0.985),
  connector: opaque(0.56, 0.58, 0.63),
  coral: opaque(0.98, 0.4, 0.38),
  coralSoft: opaque(0.3, 0.12, 0.13),
  green: opaque(0.12, 0.62, 0.36),
  ink: opaque(0.08, 0.11, 0.18),
  line: opaque(0.83, 0.85, 0.9),
  muted: opaque(0.37, 0.42, 0.5),
  mutedLight: opaque(0.63, 0.67, 0.74),
  surface: opaque(0.11, 0.13, 0.18),
  violet: opaque(0.49, 0.35, 0.95),
  violetSoft: opaque(0.94, 0.92, 1),
  white: opaque(1, 1, 1)
}

export function appFlowPluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { key, pluginId: PLUGIN_ID, value }
}

export function appScreenFlowPluginValue(
  node: SceneNode | null | undefined,
  key: string
): string | undefined {
  return node?.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

export function isNativeReactAppFlowFrame(node: SceneNode | null | undefined): boolean {
  return appScreenFlowPluginValue(node, 'renderMedium') === APP_FLOW_NATIVE_REACT_MEDIUM
}

export function isCodeObjectAppFlowFrame(node: SceneNode | null | undefined): boolean {
  const medium = appScreenFlowPluginValue(node, 'renderMedium')
  return medium === APP_FLOW_CODE_OBJECT_MEDIUM || medium === LEGACY_APP_FLOW_LIVE_REACT_MEDIUM
}

export function mergeAppFlowPluginData(
  node: SceneNode,
  managedKeys: readonly string[],
  values: SceneNode['pluginData']
): SceneNode['pluginData'] {
  const managed = new Set(managedKeys)
  return [
    ...node.pluginData.filter((entry) => !(entry.pluginId === PLUGIN_ID && managed.has(entry.key))),
    ...values
  ]
}

export function addAppFlowText(
  graph: SceneGraph,
  parentId: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: 400 | 600 | 700,
  color: Color,
  maxWidth: number
) {
  const node = graph.createNode('TEXT', parentId, {
    fills: [solid(color)],
    fontFamily: FONT,
    fontSize,
    fontWeight,
    height: Math.ceil(fontSize * 1.4),
    name: text,
    text,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: Math.min(maxWidth, Math.max(32, Math.ceil(text.length * fontSize * 0.56))),
    x,
    y
  })
  return node
}

export function updateAppFlowText(
  graph: SceneGraph,
  nodeId: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: 400 | 600 | 700,
  color: Color,
  maxWidth: number
): SceneNode | null {
  const node = graph.getNode(nodeId)
  if (node?.type !== 'TEXT') return null
  graph.updateNode(node.id, {
    fills: [solid(color)],
    fontFamily: FONT,
    fontSize,
    fontWeight,
    height: Math.ceil(fontSize * 1.4),
    name: text,
    text,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: Math.min(maxWidth, Math.max(32, Math.ceil(text.length * fontSize * 0.56))),
    x,
    y
  })
  return graph.getNode(node.id) ?? node
}
