import type { MermaidDiagram } from '@open-pencil/core/diagram'

import { parseMermaidSvgInBrowser } from './svg'

export function parseMermaidInBrowser(source: string): Promise<MermaidDiagram> {
  return parseMermaidSvgInBrowser(source)
}
