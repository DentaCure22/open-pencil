/* eslint-enable open-pencil/no-ts-suppression-comments */
import { transform } from 'sucrase'
/* eslint-disable open-pencil/no-ts-suppression-comments -- Sucrase keeps these runtime declarations in a separate, non-resolvable types tree. */
// @ts-expect-error -- Sucrase publishes parser types separately from its runtime parser path.
import { parse } from 'sucrase/dist/parser/index.js'
// @ts-expect-error -- Sucrase publishes tokenizer types separately from its runtime tokenizer path.
import * as tokenizer from 'sucrase/dist/parser/tokenizer/index.js'
import type { File } from 'sucrase/dist/types/parser/index'
import type {
  IdentifierRole as SucraseIdentifierRole,
  Token
} from 'sucrase/dist/types/parser/tokenizer/index'
import type { Scope } from 'sucrase/dist/types/parser/tokenizer/state'

export const MAX_CODE_OBJECT_SOURCE_LENGTH = 100_000
export const CODE_OBJECT_STATIC_PREFLIGHT_CONTRACT = 'code-object-static-preflight/v1' as const
export const CODE_OBJECT_STATIC_TRANSFORMS = ['typescript', 'jsx', 'imports'] as const

const ALLOWED_CODE_OBJECT_MODULES = new Set([
  '@open-pencil/code-object-ui',
  'd3',
  'react',
  'react/jsx-runtime'
])
const ALLOWED_CODE_OBJECT_MODULES_DESCRIPTION =
  '"@open-pencil/code-object-ui", "d3", "react", and "react/jsx-runtime"'

type BindingRange = {
  endTokenIndex: number
  startTokenIndex: number
}

type BlockedCapability = {
  label: string
  start: number
}

type SucraseTokenizerRuntime = {
  IdentifierRole: Record<'Access' | 'ExportAccess' | 'ObjectShorthand', SucraseIdentifierRole>
  isBlockScopedDeclaration: (token: Token) => boolean
  isFunctionScopedDeclaration: (token: Token) => boolean
  isTopLevelDeclaration: (token: Token) => boolean
}

type SucraseRuntimeFile = Omit<File, 'tokens'> & {
  tokens: Array<Token | undefined>
}

export type CodeObjectStaticPreflight = {
  contract: typeof CODE_OBJECT_STATIC_PREFLIGHT_CONTRACT
  execution: 'not_attempted'
  sourceHash: string
  sourceLength: number
  syntax: 'passed'
  transformedHash: string
  transformedLength: number
  transforms: typeof CODE_OBJECT_STATIC_TRANSFORMS
  transpiler: 'sucrase'
}

const {
  IdentifierRole,
  isBlockScopedDeclaration,
  isFunctionScopedDeclaration,
  isTopLevelDeclaration
} = tokenizer as SucraseTokenizerRuntime

const BLOCKED_AMBIENT_ENTRIES = [
  ['Function', 'Function constructor'],
  ['WebSocket', 'WebSocket'],
  ['Worker', 'Worker'],
  ['XMLHttpRequest', 'XMLHttpRequest'],
  ['document', 'document'],
  ['eval', 'eval'],
  ['fetch', 'fetch'],
  ['globalThis', 'globalThis'],
  ['indexedDB', 'indexedDB'],
  ['localStorage', 'localStorage'],
  ['navigator', 'navigator'],
  ['sessionStorage', 'sessionStorage'],
  ['window', 'window']
] as const

type BlockedAmbientName = (typeof BLOCKED_AMBIENT_ENTRIES)[number][0]

const BLOCKED_AMBIENT_LABELS = new Map<BlockedAmbientName, string>(BLOCKED_AMBIENT_ENTRIES)

const REFERENCE_ROLES = new Set<SucraseIdentifierRole>([
  IdentifierRole.Access,
  IdentifierRole.ExportAccess,
  IdentifierRole.ObjectShorthand
])

function parsedSource(source: string): SucraseRuntimeFile | null {
  try {
    return parse(source, true, true, false) as SucraseRuntimeFile
  } catch {
    return null
  }
}

function tokenName(source: string, token: Token): string {
  return source.slice(token.start, token.end)
}

function blockedName(source: string, token: Token): BlockedAmbientName | null {
  const name = tokenName(source, token)
  return BLOCKED_AMBIENT_LABELS.has(name as BlockedAmbientName)
    ? (name as BlockedAmbientName)
    : null
}

