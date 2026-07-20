import type {
  SceneGraph,
  Variable,
  VariableCollection,
  VariableType,
  VariableValue
} from '@open-pencil/scene-graph'
import { computeImageHash } from '@open-pencil/scene-graph/images'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { colorToHex8, parseColor } from '#core/color'

import {
  DTCG_SCHEMA_URL,
  type DtcgDocument,
  type DtcgImportResult,
  OPENPENCIL_TOKEN_EXTENSION,
  OPENPENCIL_TOKEN_FORMAT,
  type TokenSnapshot
} from './types'

type JsonRecord = Record<string, unknown>

interface OpenPencilTokenExtension {
  format: typeof OPENPENCIL_TOKEN_FORMAT
  collections: VariableCollection[]
  variables: Variable[]
  activeMode: Array<[string, string]>
}

interface PendingExternalToken {
  collection: VariableCollection
  variable: Variable
  aliasPath: string | null
  path: string
}

interface ParsedExternalValue {
  type: VariableType
  value: VariableValue
  aliasPath: string | null
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAlias(value: VariableValue): value is { aliasId: string } {
  return isRecord(value) && typeof value.aliasId === 'string'
}

function snapshotFromGraph(graph: SceneGraph): TokenSnapshot {
  return {
    collections: [...graph.variableCollections.values()].map((collection) =>
      structuredClone(collection)
    ),
    variables: [...graph.variables.values()].map((variable) => structuredClone(variable)),
    activeMode: [...graph.activeMode.entries()]
  }
}

function tokenSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^\$+/, '').replace(/[{}]/g, '')
  return normalized || fallback
}

function uniqueSegment(value: string, used: Set<string>, fallback: string): string {
  const base = tokenSegment(value, fallback)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) candidate = `${base} ${suffix++}`
  used.add(candidate)
  return candidate
}

function variablePath(name: string): string[] {
  const segments = name
    .split('/')
    .map((segment) => tokenSegment(segment, 'token'))
    .filter(Boolean)
  return segments.length > 0 ? segments : ['token']
}

function setNestedToken(group: JsonRecord, path: string[], token: JsonRecord): void {
  let current = group
  for (const segment of path.slice(0, -1)) {
    const existing = current[segment]
    if (isRecord(existing) && !Object.hasOwn(existing, '$value')) {
      current = existing
      continue
    }
    const nested: JsonRecord = {}
    current[segment] = nested
    current = nested
  }
  current[path.at(-1) ?? 'token'] = token
}

function dtcgType(type: VariableType): string {
  if (type === 'COLOR') return 'color'
  if (type === 'FLOAT') return 'number'
  return 'string'
}

function variableValueToDtcg(value: VariableValue, aliasPaths: Map<string, string>): unknown {
  if (isAlias(value)) {
    const path = aliasPaths.get(value.aliasId)
    return path ? `{${path}}` : `{${value.aliasId}}`
  }
  if (isRecord(value) && 'r' in value && 'g' in value && 'b' in value && 'a' in value) {
    const color = value as Color
    return {
      colorSpace: 'srgb',
      components: [color.r, color.g, color.b],
      alpha: color.a,
      hex: colorToHex8(color)
    }
  }
  return value
}

function buildAliasPaths(snapshot: TokenSnapshot, collectionNames: Map<string, string>) {
  const paths = new Map<string, string>()
  for (const variable of snapshot.variables) {
    const collectionName = collectionNames.get(variable.collectionId)
    if (!collectionName) continue
    paths.set(variable.id, [collectionName, ...variablePath(variable.name)].join('.'))
  }
  return paths
}

export function exportVariablesToDtcg(graph: SceneGraph): DtcgDocument {
  const snapshot = snapshotFromGraph(graph)
  const usedCollectionNames = new Set<string>()
  const collectionNames = new Map<string, string>()
  for (const collection of snapshot.collections) {
    collectionNames.set(
      collection.id,
      uniqueSegment(collection.name, usedCollectionNames, 'Tokens')
    )
  }
  const aliasPaths = buildAliasPaths(snapshot, collectionNames)
  const tokenDocument: DtcgDocument = {
    $schema: DTCG_SCHEMA_URL,
    $extensions: {
      [OPENPENCIL_TOKEN_EXTENSION]: {
        format: OPENPENCIL_TOKEN_FORMAT,
        collections: snapshot.collections,
        variables: snapshot.variables,
        activeMode: snapshot.activeMode
      } satisfies OpenPencilTokenExtension
    }
  }

  for (const collection of snapshot.collections) {
    const group: JsonRecord = {
      $description: `OpenPencil variable collection with ${collection.modes.length} mode${collection.modes.length === 1 ? '' : 's'}`
    }
    const modeId = graph.activeMode.get(collection.id) ?? collection.defaultModeId
    for (const variableId of collection.variableIds) {
      const variable = graph.variables.get(variableId)
      if (!variable || variable.hiddenFromPublishing) continue
      const value = variable.valuesByMode[modeId]
      const token: JsonRecord = {
        $type: dtcgType(variable.type),
        $value:
          variable.type === 'BOOLEAN' && typeof value === 'boolean'
            ? String(value)
            : variableValueToDtcg(value, aliasPaths)
      }
      if (variable.description) token.$description = variable.description
      token.$extensions = {
        [OPENPENCIL_TOKEN_EXTENSION]: { sourceType: variable.type }
      }
      setNestedToken(group, variablePath(variable.name), token)
    }
    tokenDocument[collectionNames.get(collection.id) ?? collection.name] = group
  }
  return tokenDocument
}

