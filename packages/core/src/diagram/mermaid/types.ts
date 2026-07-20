import type { BlendMode, Fill, NodeType, SceneNode } from '@open-pencil/scene-graph'

export const MERMAID_DIAGRAM_REVISION = 4
export const MERMAID_PARSER = '@excalidraw/mermaid-to-excalidraw@2.2.2'
export const MERMAID_SVG_PARSER = 'mermaid@11.12.1/svg-native'

export type MermaidParserName = typeof MERMAID_PARSER | typeof MERMAID_SVG_PARSER

export interface MermaidLabel {
  text?: string | null
  fontSize?: number
  strokeColor?: string
  color?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  groupIds?: string[]
}

export interface MermaidSkeletonElement {
  id?: string
  type: string
  name?: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  strokeColor?: string | null
  backgroundColor?: string | null
  fillPaint?: Fill
  strokePaint?: Fill
  blendMode?: BlendMode
  strokeWidth?: number | null
  strokeStyle?: 'solid' | 'dashed' | 'dotted' | null
  strokeDasharray?: number[]
  strokeLineCap?: string
  strokeLineJoin?: string
  fillOpacity?: number
  strokeOpacity?: number
  opacity?: number
  path?: string
  fillRule?: 'NONZERO' | 'EVENODD'
  transform?: readonly [number, number, number, number, number, number]
  points?: readonly (readonly [number, number])[]
  label?: MermaidLabel
  groupIds?: string[]
  roundness?: { type?: number }
  startArrowhead?: string | null
  endArrowhead?: string | null
  children?: string[]
  fileId?: string
}

export interface MermaidBinaryFile {
  id: string
  mimeType: string
  dataURL: string
}

export interface MermaidDiagram {
  source: string
  revision: typeof MERMAID_DIAGRAM_REVISION
  parser: MermaidParserName
  elements: MermaidSkeletonElement[]
  files: Record<string, MermaidBinaryFile>
}

export type MermaidParser = (source: string) => Promise<unknown>

export interface MermaidSceneNodeSpec {
  key: string
  type: NodeType
  props: Partial<SceneNode>
}

export interface MermaidSceneSpec {
  source: string
  revision: typeof MERMAID_DIAGRAM_REVISION
  parser: MermaidParserName
  mode: 'editable'
  width: number
  height: number
  nodes: MermaidSceneNodeSpec[]
}