function innermostScope(
  scopes: Scope[],
  tokenIndex: number,
  functionScopeOnly: boolean
): Scope | null {
  let match: Scope | null = null
  for (const scope of scopes) {
    if (
      tokenIndex < scope.startTokenIndex ||
      tokenIndex >= scope.endTokenIndex ||
      (functionScopeOnly && !scope.isFunctionScope)
    ) {
      continue
    }
    if (
      !match ||
      scope.endTokenIndex - scope.startTokenIndex < match.endTokenIndex - match.startTokenIndex
    ) {
      match = scope
    }
  }
  return match
}

function bindingRange(scopes: Scope[], token: Token, tokenIndex: number): BindingRange | null {
  const scope = isTopLevelDeclaration(token)
    ? scopes.find(
        (candidate) => candidate.startTokenIndex === 0 && candidate.endTokenIndex >= tokenIndex + 1
      )
    : innermostScope(scopes, tokenIndex, isFunctionScopedDeclaration(token))
  if (
    !scope ||
    (!isTopLevelDeclaration(token) &&
      !isBlockScopedDeclaration(token) &&
      !isFunctionScopedDeclaration(token))
  ) {
    return null
  }
  return { endTokenIndex: scope.endTokenIndex, startTokenIndex: scope.startTokenIndex }
}

function localBindings(
  source: string,
  file: SucraseRuntimeFile
): Map<BlockedAmbientName, BindingRange[]> {
  const bindings = new Map<BlockedAmbientName, BindingRange[]>()
  file.tokens.forEach((token, tokenIndex) => {
    if (!token || token.isType) return
    const name = blockedName(source, token)
    if (!name) return
    const range = bindingRange(file.scopes, token, tokenIndex)
    if (!range) return
    const ranges = bindings.get(name) ?? []
    ranges.push(range)
    bindings.set(name, ranges)
  })
  return bindings
}

function isLocallyBound(
  bindings: Map<BlockedAmbientName, BindingRange[]>,
  name: BlockedAmbientName,
  tokenIndex: number
): boolean {
  return (
    bindings
      .get(name)
      ?.some((range) => tokenIndex >= range.startTokenIndex && tokenIndex < range.endTokenIndex) ??
    false
  )
}

function blockedCapability(source: string): BlockedCapability | null {
  const file = parsedSource(source)
  if (!file) return null
  const bindings = localBindings(source, file)
  for (let tokenIndex = 0; tokenIndex < file.tokens.length; tokenIndex++) {
    const token = file.tokens[tokenIndex]
    if (!token || token.isType) continue
    const raw = tokenName(source, token)
    if (raw === 'import' && tokenName(source, file.tokens[tokenIndex + 1] ?? token) === '(') {
      return { label: 'dynamic import', start: token.start }
    }
    const name = blockedName(source, token)
    if (
      name &&
      token.identifierRole !== null &&
      REFERENCE_ROLES.has(token.identifierRole) &&
      !isLocallyBound(bindings, name, tokenIndex)
    ) {
      return { label: BLOCKED_AMBIENT_LABELS.get(name) ?? name, start: token.start }
    }
  }
  return null
}

