import type { PluginDataEntry, StyleRun } from '@open-pencil/scene-graph'

import { colorToFill } from '#core/color'

import { ACCENT_COLOR, markdownInlinePluginData, MUTED_COLOR } from './scene'
import type { MarkdownInlineContent } from './types'

function inlineStyleRuns(content: MarkdownInlineContent): StyleRun[] {
  return content.runs.map((run) => {
    const style: StyleRun['style'] = {}
    if (run.style.strong) style.fontWeight = 700
    if (run.style.emphasis) style.italic = true
    if (run.style.code) {
      style.fontFamily = 'Roboto Mono'
      style.fills = [colorToFill(MUTED_COLOR)]
    }
    if (run.style.strike) style.textDecoration = 'STRIKETHROUGH'
    if (run.style.link) {
      style.fills = [colorToFill(ACCENT_COLOR)]
      style.textDecoration = 'UNDERLINE'
    }
    return { start: run.start, length: run.length, style }
  })
}

export function markdownInlineTextProps(
  content: MarkdownInlineContent,
  blockData: PluginDataEntry[] = []
): { pluginData: PluginDataEntry[]; styleRuns: StyleRun[] } {
  return {
    pluginData: [...blockData, ...markdownInlinePluginData(content.links)],
    styleRuns: inlineStyleRuns(content)
  }
}
