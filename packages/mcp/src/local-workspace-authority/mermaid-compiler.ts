import mermaid from 'mermaid'

import { createMermaidSvgSpec, type MermaidSceneSpec } from '@open-pencil/core/diagram'

export class MermaidSourceValidationError extends Error {
  constructor(message: string, cause: unknown) {
    super(`Mermaid source validation failed: ${message} No mutation was applied.`, { cause })
    this.name = 'MermaidSourceValidationError'
  }
}

/**
 * Board persistence stores Mermaid source in one frame. The app renders that source to SVG;
 * authority-side writes therefore need no browser, Playwright session, or native-node compiler.
 */
export async function compileHeadlessMermaidScenes(
  sources: readonly string[]
): Promise<MermaidSceneSpec[]> {
  for (const source of sources) {
    try {
      await mermaid.parse(source)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('DOMPurify.')) continue
      throw new MermaidSourceValidationError(message, error)
    }
  }
  return sources.map((source) => createMermaidSvgSpec(source))
}
