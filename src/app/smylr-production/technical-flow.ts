import {
  createMermaidSvgSpec,
  isMermaidDiagramContainer,
  mermaidDiagramName
} from '@open-pencil/core/diagram'
import {
  createMermaidDiagramInGraph,
  mermaidDiagramOwner,
  replaceMermaidDiagramInGraph
} from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW,
  type AppScreenFlowDefinition
} from './app-flow/model'
import TECHNICAL_FLOW_MERMAID_SOURCE from './technical-flow-save-finding.mmd?raw'

const PLUGIN_ID = 'smylr-production'
const OPEN_PENCIL_PLUGIN_ID = 'open-pencil'
const TECHNICAL_FLOW_KIND = 'technical-flow-mermaid'
const TECHNICAL_FLOW_OWNER_KEY = 'technicalFlowOwnerKey'
const TECHNICAL_FLOW_OWNER_VALUE = 'technical-flow-save-finding'
const TECHNICAL_FLOW_OWNER_ID = 'smylr-technical-flow-save-finding-mermaid'
const TECHNICAL_FLOW_DIAGRAM_ID = 'technical-flow-save-finding-mermaid'
const TECHNICAL_FLOW_SOURCE_FILE = 'technical-flow-save-finding.mmd'
const TECHNICAL_FLOW_MARKDOWN_FILE = 'technical-flow-save-finding.md'
const TECHNICAL_FLOW_VISUAL_VERSION = '15'
const TECHNICAL_FLOW_MERMAID_X = 320
const TECHNICAL_FLOW_MERMAID_Y = 160

export const TECHNICAL_FLOW_SAVE_FINDING_ID = TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.id
export const TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE = TECHNICAL_FLOW_MERMAID_SOURCE.trim()
export const TECHNICAL_FLOW_SAVE_FINDING_OWNER_KEY = TECHNICAL_FLOW_OWNER_VALUE
export const TECHNICAL_FLOW_SAVE_FINDING_SOURCE_FILE = TECHNICAL_FLOW_SOURCE_FILE

const TECHNICAL_FLOW_MERMAID_SCENE = createMermaidSvgSpec(
  TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE,
  { appearance: 'dark' }
)

function pluginData(key: string, value: string) {
  return { key, pluginId: PLUGIN_ID, value }
}

