import { useLocalStorage, usePreferredDark } from '@vueuse/core'
import { computed, watch } from 'vue'

import type { RulerTheme } from '@open-pencil/core/canvas'
import { parseColor } from '@open-pencil/core/color'
import {
  CANVAS_BG_COLOR,
  CANVAS_BG_COLOR_DARK,
  IS_BROWSER
} from '@open-pencil/core/constants'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'

export type AppTheme = 'dark' | 'light' | 'auto'

const THEME_STORAGE_KEY = 'open-pencil:theme'
const DEFAULT_THEME: AppTheme = 'dark'

const theme = useLocalStorage<AppTheme>(THEME_STORAGE_KEY, DEFAULT_THEME)
const prefersDark = usePreferredDark()
const resolvedTheme = computed<'dark' | 'light'>(() => {
  if (theme.value === 'auto') return prefersDark.value ? 'dark' : 'light'
  return theme.value
})

function readRulerTheme(): RulerTheme | null {
  if (!IS_BROWSER || !('document' in globalThis)) return null
  const style = getComputedStyle(document.documentElement)
  return {
    background: parseColor(style.getPropertyValue('--color-ruler-bg')),
    tick: parseColor(style.getPropertyValue('--color-ruler-tick')),
    text: parseColor(style.getPropertyValue('--color-ruler-text')),
    label: parseColor(style.getPropertyValue('--color-ruler-label'))
  }
}

function isDefaultCanvasColor(color: Color): boolean {
  return [CANVAS_BG_COLOR, CANVAS_BG_COLOR_DARK].some(
    (candidate) =>
      Math.abs(color.r - candidate.r) < 0.001 &&
      Math.abs(color.g - candidate.g) < 0.001 &&
      Math.abs(color.b - candidate.b) < 0.001 &&
      Math.abs(color.a - candidate.a) < 0.001
  )
}

function updateCanvasTheme(value: 'dark' | 'light'): void {
  if (!IS_BROWSER) return
  const store = getActiveEditorStoreOrNull()
  if (!store) return
  store.state.rulerTheme = readRulerTheme() ?? undefined
  if (isDefaultCanvasColor(store.state.pageColor)) {
    store.setPageColor({ ...(value === 'dark' ? CANVAS_BG_COLOR_DARK : CANVAS_BG_COLOR) })
  } else {
    store.requestRepaint()
  }
}

function applyTheme(value: 'dark' | 'light', setting: AppTheme): void {
  if (!IS_BROWSER || !('document' in globalThis)) return
  document.documentElement.dataset.theme = value
  document.documentElement.dataset.themeSetting = setting
  document.documentElement.style.colorScheme = value
  updateCanvasTheme(value)
}

export function useAppTheme() {
  watch([resolvedTheme, theme], ([value, setting]) => applyTheme(value, setting), {
    immediate: true
  })

  const isLight = computed(() => resolvedTheme.value === 'light')

  function setTheme(value: AppTheme): void {
    theme.value = value
  }

  function toggleTheme(): void {
    theme.value = isLight.value ? 'dark' : 'light'
  }

  return { theme, resolvedTheme, isLight, setTheme, toggleTheme }
}

applyTheme(resolvedTheme.value, theme.value)
