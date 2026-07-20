import { ref, shallowRef } from 'vue'

import type { NarratedTraceInk, NarratedTracePoint } from './types'

export type NarratedTraceFocusTrailPoint = NarratedTracePoint & {
  atMs: number
}

export type NarratedTraceAnnotationTool = 'none' | 'ink' | 'focus'

export const narratedTraceAnnotationTool = ref<NarratedTraceAnnotationTool>('none')
export const narratedTraceInkStrokes = shallowRef<NarratedTraceInk[]>([])

export function setNarratedTraceAnnotationTool(tool: NarratedTraceAnnotationTool) {
  narratedTraceAnnotationTool.value = tool
}

export function addNarratedTraceInkStroke(stroke: NarratedTraceInk) {
  narratedTraceInkStrokes.value = [...narratedTraceInkStrokes.value, stroke]
}

export function clearNarratedTraceInkStrokes() {
  narratedTraceInkStrokes.value = []
}

export function resetNarratedTraceAnnotations() {
  narratedTraceAnnotationTool.value = 'none'
  narratedTraceInkStrokes.value = []
}

export function narratedTracePointsPath(
  points: readonly NarratedTracePoint[] | null | undefined,
  offset: NarratedTracePoint = { x: 0, y: 0 },
  scale = 1
) {
  if (!Array.isArray(points)) return ''
  return points
    .map((point, index) => {
      const x = (point.x - offset.x) * scale
      const y = (point.y - offset.y) * scale
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export function narratedTraceSmoothPointsPath(
  points: readonly NarratedTracePoint[] | null | undefined
) {
  if (!Array.isArray(points) || points.length < 2) return ''
  const first = points[0]
  const curves = points.slice(1).map((point, index) => {
    const from = points[index]
    const before = points[index - 1] ?? from
    const after = points[index + 2] ?? point
    const controlFrom = {
      x: from.x + (point.x - before.x) / 6,
      y: from.y + (point.y - before.y) / 6
    }
    const controlTo = {
      x: point.x - (after.x - from.x) / 6,
      y: point.y - (after.y - from.y) / 6
    }
    return [
      `C ${controlFrom.x.toFixed(2)} ${controlFrom.y.toFixed(2)}`,
      `${controlTo.x.toFixed(2)} ${controlTo.y.toFixed(2)}`,
      `${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    ].join(' ')
  })
  return [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`, ...curves].join(' ')
}
