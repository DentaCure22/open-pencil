export const MERMAID_DIAGRAM_REVISION = 4
export const MERMAID_SVG_PARSER = 'mermaid@11.16.0/svg'

export type MermaidParserName = typeof MERMAID_SVG_PARSER
export type MermaidAppearance = 'dark' | 'light'

export interface MermaidDiagram {
  appearance?: MermaidAppearance
  source: string
  revision: typeof MERMAID_DIAGRAM_REVISION
  parser: MermaidParserName
  height?: number
  svg?: string
  width?: number
}

export interface MermaidSceneSpec {
  appearance: MermaidAppearance
  source: string
  revision: typeof MERMAID_DIAGRAM_REVISION
  parser: MermaidParserName
  width: number
  height: number
  svg?: string
}
