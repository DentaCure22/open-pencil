import { converter, parse } from 'culori'

/**
 * Smylr design-system token catalog for OpenPencil canvas boards.
 *
 * Full light + dark previews from:
 *   `src/styles/globals.css` (`:root` + `.dark`)
 * Docs:
 *   `DESIGN.md`
 *   `.agents/skills/design-system/reference/tokens.md`
 *   `.agents/skills/design-system/reference/shadows.md`
 * Brand assets:
 *   `public/brand/*`
 */
import type { Color } from '@open-pencil/scene-graph'

import reference from './smylr-tokens.reference.json'

export type SmylrTokenCategory =
  | 'border'
  | 'chart'
  | 'radius'
  | 'shadow'
  | 'spacing'
  | 'status'
  | 'surface'
  | 'text'

export type SmylrTokenPreviewKind = 'color' | 'radius' | 'shadow' | 'spacing' | 'text'

export type SmylrTokenShadowPreview = {
  x: number
  y: number
  blur: number
  spread: number
  a: number
  inset: boolean
}

export type SmylrTokenDefinition = {
  category: string
  cssProperty: string
  cssVariable: string
  label: string
  sourceFile: string
  valueLight?: string
  valueDark?: string
  resolvedValueLight?: string
  resolvedValueDark?: string
  previewKind?: SmylrTokenPreviewKind
  radiusPx?: number
  shadow?: SmylrTokenShadowPreview
  shadowDark?: SmylrTokenShadowPreview
  spacingPx?: number
  styleValue?: string
  utilities?: string[]
}

export const SMYLR_TOKEN_REFERENCE = reference as {
  version: number
  themes?: string[]
  source?: string
  references?: string[]
  tokens: SmylrTokenDefinition[]
}

export const SMYLR_TOKEN_DEFINITIONS: readonly SmylrTokenDefinition[] = SMYLR_TOKEN_REFERENCE.tokens

export const SMYLR_TOKEN_CATEGORY_ORDER = [
  'surface',
  'text',
  'status',
  'border',
  'radius',
  'shadow',
  'chart',
  'spacing'
] as const

export const SMYLR_TOKEN_CATEGORY_LABELS: Record<string, string> = {
  surface: 'Surfaces',
  text: 'Text',
  status: 'Status',
  border: 'Borders',
  radius: 'Radius',
  shadow: 'Elevation',
  chart: 'Charts',
  spacing: 'Spacing'
}

const toRgb = converter('rgb')

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function tokenColorPreview(value: string | undefined): Color | undefined {
  if (!value) return undefined
  const parsed = parse(value)
  if (!parsed) return undefined
  const converted = toRgb(parsed)
  return {
    r: clampUnit(converted.r),
    g: clampUnit(converted.g),
    b: clampUnit(converted.b),
    a: clampUnit(converted.alpha ?? 1)
  }
}

export function tokenPreviewLight(token: SmylrTokenDefinition): Color | undefined {
  return tokenColorPreview(token.resolvedValueLight ?? token.valueLight)
}

export function tokenPreviewDark(token: SmylrTokenDefinition): Color | undefined {
  return tokenColorPreview(
    token.resolvedValueDark ?? token.valueDark ?? token.resolvedValueLight ?? token.valueLight
  )
}

export function tokenValueLight(token: SmylrTokenDefinition): string {
  return token.valueLight ?? token.styleValue ?? token.cssProperty
}

export function tokenValueDark(token: SmylrTokenDefinition): string {
  return token.valueDark ?? token.valueLight ?? token.styleValue ?? token.cssProperty
}

export function smylrTokensByCategory(
  tokens: readonly SmylrTokenDefinition[] = SMYLR_TOKEN_DEFINITIONS
): Array<{ category: string; label: string; tokens: SmylrTokenDefinition[] }> {
  const map = new Map<string, SmylrTokenDefinition[]>()
  for (const token of tokens) {
    const list = map.get(token.category) ?? []
    list.push(token)
    map.set(token.category, list)
  }
  const groups: Array<{ category: string; label: string; tokens: SmylrTokenDefinition[] }> = []
  for (const category of SMYLR_TOKEN_CATEGORY_ORDER) {
    const list = map.get(category)
    if (list?.length) {
      groups.push({
        category,
        label: SMYLR_TOKEN_CATEGORY_LABELS[category] ?? category,
        tokens: list
      })
      map.delete(category)
    }
  }
  for (const [category, list] of map) {
    groups.push({
      category,
      label: SMYLR_TOKEN_CATEGORY_LABELS[category] ?? category,
      tokens: list
    })
  }
  return groups
}

export function filterSmylrTokens(query: string): SmylrTokenDefinition[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...SMYLR_TOKEN_DEFINITIONS]
  return SMYLR_TOKEN_DEFINITIONS.filter((token) => {
    const hay = [
      token.label,
      token.cssVariable,
      token.cssProperty,
      token.category,
      token.sourceFile,
      token.valueLight ?? '',
      token.valueDark ?? '',
      token.resolvedValueLight ?? '',
      token.resolvedValueDark ?? '',
      token.styleValue ?? '',
      ...(token.utilities ?? [])
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}
