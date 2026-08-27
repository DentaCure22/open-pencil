export interface ReactStylePatchRequest {
  sourceId: string
  property: string
  value: string | number | boolean | null
}

export interface ReactStylePatchResult {
  changed: boolean
  code: string
  start: number
  end: number
  replacement: string
  message: string
}

interface ParsedStyleProperty {
  key: string
  start: number
  end: number
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function styleValue(value: ReactStylePatchRequest['value']): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function explicitSourceAnchor(source: string, sourceId: string): number {
  const escaped = escapeRegExp(sourceId)
  const pattern = new RegExp(
    `(?:data-open-pencil-source-id|id)\\s*=\\s*(?:"${escaped}"|'${escaped}')`,
    'g'
  )
  const matches = [...source.matchAll(pattern)]
  const match = matches.length === 1 ? matches.at(0) : undefined
  if (!match) {
    throw new TypeError(
      `Safe React patching requires exactly one explicit source ID "${sourceId}" in JSX`
    )
  }
  return Number(match.index)
}

function openingTagRange(source: string, anchorIndex: number): { start: number; end: number } {
  const start = source.lastIndexOf('<', anchorIndex)
  if (start === -1) throw new TypeError('Could not resolve the JSX opening tag')
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let braceDepth = 0
  let end = -1
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote) {
      if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      continue
    }
    if (character === '{') braceDepth += 1
    else if (character === '}') braceDepth = Math.max(0, braceDepth - 1)
    else if (character === '>' && braceDepth === 0) {
      end = index
      break
    }
  }
  if (end === -1) throw new TypeError('Could not resolve the JSX opening tag')
  const opening = source.slice(start, end + 1)
  if (opening.startsWith('</')) throw new TypeError('Source ID resolved to a closing JSX tag')
  return { start, end: end + 1 }
}

function parsedStyleProperties(body: string): ParsedStyleProperty[] {
  const valuePattern = `(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[-+]?\\d+(?:\\.\\d+)?|true|false|null)`
  const propertyPattern = new RegExp(
    `(?:^|,)\\s*((?:[A-Za-z_$][\\w$-]*|"[^"]+"|'[^']+'))\\s*:\\s*${valuePattern}\\s*`,
    'g'
  )
  const properties: ParsedStyleProperty[] = []
  let covered = ''
  for (const match of body.matchAll(propertyPattern)) {
    const rawKey = match.at(1)
    if (!rawKey) continue
    const key = rawKey.replace(/^['"]|['"]$/g, '')
    const separatorLength = match[0].startsWith(',') ? 1 : 0
    const start = match.index + separatorLength
    properties.push({ key, start, end: match.index + match[0].length })
    covered += match[0]
  }
  const normalizedBody = body.replace(/\s/g, '')
  const normalizedCovered = covered.replace(/\s/g, '')
  if (normalizedBody && normalizedBody !== normalizedCovered) {
    throw new TypeError(
      'Safe React patching only supports flat inline style objects with literal values'
    )
  }
  return properties
}

/**
 * Produce one exact, reviewable inline-style source edit for an explicitly identified JSX node.
 * Dynamic styles, spreads, duplicate IDs, and computed values are rejected without changing code.
 */
export function patchReactInlineStyle(
  source: string,
  request: ReactStylePatchRequest
): ReactStylePatchResult {
  if (!/^[A-Za-z_$][\w$-]*$/.test(request.property)) {
    throw new TypeError(`Invalid React style property "${request.property}"`)
  }
  const anchorIndex = explicitSourceAnchor(source, request.sourceId)
  const range = openingTagRange(source, anchorIndex)
  const opening = source.slice(range.start, range.end)
  const styleMatch = /style\s*=\s*\{\s*\{([\s\S]*?)\}\s*\}/.exec(opening)
  const serializedValue = styleValue(request.value)

  if (!styleMatch) {
    const insertion = opening.endsWith('/>') ? range.end - 2 : range.end - 1
    const replacement = ` style={{ ${request.property}: ${serializedValue} }}`
    return {
      changed: true,
      code: `${source.slice(0, insertion)}${replacement}${source.slice(insertion)}`,
      start: insertion,
      end: insertion,
      replacement,
      message: `Added ${request.property} to ${request.sourceId}`
    }
  }

  const body = styleMatch.at(1) ?? ''
  const bodyStart = range.start + styleMatch.index + styleMatch[0].indexOf(body)
  const properties = parsedStyleProperties(body)
  const existing = properties.find((property) => property.key === request.property)
  const entries = properties.map((property) => {
    if (property !== existing)
      return body.slice(property.start, property.end).trim().replace(/^,/, '')
    return `${request.property}: ${serializedValue}`
  })
  if (!existing) entries.push(`${request.property}: ${serializedValue}`)
  const replacement = entries.join(', ')
  const code = `${source.slice(0, bodyStart)}${replacement}${source.slice(bodyStart + body.length)}`
  return {
    changed: replacement !== body,
    code,
    start: bodyStart,
    end: bodyStart + body.length,
    replacement,
    message: `${existing ? 'Updated' : 'Added'} ${request.property} on ${request.sourceId}`
  }
}
