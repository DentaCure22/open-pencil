import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  codeObjectDocument,
  createSmylrFlowScreenDocument,
  setCodeObjectDocument,
  type SmylrFlowScreenDocument
} from '@/app/code-object/model'

import type { AppScreenFlowDefinition, AppScreenFlowNode } from './model'
import {
  APP_FLOW_CODE_OBJECT_MEDIUM,
  appFlowPluginData,
  appScreenFlowPluginValue,
  mergeAppFlowPluginData
} from './primitives'

const CODE_OBJECT_FLOW_VERSION = '1'

type FlowScreenNode = AppScreenFlowNode & { kind: 'screen'; state: string }

export type CodeObjectFlowSyncResult = {
  changed: boolean
  frameIds: string[]
  removedNativeChildren: number
  removedVariableCollections: number
}

function flowScreens(definition: AppScreenFlowDefinition): FlowScreenNode[] {
  return definition.nodes.filter(
    (node): node is FlowScreenNode => node.kind === 'screen' && typeof node.state === 'string'
  )
}

function screenFrame(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  screen: FlowScreenNode
): SceneNode | null {
  return (
    graph
      .getChildren(pageId)
      .find(
        (node) =>
          appScreenFlowPluginValue(node, 'flowId') === definition.id &&
          appScreenFlowPluginValue(node, 'appFlowNodeId') === screen.id
      ) ?? null
  )
}

function nextDocument(
  frame: SceneNode,
  definition: AppScreenFlowDefinition,
  screen: FlowScreenNode
): SmylrFlowScreenDocument {
  const created = createSmylrFlowScreenDocument({
    flowId: definition.id,
    label: screen.label,
    route: screen.route ?? definition.route,
    screenId: screen.id,
    viewState: screen.state
  })
  const current = codeObjectDocument(frame)
  if (
    current?.component !== 'smylr-flow-screen' ||
    current.flowId !== definition.id ||
    current.screenId !== screen.id
  ) {
    return created
  }
  return { ...created, state: current.state }
}

function markCodeObjectFrame(graph: SceneGraph, frameId: string, sourceId: string) {
  const frame = graph.getNode(frameId)
  if (!frame) return false
  const managedKeys = [
    'renderMedium',
    'nativeReactVersion',
    'nativeReactSignature',
    'nativeReactSourceId',
    'nativeReactStateCount',
    'nativeReactBindingCount',
    'nativeReactWarningCount',
    'nativeReactInteractionMode',
    'nativeReactTrust',
    'liveReactSurfaceVersion',
    'liveReactSourceId',
    'liveReactInteractionMode',
    'liveReactTrust',
    'codeObjectVersion',
    'codeObjectSourceId',
    'codeObjectInteractionMode',
    'codeObjectTrust'
  ]
  const isCurrent =
    appScreenFlowPluginValue(frame, 'renderMedium') === APP_FLOW_CODE_OBJECT_MEDIUM &&
    appScreenFlowPluginValue(frame, 'codeObjectVersion') === CODE_OBJECT_FLOW_VERSION &&
    appScreenFlowPluginValue(frame, 'codeObjectSourceId') === sourceId &&
    appScreenFlowPluginValue(frame, 'codeObjectInteractionMode') === 'design-or-interact' &&
    appScreenFlowPluginValue(frame, 'codeObjectTrust') === 'openpencil-owned'
  if (isCurrent) return false
  const pluginData = mergeAppFlowPluginData(frame, managedKeys, [
    appFlowPluginData('renderMedium', APP_FLOW_CODE_OBJECT_MEDIUM),
    appFlowPluginData('codeObjectVersion', CODE_OBJECT_FLOW_VERSION),
    appFlowPluginData('codeObjectSourceId', sourceId),
    appFlowPluginData('codeObjectInteractionMode', 'design-or-interact'),
    appFlowPluginData('codeObjectTrust', 'openpencil-owned')
  ])
  graph.updateNode(frame.id, { pluginData })
  return true
}

function removeNativeChildren(graph: SceneGraph, frame: SceneNode) {
  const childIds = [...frame.childIds]
  for (const childId of childIds) graph.deleteNode(childId)
  return childIds.length
}

function removeNativeStateCollections(graph: SceneGraph, definition: AppScreenFlowDefinition) {
  const prefix = `React state · ${definition.id} · `
  const ids = [...graph.variableCollections.values()]
    .filter((collection) => collection.name.startsWith(prefix))
    .map((collection) => collection.id)
  for (const id of ids) graph.removeCollection(id)
  return ids.length
}

function setDocumentWhenChanged(
  graph: SceneGraph,
  frame: SceneNode,
  document: SmylrFlowScreenDocument
) {
  const current = codeObjectDocument(frame)
  if (JSON.stringify(current) === JSON.stringify(document)) return false
  return setCodeObjectDocument(graph, frame.id, document)
}

/**
 * Attach Code Object documents to the existing ordinary flow frames.
 * Frame IDs remain the durable surface/root identity; reruns update in place.
 */
export function syncAppScreenFlowCodeObjects(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition
): CodeObjectFlowSyncResult {
  const result: CodeObjectFlowSyncResult = {
    changed: false,
    frameIds: [],
    removedNativeChildren: 0,
    removedVariableCollections: 0
  }
  for (const screen of flowScreens(definition)) {
    const frame = screenFrame(graph, pageId, definition, screen)
    if (!frame) continue
    result.frameIds.push(frame.id)
    const document = nextDocument(frame, definition, screen)
    if (frame.childIds.length > 0) {
      result.removedNativeChildren += removeNativeChildren(graph, frame)
      result.changed = true
    }
    if (setDocumentWhenChanged(graph, frame, document)) result.changed = true
    if (markCodeObjectFrame(graph, frame.id, `${definition.id}/${screen.id}`)) {
      result.changed = true
    }
  }
  result.removedVariableCollections = removeNativeStateCollections(graph, definition)
  result.changed ||= result.removedVariableCollections > 0
  return result
}
