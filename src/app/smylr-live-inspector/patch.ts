import type {
  SmylrLiveContainerNode,
  SmylrLiveContainerPatchIntent,
  SmylrLiveSemanticToken,
  SmylrLiveSemanticTokenCategory,
  SmylrLiveTokenProvenance
} from '../smylr-live-container/types'

export type LiveInspectorStylePatch = Record<string, string>

export type LiveInspectorTokenPatch = Pick<SmylrLiveContainerPatchIntent, 'add' | 'remove'>

export type LiveInspectorPatchDraft = LiveInspectorTokenPatch & {
  nodeId: string
  note?: string
  source?: SmylrLiveContainerNode['source']
  styles?: LiveInspectorStylePatch
}

export type LiveInspectorTokenSuggestion = {
  active: boolean
  reason: string
  token: string
}

export type LiveInspectorSemanticTokenSuggestion = {
  active: boolean
  category: SmylrLiveSemanticTokenCategory
  cssProperty: string
  cssVariable: `--${string}`
  evidence?: SmylrLiveTokenProvenance['evidence']
  label: string
  resolvedValue: string
  sourceFile: string
  styleValue: string
  utility?: string
}

const SPACING_SCALE = new Map([
  ['0px', '0'],
  ['1px', 'px'],
  ['2px', '0.5'],
  ['4px', '1'],
  ['6px', '1.5'],
  ['8px', '2'],
  ['10px', '2.5'],
  ['12px', '3'],
  ['14px', '3.5'],
  ['16px', '4'],
  ['20px', '5'],
  ['24px', '6'],
  ['28px', '7'],
  ['32px', '8'],
  ['36px', '9'],
  ['40px', '10'],
  ['48px', '12'],
  ['56px', '14'],
  ['64px', '16']
])

const TEXT_SIZE_BY_PX = new Map([
  ['12px', 'text-xs'],
  ['14px', 'text-sm'],
  ['16px', 'text-base'],
  ['18px', 'text-lg'],
  ['20px', 'text-xl'],
  ['24px', 'text-2xl']
])

const WEIGHT_BY_VALUE = new Map([
  ['400', 'font-normal'],
  ['500', 'font-medium'],
  ['600', 'font-semibold'],
  ['700', 'font-bold']
])

function cleanToken(value: string) {
  return value.trim()
}

function tokenSetFor(node: SmylrLiveContainerNode | null | undefined) {
  const tokens = new Set<string>()
  ;[node?.className, ...(node?.tokenHints ?? [])].forEach((source) => {
    source
      ?.split(/\s+/)
      .map(cleanToken)
      .filter(Boolean)
      .forEach((token) => tokens.add(token))
  })
  return tokens
}

