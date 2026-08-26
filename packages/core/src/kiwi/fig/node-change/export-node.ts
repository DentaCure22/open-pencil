import type { NodeChange, Paint } from '@open-pencil/kiwi/fig/codec'
import { stringToGuid } from '@open-pencil/kiwi/fig/guid'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Color, GUID, Matrix, Vector } from '@open-pencil/scene-graph/primitives'

import {
  applyExportSettingsPluginData,
  mergePluginData,
  NODE_TYPE_PLUGIN_KEY,
  serializePluginRelaunchData,
  upsertPluginData
} from './plugin-data'
import {
  applyPreservedFigmaNodeFields,
  hasPreservedUnsupportedEffects,
  materializeFigmaPayload,
  nodeForExplicitGeometryExport
} from './preserved-payload'

export type KiwiNodeChange = NodeChange & Record<string, unknown>

type KiwiBooleanOperation = NonNullable<NodeChange['booleanOperation']>

function toKiwiBooleanOperation(operation: SceneNode['booleanOperation']): KiwiBooleanOperation {
  return operation === 'EXCLUDE' ? 'XOR' : (operation ?? 'UNION')
}

/**
 * Build a mapping from assetRef key strings ("key@version" or "key") to
 * variable GUIDs. This is used to convert colorVar.assetRef references in raw
 * paint data to guid references that resolveAliasId can resolve on reimport.
 */
export function buildAssetRefToVarGuidMap(
  graph: SceneGraph,
  varIdToGuid: Map<string, GUID>
): Map<string, GUID> {
  const map = new Map<string, GUID>()
  for (const [varId, variable] of graph.variables) {
    if (!variable.key) continue
    const guid = varIdToGuid.get(varId) ?? stringToGuid(varId)
    map.set(variable.key, guid)
    if (variable.version) {
      map.set(`${variable.key}@${variable.version}`, guid)
    }
  }
  return map
}

interface SceneNodeToKiwiContext {
  graph: SceneGraph
  blobs: Uint8Array[]
  blobIndexByHex?: Map<string, number>
  nodeIdToGuid?: Map<string, GUID>
  /** Reverse index of assigned GUID values ("sessionID:localID") for O(1)
   *  collision detection. Populated alongside every nodeIdToGuid.set() call. */
  assignedGuidValues?: Set<string>
  fontDigestMap?: Map<string, Uint8Array>
  glyphBlobMap?: Map<string, number>
  varIdToGuid?: Map<string, GUID>
  /** Maps "key@version" or "key" (from variable.key/version) → variable GUID.
   * Used to convert colorVar.assetRef references in raw paints to guid references. */
  assetRefToVarGuid?: Map<string, GUID>
  fractionalPosition: (index: number) => string
  mapToFigmaType: (type: SceneNode['type']) => string
  fillToKiwiPaint: (fill: SceneNode['fills'][number]) => Paint
  safeColor: (color: Color) => Color
  computeExportTransform: (node: SceneNode) => Matrix
  serializeCornerRadii: (node: SceneNode, nc: KiwiNodeChange) => void
  serializeTextProps: (
    node: SceneNode,
    nc: KiwiNodeChange,
    graph: SceneGraph,
    fontDigestMap: Map<string, Uint8Array> | undefined,
    blobs: Uint8Array[],
    glyphBlobMap: Map<string, number> | undefined
  ) => void
  serializeLayoutProps: (node: SceneNode, nc: KiwiNodeChange) => void
  serializeGeometry: (node: SceneNode, nc: KiwiNodeChange, blobs: Uint8Array[]) => void
  serializeVariableBindings: (
    node: SceneNode,
    nc: KiwiNodeChange,
    graph: SceneGraph,
    varIdToGuid?: Map<string, GUID>
  ) => void
  sceneNodeToKiwi: (
    node: SceneNode,
    parentGuid: GUID,
    childIndex: number,
    localIdCounter: { value: number },
    context: SceneNodeToKiwiContext
  ) => KiwiNodeChange[]
}

function applyColorVariableBinding(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  paint: Paint,
  field: string
): Paint {
  const variableId = node.boundVariables[field]
  if (!variableId) return paint
  return {
    ...paint,
    colorVariableBinding: {
      variableID: context.varIdToGuid?.get(variableId) ?? stringToGuid(variableId)
    }
  }
}

