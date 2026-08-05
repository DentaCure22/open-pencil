import type { SceneNode } from '@open-pencil/scene-graph'

import { weightToStyle } from '#core/text/fonts'
import { measureTextWithOpenType } from '#core/text/opentype'

export type TextMeasurer = (
  node: SceneNode,
  maxWidth?: number
) => { width: number; height: number } | null

let globalTextMeasurer: TextMeasurer | null = null

const GLYPH_WIDTH_FACTOR = 0.6

export function estimateTextSize(
  node: SceneNode,
  maxWidth?: number
): { width: number; height: number } {
  const fontSize = node.fontSize || 14
  const family = node.fontFamily || 'Inter'
  const style = weightToStyle(node.fontWeight || 400, node.italic)
  const text = node.text || ''

  const explicitLineH = (node.lineHeight ?? 0) > 0 ? (node.lineHeight as number) : undefined
  const charWidth = fontSize * GLYPH_WIDTH_FACTOR
  const lineH = (node.lineHeight ?? 0) > 0 ? (node.lineHeight as number) : Math.ceil(fontSize * 1.4)
  const hardLines = text.split(/\r\n?|\n/u)
  let width = 0
  let height = 0

  for (const hardLine of hardLines) {
    const measured = measureTextWithOpenType(
      hardLine,
      fontSize,
      family,
      style,
      maxWidth,
      explicitLineH
    )
    if (measured) {
      width = Math.max(width, measured.width)
      height += measured.height
      continue
    }

    const singleLineWidth = Math.ceil(hardLine.length * charWidth)
    if (maxWidth && maxWidth > 0 && singleLineWidth > maxWidth) {
      const lines = Math.ceil(singleLineWidth / maxWidth)
      width = Math.max(width, maxWidth)
      height += Math.ceil(lines * lineH)
      continue
    }
    width = Math.max(width, singleLineWidth)
    height += lineH
  }

  return { width, height }
}

export function getTextMeasurer(): TextMeasurer | null {
  return globalTextMeasurer
}

export function setTextMeasurer(measurer: TextMeasurer | null): void {
  globalTextMeasurer = measurer
}