function normalizePx(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (/^-?\d+(\.\d+)?px$/.test(trimmed)) return trimmed
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}px`
  return undefined
}

function spacingToken(prefix: string, value: string | undefined) {
  const px = normalizePx(value)
  if (!px) return undefined
  const scale = SPACING_SCALE.get(px)
  return scale ? `${prefix}-${scale}` : undefined
}

function radiusToken(value: string | undefined) {
  const px = normalizePx(value)
  if (!px) return undefined
  if (px === '0px') return 'rounded-none'
  if (px === '2px') return 'rounded-sm'
  if (px === '4px') return 'rounded'
  if (px === '6px') return 'rounded-md'
  if (px === '8px') return 'rounded-lg'
  if (px === '12px') return 'rounded-xl'
  if (px === '16px') return 'rounded-2xl'
  return undefined
}

function alignmentToken(prefix: 'items' | 'justify', value: string | undefined) {
  if (!value) return undefined
  const normalized = value.trim()
  if (normalized === 'flex-start') return `${prefix}-start`
  if (normalized === 'flex-end') return `${prefix}-end`
  if (normalized === 'center') return `${prefix}-center`
  if (normalized === 'stretch') return `${prefix}-stretch`
  if (normalized === 'space-between') return `${prefix}-between`
  if (normalized === 'space-around') return `${prefix}-around`
  if (normalized === 'space-evenly') return `${prefix}-evenly`
  return undefined
}

function addSuggestion(
  suggestions: LiveInspectorTokenSuggestion[],
  knownTokens: Set<string>,
  token: string | undefined,
  reason: string
) {
  if (!token || suggestions.some((candidate) => candidate.token === token)) return
  suggestions.push({
    active: knownTokens.has(token),
    reason,
    token
  })
}

function flexDirectionToken(value: string | undefined) {
  if (value === 'column') return 'flex-col'
  if (value === 'row') return 'flex-row'
  return undefined
}

function flexWrapToken(value: string | undefined) {
  if (value === 'wrap') return 'flex-wrap'
  if (value === 'nowrap') return 'flex-nowrap'
  return undefined
}

function shadowToken(value: string | undefined) {
  if (value === 'none') return 'shadow-none'
  return value ? 'shadow-sm' : undefined
}

export function buildLiveInspectorTokenSuggestions(
  node: SmylrLiveContainerNode | null | undefined
) {
  const knownTokens = tokenSetFor(node)
  const styles = node?.computedStyle ?? {}
  const suggestions: LiveInspectorTokenSuggestion[] = []

  Array.from(knownTokens)
    .slice(0, 16)
    .forEach((token) => addSuggestion(suggestions, knownTokens, token, 'current'))

  addSuggestion(suggestions, knownTokens, styles.display, 'display')
  addSuggestion(
    suggestions,
    knownTokens,
    flexDirectionToken(styles['flex-direction']),
    'flex direction'
  )
  addSuggestion(
    suggestions,
    knownTokens,
    flexWrapToken(styles['flex-wrap']),
    'wrap'
  )
  addSuggestion(suggestions, knownTokens, alignmentToken('items', styles['align-items']), 'align')
  addSuggestion(
    suggestions,
    knownTokens,
    alignmentToken('justify', styles['justify-content']),
    'justify'
  )
  addSuggestion(suggestions, knownTokens, spacingToken('gap', styles.gap), 'gap')
  addSuggestion(suggestions, knownTokens, radiusToken(styles['border-radius']), 'radius')
  addSuggestion(
    suggestions,
    knownTokens,
    shadowToken(styles['box-shadow']),
    'shadow'
  )
  addSuggestion(
    suggestions,
    knownTokens,
    TEXT_SIZE_BY_PX.get(normalizePx(styles['font-size']) ?? ''),
    'type size'
  )
  addSuggestion(
    suggestions,
    knownTokens,
    WEIGHT_BY_VALUE.get(styles['font-weight']?.trim() ?? ''),
    'type weight'
  )
  addSuggestion(
    suggestions,
    knownTokens,
    styles.overflow ? `overflow-${styles.overflow.trim()}` : undefined,
    'overflow'
  )

  const padding = Reflect.get(styles, 'padding') as string | undefined
  const paddingValues = padding?.trim().split(/\s+/) ?? []
  if (paddingValues.length === 1) {
    addSuggestion(suggestions, knownTokens, spacingToken('p', paddingValues[0]), 'padding')
  }

  return suggestions.slice(0, 32)
}

export function buildLiveInspectorSemanticTokenSuggestions(
  node: SmylrLiveContainerNode | null | undefined,
  catalog: SmylrLiveSemanticToken[] | null | undefined
) {
  const classTokens = tokenSetFor(node)
  const provenance = node?.tokenProvenance ?? []
  const tokenCountByVariable = new Map<string, number>()
  for (const token of catalog ?? []) {
    tokenCountByVariable.set(
      token.cssVariable,
      (tokenCountByVariable.get(token.cssVariable) ?? 0) + 1
    )
  }

  return (catalog ?? [])
    .map<LiveInspectorSemanticTokenSuggestion>((token) => {
      const exactProvenance = provenance.find((item) => {
        if (item.cssVariable !== token.cssVariable) return false
        if (item.utility) return token.utilities?.includes(item.utility) ?? false
        if (item.styleValue) return item.styleValue === token.styleValue
        return (tokenCountByVariable.get(token.cssVariable) ?? 0) === 1
      })
      const activeUtility = token.utilities?.find((utility) => classTokens.has(utility))
      const utility = exactProvenance?.utility ?? activeUtility ?? token.utilities?.[0]

      return {
        active: Boolean(exactProvenance || activeUtility),
        category: token.category,
        cssProperty: exactProvenance?.cssProperty ?? token.cssProperty,
        cssVariable: token.cssVariable,
        evidence: exactProvenance?.evidence,
        label: token.label,
        resolvedValue: token.resolvedValue,
        sourceFile: token.sourceFile,
        styleValue: token.styleValue ?? `var(${token.cssVariable})`,
        utility
      }
    })
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1
      return left.label.localeCompare(right.label)
    })
}

export function normalizeLiveInspectorStylePatch(styles: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(styles)
      .map(([property, value]) => [property, value?.trim() ?? ''] as const)
      .filter(([, value]) => value.length > 0)
  )
}

export function hasLiveInspectorPatchDraft(draft: LiveInspectorPatchDraft | null | undefined) {
  return Boolean(
    draft &&
    (draft.add.length > 0 ||
      draft.remove.length > 0 ||
      Object.keys(draft.styles ?? {}).length > 0 ||
      draft.note?.trim())
  )
}

export function formatLiveInspectorPatchLines(draft: LiveInspectorPatchDraft | null | undefined) {
  if (!hasLiveInspectorPatchDraft(draft) || !draft) return []

  const lines: string[] = []
  if (draft.add.length) lines.push(`Add tokens: ${draft.add.join(' ')}`)
  if (draft.remove.length) lines.push(`Remove tokens: ${draft.remove.join(' ')}`)
  const styles = normalizeLiveInspectorStylePatch(draft.styles ?? {})
  const styleText = Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
  if (styleText) lines.push(`Preview CSS: ${styleText}`)
  if (draft.note?.trim()) lines.push(`Intent: ${draft.note.trim()}`)
  return lines
}