function pluginValue(node: SceneNode | null | undefined, key: string): string | undefined {
  return node?.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function openPencilValue(node: SceneNode | null | undefined, key: string): string | undefined {
  return node?.pluginData.find(
    (entry) => entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === key
  )?.value
}

function mergePluginData(
  node: SceneNode,
  managedKeys: readonly string[],
  values: SceneNode['pluginData']
) {
  const managed = new Set(managedKeys)
  return [
    ...node.pluginData.filter((entry) => !(entry.pluginId === PLUGIN_ID && managed.has(entry.key))),
    ...values
  ]
}

function technicalOwnerPluginData(ownerId: string): SceneNode['pluginData'] {
  return [
    pluginData('kind', TECHNICAL_FLOW_KIND),
    pluginData('flowId', TECHNICAL_FLOW_OWNER_VALUE),
    pluginData(TECHNICAL_FLOW_OWNER_KEY, TECHNICAL_FLOW_OWNER_VALUE),
    pluginData('technicalFlowOwnerId', ownerId),
    pluginData('technicalFlowSourceFile', TECHNICAL_FLOW_SOURCE_FILE),
    pluginData('technicalFlowVisualVersion', TECHNICAL_FLOW_VISUAL_VERSION)
  ]
}

function stampTechnicalOwner(graph: SceneGraph, owner: SceneNode): boolean {
  const nextPluginData = mergePluginData(
    owner,
    [
      'kind',
      'flowId',
      TECHNICAL_FLOW_OWNER_KEY,
      'technicalFlowOwnerId',
      'technicalFlowSourceFile',
      'technicalFlowVisualVersion'
    ],
    technicalOwnerPluginData(owner.id)
  )
  if (JSON.stringify(owner.pluginData) === JSON.stringify(nextPluginData)) return false
  graph.updateNode(owner.id, { pluginData: nextPluginData })
  return true
}

function stampTechnicalPage(graph: SceneGraph, page: SceneNode, ownerId: string): boolean {
  const nextPluginData = mergePluginData(
    page,
    [
      'kind',
      'pageId',
      'route',
      'flowId',
      'flowSchemaVersion',
      'flowSource',
      'flowSourceFile',
      'flowSourceFormat',
      'technicalFlowOwnerId',
      'technicalFlowDiagramId',
      'technicalFlowSourceFile',
      'technicalFlowSourceFormat',
      'technicalFlowVisualVersion'
    ],
    [
      pluginData('kind', 'smylr-flow-page'),
      pluginData('pageId', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.pageId),
      pluginData('route', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.route),
      pluginData('flowId', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.id),
      pluginData('flowSchemaVersion', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.schemaVersion),
      pluginData('flowSource', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.source),
      pluginData('flowSourceFile', TECHNICAL_FLOW_MARKDOWN_FILE),
      pluginData('flowSourceFormat', 'markdown'),
      pluginData('technicalFlowOwnerId', ownerId),
      pluginData('technicalFlowDiagramId', TECHNICAL_FLOW_DIAGRAM_ID),
      pluginData('technicalFlowSourceFile', TECHNICAL_FLOW_SOURCE_FILE),
      pluginData('technicalFlowSourceFormat', 'mermaid'),
      pluginData('technicalFlowVisualVersion', TECHNICAL_FLOW_VISUAL_VERSION)
    ]
  )
  if (JSON.stringify(page.pluginData) === JSON.stringify(nextPluginData)) return false
  graph.updateNode(page.id, { pluginData: nextPluginData })
  return true
}

function mermaidOwners(graph: SceneGraph, pageId: string): SceneNode[] {
  return graph
    .getChildren(pageId)
    .filter((child) => mermaidDiagramOwner(graph, child.id)?.id === child.id)
}

function findTechnicalOwner(graph: SceneGraph, pageId: string): SceneNode | null {
  const owners = mermaidOwners(graph, pageId)
  const page = graph.getNode(pageId)
  const persistedOwnerId = pluginValue(page, 'technicalFlowOwnerId')
  const persistedOwner = owners.find((owner) => owner.id === persistedOwnerId)
  if (persistedOwner) return persistedOwner
  const tagged = owners.filter(
    (owner) =>
      pluginValue(owner, TECHNICAL_FLOW_OWNER_KEY) === TECHNICAL_FLOW_OWNER_VALUE ||
      pluginValue(owner, 'kind') === TECHNICAL_FLOW_KIND ||
      pluginValue(owner, 'technicalFlowSourceFile') === TECHNICAL_FLOW_SOURCE_FILE ||
      pluginValue(owner, 'technicalFlowDiagramId') === TECHNICAL_FLOW_DIAGRAM_ID
  )
  if (tagged.length > 1) return tagged[0] ?? null
  if (tagged.length === 1) return tagged[0] ?? null
  const sourceMatches = owners.filter(
    (owner) =>
      openPencilValue(owner, 'mermaid/source') === TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE
  )
  return sourceMatches.length === 1 ? (sourceMatches[0] ?? null) : null
}

function removeTechnicalOwnedProjection(
  graph: SceneGraph,
  pageId: string,
  resolvedOwnerId: string | null
): boolean {
  let changed = false
  for (const child of graph.getChildren(pageId)) {
    if (child.id === resolvedOwnerId) continue
    const flowId = pluginValue(child, 'flowId')
    const kind = pluginValue(child, 'kind')
    const sourceFile = pluginValue(child, 'sourceFile')
    const isTechnicalFlowObject = flowId === TECHNICAL_FLOW_OWNER_VALUE
    const isTechnicalGuide =
      kind === 'smylr-board-guide' && sourceFile === TECHNICAL_FLOW_MARKDOWN_FILE
    if (!isTechnicalFlowObject && !isTechnicalGuide) continue
    graph.deleteNode(child.id)
    changed = true
  }
  return changed
}

function usableOwnerId(graph: SceneGraph, page: SceneNode): string {
  const persisted = pluginValue(page, 'technicalFlowOwnerId')
  if (persisted && !graph.getNode(persisted)) return persisted
  return TECHNICAL_FLOW_OWNER_ID
}

function syncTechnicalMermaid(graph: SceneGraph, page: SceneNode): boolean {
  const owner = findTechnicalOwner(graph, page.id)
  let changed = false

  let currentOwner = owner
  if (currentOwner) {
    const currentSource = openPencilValue(currentOwner, 'mermaid/source')
    const visualChanged =
      pluginValue(currentOwner, 'technicalFlowVisualVersion') !== TECHNICAL_FLOW_VISUAL_VERSION
    const positionChanged =
      currentOwner.x !== TECHNICAL_FLOW_MERMAID_X || currentOwner.y !== TECHNICAL_FLOW_MERMAID_Y
    if (!isMermaidDiagramContainer(currentOwner)) {
      const ownerId = currentOwner.id
      const diagramId =
        openPencilValue(currentOwner, 'mermaid/diagram-id') ?? TECHNICAL_FLOW_DIAGRAM_ID
      graph.deleteNode(ownerId)
      const created = createMermaidDiagramInGraph(
        graph,
        page.id,
        TECHNICAL_FLOW_MERMAID_SCENE,
        { x: TECHNICAL_FLOW_MERMAID_X, y: TECHNICAL_FLOW_MERMAID_Y },
        { diagramId, ownerId }
      )
      currentOwner = graph.getNode(created.ownerId) ?? null
      changed = true
    } else if (
      currentSource !== TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE ||
      positionChanged ||
      visualChanged
    ) {
      replaceMermaidDiagramInGraph(graph, page.id, currentOwner.id, TECHNICAL_FLOW_MERMAID_SCENE, {
        x: TECHNICAL_FLOW_MERMAID_X,
        y: TECHNICAL_FLOW_MERMAID_Y
      })
      currentOwner = graph.getNode(currentOwner.id) ?? null
      changed = true
    } else if (
      currentOwner.name !== mermaidDiagramName(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
    ) {
      graph.updateNode(currentOwner.id, {
        name: mermaidDiagramName(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
      })
      changed = true
    }
  } else {
    const created = createMermaidDiagramInGraph(
      graph,
      page.id,
      TECHNICAL_FLOW_MERMAID_SCENE,
      { x: TECHNICAL_FLOW_MERMAID_X, y: TECHNICAL_FLOW_MERMAID_Y },
      {
        diagramId: TECHNICAL_FLOW_DIAGRAM_ID,
        ownerId: usableOwnerId(graph, page)
      }
    )
    currentOwner = graph.getNode(created.ownerId) ?? null
    changed = true
  }

  if (!currentOwner) return changed
  if (stampTechnicalOwner(graph, currentOwner)) changed = true
  if (stampTechnicalPage(graph, page, currentOwner.id)) changed = true
  return changed
}

export type TechnicalFlowSceneResult = {
  changed: boolean
  ownerId: string | null
  screenIds: string[]
}

export function syncTechnicalFlowScene(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition = TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW
): TechnicalFlowSceneResult {
  const page = graph.getNode(pageId)
  if (!page) return { changed: false, ownerId: null, screenIds: [] }
  let owner = findTechnicalOwner(graph, pageId)
  let changed = removeTechnicalOwnedProjection(graph, pageId, owner?.id ?? null)
  owner = findTechnicalOwner(graph, pageId)
  const mermaidChanged = syncTechnicalMermaid(graph, page)
  owner = findTechnicalOwner(graph, pageId)
  if (!owner) return { changed: changed || mermaidChanged, ownerId: null, screenIds: [] }
  if (definition.id !== TECHNICAL_FLOW_SAVE_FINDING_ID) {
    throw new Error(`Technical Flow sync received unexpected definition ${definition.id}`)
  }
  if (stampTechnicalPage(graph, page, owner.id)) changed = true
  return {
    changed: changed || mermaidChanged,
    ownerId: owner.id,
    screenIds: []
  }
}
