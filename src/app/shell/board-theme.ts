import type { EditorStore } from '@/app/editor/active-store'

export const BOARD_THEME_COLLECTION_ID = 'openpencil:board-theme'
export const BOARD_THEME_MODE_IDS = {
  dark: 'openpencil:board-theme/dark',
  light: 'openpencil:board-theme/light'
} as const

export type ResolvedAppTheme = keyof typeof BOARD_THEME_MODE_IDS

export function applyBoardThemeToEditor(
  store: Pick<EditorStore, 'setPresentationVariableMode'>,
  theme: ResolvedAppTheme
): void {
  store.setPresentationVariableMode(BOARD_THEME_COLLECTION_ID, BOARD_THEME_MODE_IDS[theme])
}