function validCollection(value: unknown): value is VariableCollection {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.modes) &&
    typeof value.defaultModeId === 'string' &&
    Array.isArray(value.variableIds)
  )
}

function validVariable(value: unknown): value is Variable {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.collectionId === 'string' &&
    ['COLOR', 'FLOAT', 'STRING', 'BOOLEAN'].includes(String(value.type)) &&
    isRecord(value.valuesByMode)
  )
}

function exactSnapshot(tokenDocument: JsonRecord): TokenSnapshot | null {
  const extensions = tokenDocument.$extensions
  if (!isRecord(extensions)) return null
  const extension = extensions[OPENPENCIL_TOKEN_EXTENSION]
  if (!isRecord(extension) || extension.format !== OPENPENCIL_TOKEN_FORMAT) return null
  if (!Array.isArray(extension.collections) || !extension.collections.every(validCollection)) {
    return null
  }
  if (!Array.isArray(extension.variables) || !extension.variables.every(validVariable)) return null
  const activeMode = Array.isArray(extension.activeMode)
    ? extension.activeMode.filter(
        (entry): entry is [string, string] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'string'
      )
    : []
  return {
    collections: structuredClone(extension.collections),
    variables: structuredClone(extension.variables),
    activeMode: structuredClone(activeMode)
  }
}

function stableId(seed: string, kind: string): string {
  const hash = computeImageHash(new TextEncoder().encode(seed)).slice(0, 16)
  return `dtcg:${kind}:${hash}`
}

function sourceType(token: JsonRecord, inheritedType: string | null): string | null {
  const extensions = token.$extensions
  const openPencil = isRecord(extensions) ? extensions[OPENPENCIL_TOKEN_EXTENSION] : null
  if (isRecord(openPencil) && typeof openPencil.sourceType === 'string') {
    return openPencil.sourceType
  }
  return typeof token.$type === 'string' ? token.$type : inheritedType
}

function colorValue(value: unknown): VariableValue | null {
  if (typeof value === 'string' && !value.startsWith('{')) return parseColor(value)
  if (!isRecord(value)) return null
  if (Array.isArray(value.components) && value.components.length >= 3) {
    const [r, g, b] = value.components
    if ([r, g, b].every((component) => typeof component === 'number')) {
      return {
        r: r as number,
        g: g as number,
        b: b as number,
        a: typeof value.alpha === 'number' ? value.alpha : 1
      }
    }
  }
  return typeof value.hex === 'string' ? parseColor(value.hex) : null
}

function aliasValue(value: unknown): ParsedExternalValue | null {
  if (typeof value !== 'string') return null
  const alias = value.match(/^\{(.+)}$/)
  return alias ? { type: 'STRING', value: '', aliasPath: alias[1] } : null
}

function typedExternalValue(
  value: unknown,
  type: string,
  warnings: string[],
  path: string
): ParsedExternalValue | null {
  if (type === 'color') {
    const color = colorValue(value)
    return color ? { type: 'COLOR', value: color, aliasPath: null } : null
  }
  if (type === 'dimension' && isRecord(value) && typeof value.value === 'number') {
    const unit = typeof value.unit === 'string' ? value.unit : 'unknown unit'
    warnings.push(path + ': imported the ' + unit + ' dimension as a unitless number')
    return { type: 'FLOAT', value: value.value, aliasPath: null }
  }
  if (type === 'number' && typeof value === 'number') {
    return { type: 'FLOAT', value, aliasPath: null }
  }
  if (type === 'boolean' && (value === true || value === false)) {
    return { type: 'BOOLEAN', value, aliasPath: null }
  }
  if (type === 'boolean' && (value === 'true' || value === 'false')) {
    return { type: 'BOOLEAN', value: value === 'true', aliasPath: null }
  }
  if (type === 'string' && typeof value === 'string') {
    return { type: 'STRING', value, aliasPath: null }
  }
  return null
}

