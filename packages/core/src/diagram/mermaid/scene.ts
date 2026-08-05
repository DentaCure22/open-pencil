import type { MermaidAppearance, MermaidDiagram, MermaidSceneSpec } from './types'
import { MERMAID_DIAGRAM_REVISION, MERMAID_SVG_PARSER } from './types'

export function createMermaidSvgSpec(
  source: string,
  options: {
    appearance?: MermaidAppearance
    height?: number
    svg?: string
    width?: number
  } = {}
): MermaidSceneSpec {
  const definition = source.trim()
  if (!definition) throw new Error('Paste a Mermaid definition first.')
  return {
    appearance: options.appearance ?? 'dark',
    source: definition,
    revision: MERMAID_DIAGRAM_REVISION,
    parser: MERMAID_SVG_PARSER,
    width: options.width && options.width > 0 ? options.width : 720,
    height: options.height && options.height > 0 ? options.height : 480,
    ...(options.svg ? { svg: options.svg } : {})
  }
}

export function createMermaidSceneSpec(diagram: MermaidDiagram): MermaidSceneSpec {
  return createMermaidSvgSpec(diagram.source, {
    appearance: diagram.appearance,
    height: diagram.height,
    svg: diagram.svg,
    width: diagram.width
  })
}
