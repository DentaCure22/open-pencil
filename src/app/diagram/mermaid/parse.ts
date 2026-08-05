import type { MermaidAppearance, MermaidDiagram } from '@open-pencil/core/diagram'

import { renderMermaidSvgInBrowser } from './render'

export function parseMermaidInBrowser(source: string): Promise<MermaidDiagram> {
  const theme = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme
  const appearance: MermaidAppearance = theme === 'light' ? 'light' : 'dark'
  return renderMermaidSvgInBrowser(source, appearance)
}
