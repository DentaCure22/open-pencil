import type { Plugin } from 'vite'

/**
 * Turn .md / .kiwi source into `export default "..."` modules.
 *
 * Handles Vite query suffixes so import-analysis never parses markdown as JS:
 *   file.md
 *   file.md?raw
 *   file.md?raw=
 *   file.md?import
 */
function isMarkdownOrKiwiId(id: string): boolean {
  const path = id.split('?')[0] ?? id
  // Ignore already-virtualized / node modules noise
  if (path.includes('node_modules')) return false
  return path.endsWith('.md') || path.endsWith('.kiwi')
}

export function rawMarkdownPlugin(): Plugin {
  return {
    name: 'raw-text-assets',
    enforce: 'pre',
    transform(code, id) {
      if (!isMarkdownOrKiwiId(id)) return null
      // If something already turned it into a module, leave it alone
      const trimmed = code.trimStart()
      if (trimmed.startsWith('export ') || trimmed.startsWith('import ')) {
        return null
      }
      return {
        code: `export default ${JSON.stringify(code)};\n`,
        map: null
      }
    }
  }
}