function createStrokePaints(context: SceneNodeToKiwiContext, node: SceneNode): Paint[] {
  return node.strokes.map((stroke, index) => {
    const paint = stroke.paint
      ? context.fillToKiwiPaint({
          ...stroke.paint,
          opacity: stroke.paint.opacity * stroke.opacity,
          visible: stroke.paint.visible && stroke.visible
        })
      : {
          type: 'SOLID' as const,
          color: context.safeColor(stroke.color),
          opacity: stroke.opacity,
          visible: stroke.visible,
          blendMode: 'NORMAL' as const
        }
    return applyColorVariableBinding(context, node, paint, `strokes/${index}/color`)
  })
}

function componentPropertyValue(value: string) {
  return { textValue: { characters: value } }
}

function componentPropertyTypeForKiwi(type: string) {
  if (type === 'BOOLEAN') return 'BOOL'
  if (type === 'VARIANT') return 'TEXT'
  return type
}

function parseGuidOrNull(value: string) {
  return /^\d+:\d+$/.test(value) ? stringToGuid(value) : null
}

function resolveInstanceComponentId(context: SceneNodeToKiwiContext, componentId: string): string {
  const seen = new Set<string>()
  let currentId = componentId
  while (!seen.has(currentId)) {
    seen.add(currentId)
    const node = context.graph.getNode(currentId)
    if (node?.type !== 'INSTANCE' || !node.componentId) return currentId
    currentId = node.componentId
  }
  return componentId
}

function getOrCreateNodeGuid(
  context: SceneNodeToKiwiContext,
  nodeId: string,
  localIdCounter: { value: number }
): GUID | undefined {
  const node = context.graph.getNode(nodeId)
  if (!node) return undefined
  const existing = context.nodeIdToGuid?.get(nodeId)
  if (existing) return existing
  const importedGuid = node.source.id ? parseGuidOrNull(node.source.id) : null

  // When source.id maps to a GUID value that is already assigned to a
  // different node (e.g. two nodes from different canvases with the same
  // source.id "1:94"), fall back to the counter to avoid collisions.
  if (importedGuid && context.assignedGuidValues) {
    const key = `${importedGuid.sessionID}:${importedGuid.localID}`
    if (context.assignedGuidValues.has(key)) {
      const guid: GUID = { sessionID: 1, localID: localIdCounter.value++ }
      context.nodeIdToGuid?.set(nodeId, guid)
      context.assignedGuidValues.add(`${guid.sessionID}:${guid.localID}`)
      return guid
    }
  }

  const guid = importedGuid ?? { sessionID: 1, localID: localIdCounter.value++ }
  context.nodeIdToGuid?.set(nodeId, guid)
  context.assignedGuidValues?.add(`${guid.sessionID}:${guid.localID}`)
  return guid
}

function applyInstancePayload(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange,
  localIdCounter: { value: number }
): void {
  if (node.type !== 'INSTANCE' || !node.componentId) return
  const symbolID = getOrCreateNodeGuid(
    context,
    resolveInstanceComponentId(context, node.componentId),
    localIdCounter
  )
  if (symbolID) {
    const symbolData: Record<string, unknown> = { symbolID }
    if (node.source.fig.symbolOverrides.length > 0) {
      symbolData.symbolOverrides = materializeFigmaPayload(
        node.source.fig.symbolOverrides,
        context.blobs,
        {
          blobIndexByHex: context.blobIndexByHex,
          includePaintVariables: true,
          includeVariableMaps: true
        }
      )
    }
    if (node.source.fig.uniformScaleFactor != null) {
      symbolData.uniformScaleFactor = node.source.fig.uniformScaleFactor
    }
    nc.symbolData = symbolData as KiwiNodeChange['symbolData']
  }
  if (node.source.fig.componentPropAssignments.length > 0) {
    nc.componentPropAssignments = materializeFigmaPayload(
      node.source.fig.componentPropAssignments,
      context.blobs,
      {
        blobIndexByHex: context.blobIndexByHex,
        includePaintVariables: true,
        includeVariableMaps: true
      }
    )
  }
  if (node.source.fig.derivedSymbolData.length > 0) {
    nc.derivedSymbolData = materializeFigmaPayload(
      node.source.fig.derivedSymbolData,
      context.blobs,
      {
        blobIndexByHex: context.blobIndexByHex,
        includePaintVariables: true,
        includeVariableMaps: true
      }
    )
  }
  if (node.source.fig.derivedSymbolDataLayoutVersion != null) {
    nc.derivedSymbolDataLayoutVersion = node.source.fig.derivedSymbolDataLayoutVersion
  }
}

