import type {
  DocumentColorSpace,
  SceneNode,
  Variable,
  VariableCollection
} from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'
import { hydrateSceneNodeDefaults } from '@open-pencil/scene-graph/node-defaults'

const BYTE_MARKER = '__openpencil_uint8array_v1'

type WorkspaceDocument = {
  activeMode: Array<[string, string]>
  documentColorSpace: DocumentColorSpace
  figKiwiVersion: number | null
  figSchemaDeflated: Uint8Array | null
  images: Array<[string, Uint8Array]>
  instanceIndex: Array<[string, string[]]>
  nodes: Array<[string, SceneNode]>
  rootId: string
  variableCollections: Array<[string, VariableCollection]>
  variables: Array<[string, Variable]>
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function decodedAuthorityValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodedAuthorityValue)
  if (!isRecord(value)) return value
  if (Object.keys(value).length === 1 && typeof value[BYTE_MARKER] === 'string') {
    return new Uint8Array(Buffer.from(value[BYTE_MARKER], 'base64'))
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodedAuthorityValue(entry)])
  )
}

function encodedAuthorityValue(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { [BYTE_MARKER]: Buffer.from(value).toString('base64') }
  }
  if (Array.isArray(value)) return value.map(encodedAuthorityValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, encodedAuthorityValue(entry)])
  )
}

function isPairArray(value: unknown): value is Array<[string, unknown]> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string'
    )
  )
}

function workspaceDocument(value: unknown): WorkspaceDocument {
  const decoded = decodedAuthorityValue(value)
  if (
    !isRecord(decoded) ||
    typeof decoded.rootId !== 'string' ||
    !isPairArray(decoded.nodes) ||
    !isPairArray(decoded.images) ||
    !isPairArray(decoded.variables) ||
    !isPairArray(decoded.variableCollections) ||
    !isPairArray(decoded.activeMode) ||
    !isPairArray(decoded.instanceIndex)
  ) {
    throw new TypeError('Local workspace authority contains an invalid Board document')
  }
  return decoded as WorkspaceDocument
}

export type AuthorityBoardDocument = {
  graph: SceneGraph
  source: WorkspaceDocument
}

export function readAuthorityBoardDocument(
  value: unknown,
  options?: { hydrate?: boolean }
): AuthorityBoardDocument {
  const source = workspaceDocument(value)
  const graph = new SceneGraph()
  graph.rootId = source.rootId
  graph.nodes = new Map(
    options?.hydrate === false
      ? source.nodes
      : source.nodes.map(([id, node]) => [id, hydrateSceneNodeDefaults(node)] as const)
  )
  graph.images = new Map(source.images)
  graph.variables = new Map(source.variables)
  graph.variableCollections = new Map(source.variableCollections)
  graph.activeMode = new Map(source.activeMode)
  graph.instanceIndex = new Map(source.instanceIndex.map(([id, nodeIds]) => [id, new Set(nodeIds)]))
  graph.figKiwiVersion = source.figKiwiVersion
  graph.figSchemaDeflated = source.figSchemaDeflated
  graph.documentColorSpace = source.documentColorSpace

  const root = graph.getNode(graph.rootId)
  if (!root) throw new TypeError('Local workspace authority Board root is missing')
  for (const [id, node] of graph.nodes) {
    if (node.id !== id) {
      throw new TypeError(`Local workspace authority node key disagrees with node "${id}"`)
    }
  }
  return { graph, source }
}

export function writeAuthorityBoardDocument(document: AuthorityBoardDocument): unknown {
  const { graph, source } = document
  return encodedAuthorityValue({
    ...source,
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    images: [...graph.images],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    nodes: [...graph.nodes],
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables]
  })
}