function sourceLocation(source: string, start: number): string {
  const before = source.slice(0, start)
  const lastNewline = before.lastIndexOf('\n')
  const line = before.split('\n').length
  const column = start - lastNewline
  return `${line}:${column}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error)
}

function quotedValue(value: string): string | null {
  const quote = value[0]
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return null
  return value.slice(1, -1)
}

function requiredModules(transformed: string): string[] {
  const file = parsedSource(transformed)
  if (!file) throw new Error('Code Object transformed output could not be parsed.')
  const modules: string[] = []
  for (let index = 0; index < file.tokens.length - 2; index++) {
    const token = file.tokens[index]
    const open = file.tokens[index + 1]
    const specifier = file.tokens[index + 2]
    if (
      !token ||
      !open ||
      !specifier ||
      tokenName(transformed, token) !== 'require' ||
      tokenName(transformed, open) !== '('
    ) {
      continue
    }
    const moduleId = quotedValue(tokenName(transformed, specifier))
    if (moduleId) modules.push(moduleId)
  }
  return modules
}

function importedModules(source: string): string[] {
  const file = parsedSource(source)
  if (!file) return []
  const modules: string[] = []
  for (let index = 0; index < file.tokens.length - 1; index++) {
    const token = file.tokens[index]
    const next = file.tokens[index + 1]
    if (!token || !next) continue
    const raw = tokenName(source, token)
    if (raw !== 'import' && raw !== 'from') continue
    const moduleId = quotedValue(tokenName(source, next))
    if (moduleId) modules.push(moduleId)
  }
  return modules
}

function isSyntacticClassComponent(
  file: SucraseRuntimeFile,
  source: string,
  classIndex: number
): boolean {
  for (let cursor = classIndex + 1; cursor < file.tokens.length; cursor++) {
    const token = file.tokens[cursor]
    if (!token) return false
    const raw = tokenName(source, token)
    if (raw === '{') return false
    if (raw !== 'extends') continue
    const base = file.tokens[cursor + 1]
    if (!base) return false
    const baseName = tokenName(source, base)
    if (baseName === 'Component' || baseName === 'PureComponent') return true
    const separator = file.tokens[cursor + 2]
    const member = file.tokens[cursor + 3]
    return Boolean(
      baseName === 'React' &&
      separator &&
      tokenName(source, separator) === '.' &&
      member &&
      (tokenName(source, member) === 'Component' || tokenName(source, member) === 'PureComponent')
    )
  }
  return false
}

function hasSyntacticDefaultComponent(source: string): boolean {
  const file = parsedSource(source)
  if (!file) return false
  return file.tokens.some((token, index) => {
    if (!token) return false
    const next = file.tokens[index + 1]
    if (tokenName(source, token) !== 'export' || !next || tokenName(source, next) !== 'default') {
      return false
    }
    const candidate = file.tokens[index + 2]
    if (!candidate) return false
    const candidateName = tokenName(source, candidate)
    if (candidateName === 'function') return true
    if (candidateName === 'class') {
      return isSyntacticClassComponent(file, source, index + 2)
    }
    const following = file.tokens[index + 3]
    if (candidateName !== '(') {
      return Boolean(following && tokenName(source, following) === '=>')
    }
    let depth = 0
    for (let cursor = index + 2; cursor < file.tokens.length; cursor++) {
      const current = file.tokens[cursor]
      if (!current) return false
      const currentName = tokenName(source, current)
      if (currentName === '(') depth += 1
      if (currentName !== ')') continue
      depth -= 1
      if (depth !== 0) continue
      const afterParameters = file.tokens[cursor + 1]
      return Boolean(afterParameters && tokenName(source, afterParameters) === '=>')
    }
    return false
  })
}

export function assertSafeCodeObjectSource(source: string): void {
  const blocked = blockedCapability(source)
  if (!blocked) return
  throw new Error(
    `Code Object source uses blocked ambient capability "${blocked.label}" at ${sourceLocation(source, blocked.start)}. Guarded authoring permits trusted local Code Object rendering only.`
  )
}

export function assertAllowedCodeObjectImports(source: string): void {
  const unsupported = importedModules(source).find(
    (moduleId) => !ALLOWED_CODE_OBJECT_MODULES.has(moduleId)
  )
  if (!unsupported) return
  throw new Error(
    `Code Object source imports unsupported module "${unsupported}". Only ${ALLOWED_CODE_OBJECT_MODULES_DESCRIPTION} are allowed.`
  )
}

export async function codeObjectSourceHash(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return `sha256:${hex}`
}

export async function preflightCodeObjectSource(
  source: string
): Promise<CodeObjectStaticPreflight> {
  if (!source.trim()) throw new Error('Code Object source is required.')
  if (source.length > MAX_CODE_OBJECT_SOURCE_LENGTH) {
    throw new Error(
      `Code Object source must contain at most ${MAX_CODE_OBJECT_SOURCE_LENGTH} characters.`
    )
  }
  assertSafeCodeObjectSource(source)
  assertAllowedCodeObjectImports(source)
  let transformed: string
  try {
    transformed = transform(source, {
      production: true,
      transforms: [...CODE_OBJECT_STATIC_TRANSFORMS]
    }).code
  } catch (error) {
    throw new Error(`Code Object source failed static TSX preflight: ${errorMessage(error)}`)
  }
  if (!hasSyntacticDefaultComponent(source)) {
    throw new Error(
      'Code Object source must directly default-export a function, class, or arrow component.'
    )
  }
  const unsupportedRuntimeModule = requiredModules(transformed).find(
    (moduleId) => !ALLOWED_CODE_OBJECT_MODULES.has(moduleId)
  )
  if (unsupportedRuntimeModule) {
    throw new Error(
      `Code Object source imports unsupported module "${unsupportedRuntimeModule}". Only ${ALLOWED_CODE_OBJECT_MODULES_DESCRIPTION} are allowed.`
    )
  }
  const [sourceHash, transformedHash] = await Promise.all([
    codeObjectSourceHash(source),
    codeObjectSourceHash(transformed)
  ])
  return {
    contract: CODE_OBJECT_STATIC_PREFLIGHT_CONTRACT,
    execution: 'not_attempted',
    sourceHash,
    sourceLength: source.length,
    syntax: 'passed',
    transformedHash,
    transformedLength: transformed.length,
    transforms: CODE_OBJECT_STATIC_TRANSFORMS,
    transpiler: 'sucrase'
  }
}
