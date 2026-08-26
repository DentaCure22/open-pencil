import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'

import { bytesToHex } from '#core/bytes/hex'

type KiwiNodeChange = NodeChange & Record<string, unknown>

type PreservedPayloadContext = {
  assetRefToVarGuid?: Map<string, GUID>
  blobIndexByHex?: Map<string, number>
  blobs: Uint8Array[]
}

type MaterializeFigmaPayloadOptions = {
  blobIndexByHex?: Map<string, number>
  includePaintVariables?: boolean
  includeVariableMaps?: boolean
}

type FigmaPayloadVariableMap = {
  entries?: unknown[]
}

type FigmaPayloadVariableMapEntry = {
  variableData?: { dataType?: string; value?: { propRefValue?: unknown } }
}

type ColorVarCarrier = {
  colorVar?: {
    value?: {
      alias?: {
        assetRef?: { key: string; version?: string }
        guid?: GUID
      }
    }
  }
}

const FIGMA_PAYLOAD_VARIABLE_MAP_FIELDS = new Set([
  'variableConsumptionMap',
  'parameterConsumptionMap'
])
const FIGMA_PAYLOAD_PAINT_VARIABLE_FIELDS = new Set(['colorVar', 'opacityVar'])
const SUPPORTED_VARIABLE_DATA_TYPES = new Set([
  'BOOLEAN',
  'FLOAT',
  'STRING',
  'ALIAS',
  'COLOR',
  'SYMBOL_ID',
  'TEXT_DATA',
  'PROP_REF'
])
const SUPPORTED_NORMALIZED_EFFECT_TYPES = new Set([
  'DROP_SHADOW',
  'INNER_SHADOW',
  'LAYER_BLUR',
  'BACKGROUND_BLUR',
  'FOREGROUND_BLUR'
])

/** Explicit serialization wins over stale preserved values for these structural fields. */
const RAW_FIELDS_OVERRIDE_BLOCKLIST = new Set([
  'pageType',
  'derivedSymbolData',
  'derivedSymbolDataLayoutVersion',
  'componentPropAssignments',
  'sourceLibraryKey',
  'variableConsumptionMap',
  'parameterConsumptionMap'
])

function isFigmaPayloadVariableMap(value: unknown): value is FigmaPayloadVariableMap {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'entries' in value
}

function isFigmaPayloadVariableMapEntry(value: unknown): value is FigmaPayloadVariableMapEntry {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isSupportedVariableMapEntry(value: unknown): boolean {
  if (!isFigmaPayloadVariableMapEntry(value)) return false
  const dataType = value.variableData?.dataType
  return (
    (typeof dataType === 'string' && SUPPORTED_VARIABLE_DATA_TYPES.has(dataType)) ||
    !!value.variableData?.value?.propRefValue
  )
}

function isPropRefVariableMapEntry(value: unknown): boolean {
  if (!isFigmaPayloadVariableMapEntry(value)) return false
  return value.variableData?.dataType === 'PROP_REF' || !!value.variableData?.value?.propRefValue
}

function materializeSafeVariableMap(
  value: unknown,
  blobs: Uint8Array[],
  options: MaterializeFigmaPayloadOptions,
  predicate: (value: unknown) => boolean
): unknown {
  if (!isFigmaPayloadVariableMap(value)) return undefined
  const entries = value.entries?.filter(predicate) ?? []
  if (entries.length === 0) return undefined
  return { entries: entries.map((entry) => materializeFigmaPayload(entry, blobs, options)) }
}

function materializeFigmaBlob(
  value: { __openPencilFigmaBlob?: Uint8Array | Record<string, number> },
  blobs: Uint8Array[],
  options: MaterializeFigmaPayloadOptions
): number {
  const blob = value.__openPencilFigmaBlob
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(Object.values(blob ?? {}))
  const key = bytesToHex(bytes)
  const existing = options.blobIndexByHex?.get(key)
  if (existing !== undefined) return existing
  const index = blobs.length
  blobs.push(bytes)
  options.blobIndexByHex?.set(key, index)
  return index
}

function normalizeFigmaPayloadValue(key: string, value: unknown): unknown {
  if (
    (key === 'stackJustify' ||
      key === 'stackPrimaryAlignItems' ||
      key === 'stackCounterAlign' ||
      key === 'stackCounterAlignItems') &&
    value === 'SPACE_EVENLY'
  ) {
    return 'SPACE_BETWEEN'
  }
  return value
}

export function materializeFigmaPayload(
  value: unknown,
  blobs: Uint8Array[],
  options: MaterializeFigmaPayloadOptions = {}
): unknown {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) {
    return value.map((item) => materializeFigmaPayload(item, blobs, options))
  }
  if (!value || typeof value !== 'object') return value
  if ('__openPencilFigmaBlob' in value) {
    return materializeFigmaBlob(
      value as { __openPencilFigmaBlob?: Uint8Array | Record<string, number> },
      blobs,
      options
    )
  }

  const materialized: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (FIGMA_PAYLOAD_PAINT_VARIABLE_FIELDS.has(key) && !options.includePaintVariables) continue
    if (FIGMA_PAYLOAD_VARIABLE_MAP_FIELDS.has(key)) {
      const variableMap = materializeSafeVariableMap(
        child,
        blobs,
        options,
        options.includeVariableMaps ? isSupportedVariableMapEntry : isPropRefVariableMapEntry
      )
      if (variableMap !== undefined) materialized[key] = variableMap
      continue
    }
    materialized[key] = normalizeFigmaPayloadValue(
      key,
      materializeFigmaPayload(child, blobs, options)
    )
  }
  return materialized
}

