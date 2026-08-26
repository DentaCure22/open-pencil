import { IS_BROWSER } from '@open-pencil/core/constants'

const EDITOR_LAYOUT_KEY = 'open-pencil:editor-layout'
export const LEFT_SIDEBAR_DEFAULT_PERCENT = 20
export const LEFT_SIDEBAR_MAX_PERCENT = 33
export const LEFT_SIDEBAR_MIN_PERCENT = 14

const DEFAULT_EDITOR_LAYOUT = [LEFT_SIDEBAR_DEFAULT_PERCENT, 100 - LEFT_SIDEBAR_DEFAULT_PERCENT]

export function normalizeEditorLayout(layout: number[]): number[] {
  const requested = layout[0] ?? LEFT_SIDEBAR_DEFAULT_PERCENT
  const left = Math.min(LEFT_SIDEBAR_MAX_PERCENT, Math.max(LEFT_SIDEBAR_MIN_PERCENT, requested))
  return [left, 100 - left]
}

export function loadEditorLayout(): number[] {
  if (!IS_BROWSER) return DEFAULT_EDITOR_LAYOUT
  try {
    const raw = window.localStorage.getItem(EDITOR_LAYOUT_KEY)
    if (!raw) return DEFAULT_EDITOR_LAYOUT
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'number')) {
      return DEFAULT_EDITOR_LAYOUT
    }
    if (parsed.length === 2 || parsed.length === 3) return normalizeEditorLayout(parsed)
    return DEFAULT_EDITOR_LAYOUT
  } catch {
    return DEFAULT_EDITOR_LAYOUT
  }
}

export function saveEditorLayout(layout: number[]): void {
  if (!IS_BROWSER) return
  window.localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(normalizeEditorLayout(layout)))
}
