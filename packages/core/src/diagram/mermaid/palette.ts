import { wcagContrast } from 'culori'

import { parseColor } from '#core/color'

import type { MermaidAppearance } from './types'

const EXCALIDRAW_DEFAULT_STROKE_COLOR = '#1b1b1f'
const EXCALIDRAW_DEFAULT_SHAPE_COLOR = '#ffffff'

const DEFAULT_STROKE_COLOR = '#d7d9df'
export const DEFAULT_SHAPE_COLOR = '#24262c'
const DEFAULT_TEXT_COLOR = '#f4f5f7'
const LIGHT_STROKE_COLOR = '#1b1b1f'
export const LIGHT_SHAPE_COLOR = '#ffffff'
const LIGHT_TEXT_COLOR = '#1b1b1f'
const DARK_CANVAS_COLOR = '#18191d'
const DARK_PATH_FILL_COLOR = '#646976'

function colorContrast(left: string, right: string): number {
  return wcagContrast({ mode: 'rgb', ...parseColor(left) }, { mode: 'rgb', ...parseColor(right) })
}

function normalizedColor(value: string | null | undefined): string | undefined {
  return value?.trim().toLowerCase()
}

export function diagramShapeColor(
  value: string | null | undefined,
  appearance: MermaidAppearance = 'dark'
): string {
  const color = normalizedColor(value)
  if (color && color !== EXCALIDRAW_DEFAULT_SHAPE_COLOR) return color
  return appearance === 'light' ? LIGHT_SHAPE_COLOR : DEFAULT_SHAPE_COLOR
}

export function diagramStrokeColor(
  value: string | null | undefined,
  appearance: MermaidAppearance = 'dark'
): string {
  const color = normalizedColor(value)
  if (color && color !== EXCALIDRAW_DEFAULT_STROKE_COLOR) return color
  return appearance === 'light' ? LIGHT_STROKE_COLOR : DEFAULT_STROKE_COLOR
}

export function diagramTextColor(
  value: string | null | undefined,
  appearance: MermaidAppearance = 'dark'
): string {
  const color = normalizedColor(value)
  if (!color || color === EXCALIDRAW_DEFAULT_STROKE_COLOR) {
    return appearance === 'light' ? LIGHT_TEXT_COLOR : DEFAULT_TEXT_COLOR
  }
  if (appearance === 'light') return color
  const parsed = parseColor(color)
  const darkest = Math.min(parsed.r, parsed.g, parsed.b)
  const lightest = Math.max(parsed.r, parsed.g, parsed.b)
  return lightest <= 0.3 && lightest - darkest <= 0.08 ? DEFAULT_TEXT_COLOR : color
}

export function diagramPathStrokeColor(
  value: string | null | undefined,
  appearance: MermaidAppearance = 'dark'
): string {
  const color = diagramStrokeColor(value, appearance)
  const canvas = appearance === 'light' ? LIGHT_SHAPE_COLOR : DARK_CANVAS_COLOR
  if (colorContrast(color, canvas) >= 3) return color
  return appearance === 'light' ? LIGHT_STROKE_COLOR : DEFAULT_STROKE_COLOR
}

export function diagramPathFillColor(
  value: string | null | undefined,
  appearance: MermaidAppearance = 'dark'
): string {
  const color = diagramShapeColor(value, appearance)
  if (appearance === 'light' || colorContrast(color, DARK_CANVAS_COLOR) >= 3) return color
  return DARK_PATH_FILL_COLOR
}
