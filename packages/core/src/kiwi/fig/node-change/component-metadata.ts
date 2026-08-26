import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type {
  ComponentPropertyDefinition,
  ComponentPropertyType,
  SceneNode,
  SymbolLink,
  VariantPropSpec
} from '@open-pencil/scene-graph'
import type { GUID } from '@open-pencil/scene-graph/primitives'
import { parseVariantName } from '@open-pencil/scene-graph/variant-name'

const COMPONENT_PROP_TYPE_MAP: Record<string, ComponentPropertyType> = {
  VARIANT: 'VARIANT',
  TEXT: 'TEXT',
  BOOL: 'BOOLEAN',
  BOOLEAN: 'BOOLEAN',
  INSTANCE_SWAP: 'INSTANCE_SWAP'
}

type ComponentProps = Pick<
  SceneNode,
  | 'componentId'
  | 'componentKey'
  | 'componentPropertyDefinitions'
  | 'componentPropertyValues'
  | 'sourceLibraryKey'
  | 'publishId'
  | 'overrideKey'
  | 'sharedSymbolVersion'
  | 'publishedVersion'
  | 'isPublishable'
  | 'isSymbolPublishable'
  | 'symbolDescription'
  | 'symbolLinks'
  | 'variantPropSpecs'
>

type RawComponentPropDef = {
  id?: GUID
  name?: string
  type?: string
  initialValue?: unknown
}

function componentPropValueToString(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const propValue = value as {
    boolValue?: boolean
    textValue?: string | { characters?: string }
    guidValue?: GUID
  }
  if (typeof propValue.boolValue === 'boolean') return String(propValue.boolValue)
  if (typeof propValue.textValue === 'string') return propValue.textValue
  if (propValue.textValue && typeof propValue.textValue === 'object') {
    return propValue.textValue.characters ?? ''
  }
  return propValue.guidValue ? guidToString(propValue.guidValue) : ''
}

function extractComponentPropertyDefs(nc: NodeChange): ComponentPropertyDefinition[] {
  const defs = nc.componentPropDefs as RawComponentPropDef[] | undefined
  if (!defs?.length) return []
  const result: ComponentPropertyDefinition[] = []
  for (const def of defs) {
    if (!def.id || !def.name) continue
    const propType = COMPONENT_PROP_TYPE_MAP[def.type ?? ''] ?? 'VARIANT'
    result.push({
      id: guidToString(def.id),
      name: def.name,
      type: propType,
      defaultValue: componentPropValueToString(def.initialValue),
      variantOptions: propType === 'VARIANT' ? undefined : undefined
    })
  }
  return result
}

function extractVariantPropSpecs(nc: NodeChange): VariantPropSpec[] {
  const specs = nc.variantPropSpecs as Array<{ propDefId?: GUID; value?: string }> | undefined
  if (!specs?.length) return []
  return specs
    .filter((spec): spec is { propDefId: GUID; value?: string } => !!spec.propDefId)
    .map((spec) => ({ propDefId: guidToString(spec.propDefId), value: spec.value ?? '' }))
}

function extractComponentPropertyValues(nc: NodeChange): Record<string, string> {
  const specs = extractVariantPropSpecs(nc)
  const defs = new Map(extractComponentPropertyDefs(nc).map((def) => [def.id, def.name]))
  if (specs.length > 0 && defs.size > 0) {
    const values: Record<string, string> = {}
    for (const spec of specs) values[defs.get(spec.propDefId) ?? spec.propDefId] = spec.value
    return values
  }

  const name = nc.name
  if (!name?.includes('=')) return {}
  return parseVariantName(name)
}

function guidToStringOrNull(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const guid = value as Partial<GUID>
  if (typeof guid.sessionID !== 'number' || typeof guid.localID !== 'number') return null
  return guidToString({ sessionID: guid.sessionID, localID: guid.localID })
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function booleanOrFalse(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false
}

function extractSymbolId(nc: NodeChange): string {
  const symbolData = nc.symbolData as { symbolID?: GUID } | undefined
  return symbolData?.symbolID ? guidToString(symbolData.symbolID) : ''
}

export function extractComponentProps(nc: NodeChange): ComponentProps {
  const symbolLinks = (nc.symbolLinks as Array<Partial<SymbolLink>> | undefined) ?? []
  return {
    componentId: extractSymbolId(nc),
    componentKey: stringOrNull(nc.componentKey),
    componentPropertyDefinitions: extractComponentPropertyDefs(nc),
    componentPropertyValues: extractComponentPropertyValues(nc),
    sourceLibraryKey: stringOrNull(nc.sourceLibraryKey),
    publishId: guidToStringOrNull(nc.publishID),
    overrideKey: guidToStringOrNull(nc.overrideKey),
    sharedSymbolVersion: stringOrNull(nc.sharedSymbolVersion),
    publishedVersion: stringOrNull(nc.publishedVersion),
    isPublishable: booleanOrFalse(nc.isPublishable),
    isSymbolPublishable: booleanOrFalse(nc.isSymbolPublishable),
    symbolDescription: stringOrEmpty(nc.symbolDescription),
    symbolLinks: symbolLinks
      .filter((link): link is SymbolLink => typeof link.uri === 'string')
      .map((link) => ({
        uri: link.uri,
        displayName: link.displayName,
        displayText: link.displayText
      })),
    variantPropSpecs: extractVariantPropSpecs(nc)
  }
}

export function isComponentSet(nc: NodeChange): boolean {
  const defs = nc.componentPropDefs as Array<{ type?: string }> | undefined
  return defs?.some((definition) => definition.type === 'VARIANT') ?? false
}
