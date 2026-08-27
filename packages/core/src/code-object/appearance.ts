type JsonRecord = Record<string, unknown>

export const CODE_OBJECT_THEME_PREFERENCES = ['system', 'light', 'dark'] as const

export type CodeObjectTheme = 'dark' | 'light'
export type CodeObjectThemePreference = (typeof CODE_OBJECT_THEME_PREFERENCES)[number]

/** Semantic values available to authored Code Objects and as --code-* CSS variables. */
export type CodeObjectThemeTokens = {
  accent: string
  accentText: string
  background: string
  border: string
  danger: string
  focusRing: string
  radius: string
  shadow: string
  success: string
  surface: string
  surfaceElevated: string
  text: string
  textMuted: string
  warning: string
}

export type CodeObjectThemeTokenOverrides = Partial<CodeObjectThemeTokens>

export type CodeObjectAppearance = {
  preference: CodeObjectThemePreference
  tokens?: {
    dark?: CodeObjectThemeTokenOverrides
    light?: CodeObjectThemeTokenOverrides
  }
}

export type ResolvedCodeObjectAppearance = {
  preference: CodeObjectThemePreference
  theme: CodeObjectTheme
  tokens: CodeObjectThemeTokens
}

export const DEFAULT_CODE_OBJECT_APPEARANCE = {
  preference: 'system'
} as const satisfies CodeObjectAppearance

export const DEFAULT_CODE_OBJECT_THEME_TOKENS = {
  light: {
    accent: '#6d5dfc',
    accentText: '#ffffff',
    background: '#ffffff',
    border: 'rgba(24, 29, 45, 0.12)',
    danger: '#dc2626',
    focusRing: 'rgba(109, 93, 252, 0.34)',
    radius: '14px',
    shadow: '0 18px 48px rgba(31, 35, 48, 0.14)',
    success: '#16865a',
    surface: 'rgba(255, 255, 255, 0.82)',
    surfaceElevated: '#ffffff',
    text: '#202331',
    textMuted: '#697085',
    warning: '#b86a08'
  },
  dark: {
    accent: '#a99dff',
    accentText: '#191622',
    background: '#111217',
    border: 'rgba(255, 255, 255, 0.12)',
    danger: '#fb7185',
    focusRing: 'rgba(169, 157, 255, 0.42)',
    radius: '14px',
    shadow: '0 20px 54px rgba(0, 0, 0, 0.34)',
    success: '#56d5a0',
    surface: 'rgba(30, 31, 39, 0.82)',
    surfaceElevated: '#242630',
    text: '#f7f7fb',
    textMuted: '#a5a9b8',
    warning: '#f6b955'
  }
} as const satisfies Record<CodeObjectTheme, CodeObjectThemeTokens>

const TOKEN_KEYS = Object.keys(DEFAULT_CODE_OBJECT_THEME_TOKENS.light) as Array<
  keyof CodeObjectThemeTokens
>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizePreference(value: unknown): CodeObjectThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function normalizeTokenOverrides(value: unknown): CodeObjectThemeTokenOverrides | undefined {
  if (!isRecord(value)) return undefined
  const entries = TOKEN_KEYS.flatMap((key) => {
    const token = value[key]
    return typeof token === 'string' && token.trim() && token.length <= 240
      ? ([[key, token.trim()]] as const)
      : []
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export function normalizeCodeObjectAppearance(value: unknown): CodeObjectAppearance {
  if (!isRecord(value)) return { ...DEFAULT_CODE_OBJECT_APPEARANCE }
  const light = normalizeTokenOverrides(isRecord(value.tokens) ? value.tokens.light : undefined)
  const dark = normalizeTokenOverrides(isRecord(value.tokens) ? value.tokens.dark : undefined)
  return {
    preference: normalizePreference(value.preference),
    ...(light || dark
      ? {
          tokens: {
            ...(light ? { light } : {}),
            ...(dark ? { dark } : {})
          }
        }
      : {})
  }
}

export function resolveCodeObjectAppearance(
  value: unknown,
  systemTheme: CodeObjectTheme
): ResolvedCodeObjectAppearance {
  const appearance = normalizeCodeObjectAppearance(value)
  const theme = appearance.preference === 'system' ? systemTheme : appearance.preference
  return {
    preference: appearance.preference,
    theme,
    tokens: {
      ...DEFAULT_CODE_OBJECT_THEME_TOKENS[theme],
      ...appearance.tokens?.[theme]
    }
  }
}
