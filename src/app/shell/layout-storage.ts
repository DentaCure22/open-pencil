import { IS_BROWSER } from '@open-pencil/core/constants'

const EDITOR_LAYOUT_KEY = 'open-pencil:editor-layout'
const DEFAULT_EDITOR_LAYOUT = [20, 80]

export function loadEditorLayout(): number[] {
  if (!IS_BROWSER) return DEFAULT_EDITOR_LAYOUT
  try {
    const raw = window.localStorage.getItem(EDITOR_LAYOUT_KEY)
    if (!raw) return DEFAULT_EDITOR_LAYOUT
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'number')) {
      return DEFAULT_EDITOR_LAYOUT
    }
    if (parsed.length === 2) return parsed
    if (parsed.length === 3) return [parsed[0], 100 - parsed[0]]
    return DEFAULT_EDITOR_LAYOUT
  } catch {
    return DEFAULT_EDITOR_LAYOUT
  }
}

export function saveEditorLayout(layout: number[]): void {
  if (!IS_BROWSER) return
  window.localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(layout))
}
