const EXCALIDRAW_DEFAULT_STROKE_COLOR = '#1b1b1f'
const EXCALIDRAW_DEFAULT_SHAPE_COLOR = '#ffffff'

const DEFAULT_STROKE_COLOR = '#d7d9df'
export const DEFAULT_SHAPE_COLOR = '#24262c'
const DEFAULT_TEXT_COLOR = '#f4f5f7'

function normalizedColor(value: string | null | undefined): string | undefined {
  return value?.trim().toLowerCase()
}

export function diagramShapeColor(value: string | null | undefined): string {
  const color = normalizedColor(value)
  return !color || color === EXCALIDRAW_DEFAULT_SHAPE_COLOR ? DEFAULT_SHAPE_COLOR : color
}

export function diagramStrokeColor(value: string | null | undefined): string {
  const color = normalizedColor(value)
  return !color || color === EXCALIDRAW_DEFAULT_STROKE_COLOR ? DEFAULT_STROKE_COLOR : color
}

export function diagramTextColor(value: string | null | undefined): string {
  const color = normalizedColor(value)
  return !color || color === EXCALIDRAW_DEFAULT_STROKE_COLOR ? DEFAULT_TEXT_COLOR : color
}
