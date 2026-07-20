import type { SceneNode } from '@open-pencil/scene-graph'

import type { MermaidLabel } from './types'

export function estimateTextSize(
  text: string,
  fontSize: number
): { width: number; height: number } {
  const lines = text.split('\n')
  const longest = Math.max(1, ...lines.map((line) => line.length))
  return {
    width: Math.max(20, Math.ceil(longest * fontSize * 0.62)),
    height: Math.max(fontSize * 1.25, lines.length * fontSize * 1.25)
  }
}

export function diagramTextAlign(
  label: MermaidLabel | undefined
): SceneNode['textAlignHorizontal'] {
  switch (label?.textAlign) {
    case 'left':
      return 'LEFT'
    case 'right':
      return 'RIGHT'
    default:
      return 'CENTER'
  }
}

export function diagramTextVerticalAlign(
  label: MermaidLabel | undefined
): SceneNode['textAlignVertical'] {
  switch (label?.verticalAlign) {
    case 'top':
      return 'TOP'
    case 'bottom':
      return 'BOTTOM'
    default:
      return 'CENTER'
  }
}