function convertColorVarAssetRefs<T>(paints: T, assetRefToVarGuid: Map<string, GUID>): T {
  if (!Array.isArray(paints)) return paints
  const result = paints.map((paint: ColorVarCarrier) => {
    const colorVar = paint.colorVar
    const value = colorVar?.value
    const alias = value?.alias
    if (!colorVar || !value || !alias || alias.guid) return paint
    const assetRef = alias.assetRef
    if (!assetRef?.key) return paint
    const lookupKey = assetRef.version ? `${assetRef.key}@${assetRef.version}` : assetRef.key
    const guid = assetRefToVarGuid.get(lookupKey) ?? assetRefToVarGuid.get(assetRef.key)
    if (!guid) return paint
    return {
      ...paint,
      colorVar: {
        ...colorVar,
        value: {
          ...value,
          alias: { guid }
        }
      }
    }
  })
  for (let index = 0; index < paints.length; index++) {
    if (result[index] !== paints[index]) return result as T
  }
  return paints
}

export function applyPreservedFigmaNodeFields(
  context: PreservedPayloadContext,
  node: SceneNode,
  nodeChange: KiwiNodeChange
): void {
  const materialized = materializeFigmaPayload(node.source.fig.rawNodeFields, context.blobs, {
    blobIndexByHex: context.blobIndexByHex,
    includePaintVariables: true,
    includeVariableMaps: true
  }) as Partial<KiwiNodeChange>
  for (const key of Object.keys(materialized) as (keyof KiwiNodeChange)[]) {
    if (RAW_FIELDS_OVERRIDE_BLOCKLIST.has(String(key))) continue
    if ((key === 'fillPaints' || key === 'strokePaints') && node.source.id) {
      const paints = context.assetRefToVarGuid
        ? convertColorVarAssetRefs(materialized[key], context.assetRefToVarGuid)
        : materialized[key]
      nodeChange[key] = paints
      continue
    }
    if (key === 'effects' && node.source.id && context.assetRefToVarGuid) {
      nodeChange[key] = convertColorVarAssetRefs(materialized[key], context.assetRefToVarGuid)
      continue
    }
    if (key === 'derivedTextData' && node.source.id) {
      nodeChange.derivedTextData = materialized.derivedTextData
      continue
    }
    if (key === 'textDecorationFillPaints' && node.source.id) {
      nodeChange.textDecorationFillPaints = materialized.textDecorationFillPaints
      continue
    }
    if (key in nodeChange) continue
    nodeChange[key] = materialized[key]
  }
}

function hasRawGeometryPayload(node: SceneNode): boolean {
  return (
    'fillGeometry' in node.source.fig.rawNodeFields ||
    'strokeGeometry' in node.source.fig.rawNodeFields
  )
}

function hasRawVectorPayload(node: SceneNode): boolean {
  return 'vectorData' in node.source.fig.rawNodeFields
}

export function nodeForExplicitGeometryExport(node: SceneNode): SceneNode {
  if (!hasRawGeometryPayload(node) && !hasRawVectorPayload(node)) return node
  return {
    ...node,
    fillGeometry: hasRawGeometryPayload(node) ? [] : node.fillGeometry,
    strokeGeometry: hasRawGeometryPayload(node) ? [] : node.strokeGeometry,
    vectorNetwork: hasRawVectorPayload(node) ? null : node.vectorNetwork
  }
}

export function hasPreservedUnsupportedEffects(node: SceneNode): boolean {
  const effects = node.source.fig.rawNodeFields.effects
  return (
    Array.isArray(effects) &&
    effects.some(
      (effect) =>
        effect &&
        typeof effect === 'object' &&
        'type' in effect &&
        !SUPPORTED_NORMALIZED_EFFECT_TYPES.has(String(effect.type))
    )
  )
}
