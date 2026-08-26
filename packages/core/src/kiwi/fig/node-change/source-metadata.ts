import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { guidToString } from '@open-pencil/kiwi/fig/guid'
import type { SceneNode } from '@open-pencil/scene-graph'

type RawSymbolData = {
  symbolOverrides?: unknown[]
  uniformScaleFactor?: number
}

type PreservedFigmaBlob = {
  __openPencilFigmaBlob: Uint8Array
}

function preserveFigmaPayloadBlobs(value: unknown, blobs: Uint8Array[]): unknown {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map((item) => preserveFigmaPayloadBlobs(item, blobs))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'commandsBlob' || key === 'vectorNetworkBlob') && typeof child === 'number') {
      const blob: unknown = blobs[child]
      result[key] =
        blob == null
          ? child
          : ({
              __openPencilFigmaBlob:
                blob instanceof Uint8Array
                  ? blob
                  : new Uint8Array(Object.values(blob as Record<string, number>))
            } satisfies PreservedFigmaBlob)
    } else {
      result[key] = preserveFigmaPayloadBlobs(child, blobs)
    }
  }
  return result
}

export const FIGMA_RAW_NODE_FIELD_KEYS = [
  'styleIdForFill',
  'styleIdForStrokeFill',
  'styleIdForText',
  'styleIdForEffect',
  'styleIdForGrid',
  'backgroundPaints',
  'layoutGrids',
  'exportSettings',
  'componentPropDefs',
  'componentPropRefs',
  'variantPropSpecs',
  'stateGroupPropertyValueOrders',
  'isStateGroup',
  'version',
  'sourceLibraryKey',
  'userFacingVersion',
  'description',
  'key',
  'sortPosition',
  'detachedSymbolId',
  'documentColorProfile',
  'variableConsumptionMap',
  'variableModeBySetMap',
  'parameterConsumptionMap',
  'editInfo',
  'backgroundColor',
  'pageType',
  'isPageDivider',
  'guides',
  'handoffStatusMap',
  'annotationCategories',
  'miterLimit',
  'mask',
  'maskType',
  'maskIsOutline',
  'strokeWeight',
  'strokeJoin',
  'borderStrokeWeightsIndependent',
  'borderTopWeight',
  'borderRightWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'minSize',
  'maxSize',
  'targetAspectRatio',
  'gridRows',
  'gridColumns',
  'gridRowAnchor',
  'gridColumnAnchor',
  'gridColumnsSizing',
  'gridRowsSizing',
  'gridChildVerticalAlign',
  'gridChildHorizontalAlign',
  'textAutoResize',
  'textData',
  'lineHeight',
  'fontName',
  'fontSize',
  'letterSpacing',
  'textTracking',
  'fontVersion',
  'textUserLayoutVersion',
  'textExplicitLayoutVersion',
  'fontVariations',
  'fontVariantCommonLigatures',
  'fontVariantContextualLigatures',
  'toggledOnOTFeatures',
  'toggledOffOTFeatures',
  'leadingTrim',
  'textDecorationFillPaints',
  'textUnderlineOffset',
  'textDecorationThickness',
  'textDecorationStyle',
  'semanticWeight',
  'semanticItalic',
  'maxLines',
  'textPathStart',
  'derivedTextData',
  'fillPaints',
  'strokePaints',
  'effects',
  'sectionStatusInfo',
  'prototypeStartNodeID',
  'prototypeInteractions',
  'transitionInfo',
  'codeSyntax',
  'lockMode',
  'slideThemeMap',
  'isSoftDeleted',
  'brushType',
  'scatterStrokeSettings',
  'vectorOperationVersion',
  'vectorData',
  'fillGeometry',
  'strokeGeometry'
] as const satisfies readonly (keyof NodeChange)[]

function extractFigmaRawGeometry(
  nc: NodeChange,
  blobs: Uint8Array[]
): Pick<SceneNode['source']['fig'], 'rawSize' | 'rawTransform' | 'rawNodeFields'> {
  const rawNodeFields: Record<string, unknown> = {}
  for (const key of FIGMA_RAW_NODE_FIELD_KEYS) {
    const value = nc[key]
    if (value !== undefined) rawNodeFields[key] = preserveFigmaPayloadBlobs(value, blobs)
  }
  return {
    rawSize: nc.size ? { ...nc.size } : null,
    rawTransform: nc.transform ? { ...nc.transform } : null,
    rawNodeFields
  }
}

function extractFigmaSymbolMetadata(
  nc: NodeChange,
  blobs: Uint8Array[]
): Pick<
  SceneNode['source']['fig'],
  | 'symbolOverrides'
  | 'componentPropAssignments'
  | 'derivedSymbolData'
  | 'derivedSymbolDataLayoutVersion'
  | 'uniformScaleFactor'
> {
  const symbolData = nc.symbolData as RawSymbolData | undefined
  return {
    symbolOverrides: preserveFigmaPayloadBlobs(
      symbolData?.symbolOverrides ?? [],
      blobs
    ) as unknown[],
    componentPropAssignments: preserveFigmaPayloadBlobs(
      nc.componentPropAssignments ?? [],
      blobs
    ) as unknown[],
    derivedSymbolData: preserveFigmaPayloadBlobs(nc.derivedSymbolData ?? [], blobs) as unknown[],
    derivedSymbolDataLayoutVersion:
      typeof nc.derivedSymbolDataLayoutVersion === 'number'
        ? nc.derivedSymbolDataLayoutVersion
        : null,
    uniformScaleFactor:
      typeof symbolData?.uniformScaleFactor === 'number' ? symbolData.uniformScaleFactor : null
  }
}

function extractFigmaLayoutMetadata(nc: NodeChange): SceneNode['source']['fig']['layout'] {
  return {
    stackMode: nc.stackMode,
    stackSpacing: nc.stackSpacing,
    stackPadding: nc.stackPadding,
    stackPaddingRight: nc.stackPaddingRight,
    stackPaddingBottom: nc.stackPaddingBottom,
    stackCounterAlign: nc.stackCounterAlign,
    stackJustify: nc.stackJustify,
    stackCounterAlignItems: nc.stackCounterAlignItems,
    stackPrimaryAlignItems: nc.stackPrimaryAlignItems,
    stackPrimarySizing: nc.stackPrimarySizing,
    stackCounterSizing: nc.stackCounterSizing,
    stackVerticalPadding: nc.stackVerticalPadding,
    stackHorizontalPadding: nc.stackHorizontalPadding,
    stackWrap: nc.stackWrap,
    stackPositioning: nc.stackPositioning,
    stackChildPrimaryGrow: nc.stackChildPrimaryGrow,
    stackChildAlignSelf: nc.stackChildAlignSelf,
    stackCounterSpacing: nc.stackCounterSpacing,
    bordersTakeSpace: nc.bordersTakeSpace as boolean | undefined,
    stackReverseZIndex: nc.stackReverseZIndex as boolean | undefined
  }
}

export function extractFigmaSourceMetadata(
  nc: NodeChange,
  blobs: Uint8Array[]
): SceneNode['source'] {
  return {
    format: 'fig',
    id: nc.guid ? guidToString(nc.guid) : null,
    orderKey: nc.parentIndex?.position ?? null,
    fig: {
      ...extractFigmaRawGeometry(nc, blobs),
      ...extractFigmaSymbolMetadata(nc, blobs),
      layout: extractFigmaLayoutMetadata(nc)
    }
  }
}