function applyComponentMetadata(node: SceneNode, nc: KiwiNodeChange): void {
  if (node.componentKey) nc.componentKey = node.componentKey
  if (node.sourceLibraryKey) nc.sourceLibraryKey = node.sourceLibraryKey
  const publishId = node.publishId ? parseGuidOrNull(node.publishId) : null
  const overrideKey = node.overrideKey ? parseGuidOrNull(node.overrideKey) : null
  if (publishId) nc.publishID = publishId
  if (overrideKey) nc.overrideKey = overrideKey
  if (node.sharedSymbolVersion) nc.sharedSymbolVersion = node.sharedSymbolVersion
  if (node.publishedVersion) nc.publishedVersion = node.publishedVersion
  if (node.type === 'COMPONENT_SET' || node.isPublishable) nc.isPublishable = node.isPublishable
  if (node.type === 'COMPONENT' || node.isSymbolPublishable) {
    nc.isSymbolPublishable = node.isSymbolPublishable
  }
  if (node.symbolDescription) nc.symbolDescription = node.symbolDescription
  if (node.symbolLinks.length > 0) nc.symbolLinks = structuredClone(node.symbolLinks)
  const componentPropDefs = node.componentPropertyDefinitions
    .map((def) => {
      const id = parseGuidOrNull(def.id)
      return id
        ? {
            id,
            name: def.name,
            type: componentPropertyTypeForKiwi(def.type),
            initialValue: componentPropertyValue(def.defaultValue)
          }
        : null
    })
    .filter((def): def is NonNullable<typeof def> => def !== null)
  if (componentPropDefs.length > 0) nc.componentPropDefs = componentPropDefs

  const variantPropSpecs = node.variantPropSpecs
    .map((spec) => {
      const propDefId = parseGuidOrNull(spec.propDefId)
      return propDefId ? { propDefId, value: spec.value } : null
    })
    .filter((spec): spec is NonNullable<typeof spec> => spec !== null)
  if (variantPropSpecs.length > 0) nc.variantPropSpecs = variantPropSpecs
}

function exportNodeSize(node: SceneNode): Vector {
  return node.source.fig.rawSize
    ? { ...node.source.fig.rawSize }
    : { x: node.width, y: node.height }
}

function exportNodeTransform(context: SceneNodeToKiwiContext, node: SceneNode): Matrix {
  return node.source.fig.rawTransform
    ? { ...node.source.fig.rawTransform }
    : context.computeExportTransform(node)
}