function inferredExternalValue(value: unknown): ParsedExternalValue | null {
  const inferredColor = isRecord(value) ? colorValue(value) : null
  if (inferredColor) return { type: 'COLOR', value: inferredColor, aliasPath: null }
  if (typeof value === 'number') return { type: 'FLOAT', value, aliasPath: null }
  if (typeof value === 'boolean') return { type: 'BOOLEAN', value, aliasPath: null }
  if (typeof value === 'string') return { type: 'STRING', value, aliasPath: null }
  return null
}

function parseExternalValue(
  value: unknown,
  type: string | null,
  warnings: string[],
  path: string
): ParsedExternalValue | null {
  const alias = aliasValue(value)
  if (alias) return alias
  const typed = typedExternalValue(value, type?.toLowerCase() ?? '', warnings, path)
  if (typed) return typed
  const inferred = inferredExternalValue(value)
  if (inferred) return inferred
  warnings.push(path + ': skipped unsupported token type "' + (type ?? 'unknown') + '"')
  return null
}

function walkExternalGroup(
  value: JsonRecord,
  collection: VariableCollection,
  segments: string[],
  inheritedType: string | null,
  pending: PendingExternalToken[],
  warnings: string[],
  sourceSeed: string
): void {
  const groupType = typeof value.$type === 'string' ? value.$type : inheritedType
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('$') || !isRecord(child)) continue
    const pathSegments = [...segments, key]
    const path = [collection.name, ...pathSegments].join('.')
    if (Object.hasOwn(child, '$value')) {
      const parsed = parseExternalValue(child.$value, sourceType(child, groupType), warnings, path)
      if (!parsed) continue
      const id = stableId(`${sourceSeed}:variable:${path}`, 'variable')
      const variable: Variable = {
        id,
        name: pathSegments.join('/'),
        type: parsed.type,
        collectionId: collection.id,
        valuesByMode: { [collection.defaultModeId]: parsed.value },
        description: typeof child.$description === 'string' ? child.$description : '',
        hiddenFromPublishing: false
      }
      collection.variableIds.push(id)
      pending.push({ collection, variable, aliasPath: parsed.aliasPath, path })
      continue
    }
    walkExternalGroup(child, collection, pathSegments, groupType, pending, warnings, sourceSeed)
  }
}

function externalSnapshot(tokenDocument: JsonRecord): DtcgImportResult {
  const warnings: string[] = []
  const pending: PendingExternalToken[] = []
  const sourceSeed = JSON.stringify(tokenDocument)
  const topLevelEntries = Object.entries(tokenDocument).filter(([key]) => !key.startsWith('$'))
  const rootTokens: JsonRecord = {}

  for (const [key, value] of topLevelEntries) {
    if (isRecord(value) && Object.hasOwn(value, '$value')) rootTokens[key] = value
  }
  const groups = topLevelEntries.filter(
    ([, value]) => isRecord(value) && !Object.hasOwn(value, '$value')
  ) as Array<[string, JsonRecord]>
  if (Object.keys(rootTokens).length > 0) groups.unshift(['Tokens', rootTokens])

  for (const [name, group] of groups) {
    const id = stableId(`${sourceSeed}:collection:${name}`, 'collection')
    const modeId = stableId(`${sourceSeed}:collection:${name}:default`, 'mode')
    const collection: VariableCollection = {
      id,
      name,
      modes: [{ modeId, name: 'Default' }],
      defaultModeId: modeId,
      variableIds: []
    }
    walkExternalGroup(group, collection, [], null, pending, warnings, sourceSeed)
  }

  const byPath = new Map(pending.map((entry) => [entry.path, entry.variable]))
  for (const entry of pending) {
    if (!entry.aliasPath) continue
    const target = byPath.get(entry.aliasPath)
    if (!target) {
      warnings.push(`${entry.path}: alias target "${entry.aliasPath}" was not found`)
      continue
    }
    entry.variable.type = target.type
    entry.variable.valuesByMode[entry.collection.defaultModeId] = { aliasId: target.id }
  }

  const collections = [
    ...new Map(pending.map((entry) => [entry.collection.id, entry.collection])).values()
  ]
  return {
    snapshot: {
      collections,
      variables: pending.map((entry) => entry.variable),
      activeMode: collections.map((collection) => [collection.id, collection.defaultModeId])
    },
    warnings
  }
}

export function parseDtcgTokens(input: unknown): DtcgImportResult {
  const tokenDocument = typeof input === 'string' ? JSON.parse(input) : input
  if (!isRecord(tokenDocument)) throw new Error('Design token file must contain a JSON object')
  const exact = exactSnapshot(tokenDocument)
  if (exact) return { snapshot: exact, warnings: [] }
  return externalSnapshot(tokenDocument)
}