function applyNodeVisualProps(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  nc: KiwiNodeChange
): void {
  if (node.independentStrokeWeights) {
    nc.borderStrokeWeightsIndependent = true
    nc.borderTopWeight = node.borderTopWeight
    nc.borderRightWeight = node.borderRightWeight
    nc.borderBottomWeight = node.borderBottomWeight
    nc.borderLeftWeight = node.borderLeftWeight
  }

  if (node.fills.length > 0) {
    nc.fillPaints = node.fills.map((fill, index) =>
      applyColorVariableBinding(
        context,
        node,
        context.fillToKiwiPaint(fill),
        `fills/${index}/color`
      )
    )
  }

  context.serializeCornerRadii(node, nc)

  if (node.effects.length > 0 && !hasPreservedUnsupportedEffects(node)) {
    nc.effects = node.effects.map((effect) => ({
      type: effect.type === 'LAYER_BLUR' ? 'FOREGROUND_BLUR' : effect.type,
      color: context.safeColor(effect.color),
      offset: effect.offset,
      radius: effect.radius,
      spread: effect.spread,
      visible: effect.visible,
      blendMode: effect.blendMode ?? 'NORMAL',
      showShadowBehindNode: effect.showShadowBehindNode
    }))
  }

  if (node.type === 'TEXT') {
    context.serializeTextProps(
      node,
      nc,
      context.graph,
      context.fontDigestMap,
      context.blobs,
      context.glyphBlobMap
    )
  }

  if (node.type !== 'VECTOR') nc.frameMaskDisabled = !node.clipsContent
  if (node.horizontalConstraint !== 'MIN') nc.horizontalConstraint = node.horizontalConstraint
  if (node.verticalConstraint !== 'MIN') nc.verticalConstraint = node.verticalConstraint
  if (node.strokeCap !== 'NONE') nc.strokeCap = node.strokeCap
  if (node.strokeJoin !== 'MITER') nc.strokeJoin = node.strokeJoin
  if (!node.source.id && node.strokeMiterLimit !== 28.96) nc.miterLimit = node.strokeMiterLimit
  if (node.dashPattern.length > 0) nc.dashPattern = node.dashPattern
  if (node.arcData) {
    nc.arcData = {
      startingAngle: node.arcData.startingAngle,
      endingAngle: node.arcData.endingAngle,
      innerRadius: node.arcData.innerRadius
    }
  }
  if (!node.autoRename) nc.autoRename = false
}

export function sceneNodeToKiwiWithContext(
  node: SceneNode,
  parentGuid: GUID,
  childIndex: number,
  localIdCounter: { value: number },
  context: SceneNodeToKiwiContext
): KiwiNodeChange[] {
  const guid = getOrCreateNodeGuid(context, node.id, localIdCounter) ?? {
    sessionID: 1,
    localID: localIdCounter.value++
  }

  const strokePaints = createStrokePaints(context, node)

  const nc: KiwiNodeChange = {
    guid,
    parentIndex: {
      guid: parentGuid,
      position: node.source.orderKey ?? context.fractionalPosition(childIndex)
    },
    type: context.mapToFigmaType(node.type),
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    phase: 'CREATED',
    size: exportNodeSize(node),
    transform: exportNodeTransform(context, node)
  }
  if (node.type === 'GROUP') {
    nc.resizeToFit = true
  }
  // Only set strokeWeight/strokeAlign when the node has strokes in the scene
  // model. For imported nodes without strokes but with raw strokeWeight data
  // (e.g. text nodes, instance children with scaled strokes), the raw value
  // must be allowed to flow through via applyPreservedFigmaNodeFields.
  if (node.strokes.length > 0) {
    nc.strokeWeight = node.strokes[0].weight
    nc.strokeAlign = node.strokes[0].align
  }
  if (node.locked) nc.locked = true

  applyNodeVisualProps(context, node, nc)
  applyComponentMetadata(node, nc)
  applyInstancePayload(context, node, nc, localIdCounter)
  if (node.type === 'COMPONENT_SET') upsertPluginData(node, NODE_TYPE_PLUGIN_KEY, node.type)
  if (nc.type === 'CANVAS') nc.pageType = 'DESIGN'
  if (node.type === 'BOOLEAN_OPERATION')
    nc.booleanOperation = toKiwiBooleanOperation(node.booleanOperation)
  if (strokePaints.length > 0) nc.strokePaints = strokePaints

  context.serializeLayoutProps(node, nc)
  context.serializeGeometry(nodeForExplicitGeometryExport(node), nc, context.blobs)
  context.serializeVariableBindings(node, nc, context.graph, context.varIdToGuid)
  applyPreservedFigmaNodeFields(context, node, nc)

  applyExportSettingsPluginData(node)
  const pluginData = mergePluginData(node.pluginData)
  if (pluginData.length > 0) nc.pluginData = pluginData
  if (node.pluginRelaunchData.length > 0) {
    nc.pluginRelaunchData = serializePluginRelaunchData(node.pluginRelaunchData)
  }

  const result: KiwiNodeChange[] = [nc]
  const children =
    node.type === 'INSTANCE'
      ? []
      : context.graph.getChildren(node.id).filter((child) => !child.internalOnly)
  for (let i = 0; i < children.length; i++) {
    result.push(...context.sceneNodeToKiwi(children[i], guid, i, localIdCounter, context))
  }
  return result
}
