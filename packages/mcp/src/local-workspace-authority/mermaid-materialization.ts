import { createMermaidDiagramInGraph, replaceMermaidDiagramInGraph } from '@open-pencil/core/editor'

import { readAuthorityBoardDocument, writeAuthorityBoardDocument } from './document'
import { compileHeadlessMermaidScenes, MermaidSourceValidationError } from './mermaid-compiler'
import { nodePairs, pluginValue } from './mermaid-presence'

type JsonRecord = Record<string, unknown>

type MermaidMaterialization = {
  kind: 'create' | 'replace'
  ownerId: string
  pageId: string
  source: string
  x: number
  y: number
}

export type MaterializedAuthorityDocument = {
  changed: boolean
  document: unknown
  invalidOwnerIds: string[]
  ownerIds: string[]
}

function finitePosition(node: JsonRecord, field: 'x' | 'y', ownerId: string): number {
  const value = node[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Declarative Mermaid owner "${ownerId}" requires a finite ${field}.`)
  }
  return value
}

function declarativeMermaidMaterialization(
  ownerId: string,
  node: JsonRecord
): MermaidMaterialization | null {
  if (typeof node.mermaidSource !== 'string') return null
  const source = node.mermaidSource.trim()
  if (!source) throw new TypeError(`Declarative Mermaid owner "${ownerId}" has empty source.`)
  if (
    node.id !== ownerId ||
    (node.type !== 'GROUP' && node.type !== 'FRAME') ||
    typeof node.parentId !== 'string'
  ) {
    throw new TypeError(
      `Declarative Mermaid owner "${ownerId}" requires matching id, type "FRAME" or "GROUP", and parentId.`
    )
  }
  if (pluginValue(node, 'mermaid/role') === 'diagram') {
    return {
      kind: 'replace',
      ownerId,
      pageId: node.parentId,
      source,
      x: finitePosition(node, 'x', ownerId),
      y: finitePosition(node, 'y', ownerId)
    }
  }
  if (Array.isArray(node.childIds) && node.childIds.length > 0) {
    throw new TypeError(`Declarative Mermaid owner "${ownerId}" must not contain childIds.`)
  }
  return {
    kind: 'create',
    ownerId,
    pageId: node.parentId,
    source,
    x: finitePosition(node, 'x', ownerId),
    y: finitePosition(node, 'y', ownerId)
  }
}

function editedMermaidSource(
  ownerId: string,
  node: JsonRecord,
  nodes: ReadonlyMap<string, JsonRecord>
): MermaidMaterialization | null {
  if (pluginValue(node, 'mermaid/role') !== 'diagram') return null
  const source = pluginValue(node, 'mermaid/source')
  if (!source || typeof node.parentId !== 'string') return null
  const childIds = Array.isArray(node.childIds)
    ? node.childIds.filter((value): value is string => typeof value === 'string')
    : []
  const compiledSource = childIds.reduce<string | null>((result, childId) => {
    return result ?? pluginValue(nodes.get(childId) ?? {}, 'mermaid/source')
  }, null)
  if (!compiledSource || compiledSource === source) return null
  return {
    kind: 'replace',
    ownerId,
    pageId: node.parentId,
    source,
    x: finitePosition(node, 'x', ownerId),
    y: finitePosition(node, 'y', ownerId)
  }
}

function mermaidMaterializations(value: unknown): MermaidMaterialization[] {
  const pairs = nodePairs(value)
  if (!pairs) return []
  const nodes = new Map(pairs)
  return pairs.flatMap(([ownerId, node]) => {
    const declarative = declarativeMermaidMaterialization(ownerId, node)
    if (declarative) return [declarative]
    const replacement = editedMermaidSource(ownerId, node, nodes)
    return replacement ? [replacement] : []
  })
}

export async function materializeAuthorityMermaidDocument(
  value: unknown
): Promise<MaterializedAuthorityDocument> {
  const materializations = mermaidMaterializations(value)
  if (materializations.length === 0) {
    return { changed: false, document: value, invalidOwnerIds: [], ownerIds: [] }
  }

  const scenes = new Map<string, Awaited<ReturnType<typeof compileHeadlessMermaidScenes>>[number]>()
  const invalidOwnerIds: string[] = []
  for (const materialization of materializations) {
    try {
      const scene = (await compileHeadlessMermaidScenes([materialization.source])).at(0)
      if (scene) scenes.set(materialization.ownerId, scene)
    } catch (error) {
      if (!(error instanceof MermaidSourceValidationError)) throw error
      invalidOwnerIds.push(materialization.ownerId)
    }
  }

  if (scenes.size === 0) {
    return { changed: false, document: value, invalidOwnerIds, ownerIds: [] }
  }
  const document = readAuthorityBoardDocument(value)

  for (const materialization of materializations) {
    const scene = scenes.get(materialization.ownerId)
    if (!scene) continue
    const page = document.graph.getNode(materialization.pageId)
    if (page?.type !== 'CANVAS') {
      throw new Error(
        `Declarative Mermaid owner "${materialization.ownerId}" requires a CANVAS parent.`
      )
    }

    if (materialization.kind === 'replace') {
      replaceMermaidDiagramInGraph(
        document.graph,
        materialization.pageId,
        materialization.ownerId,
        scene,
        { x: materialization.x, y: materialization.y }
      )
      continue
    }

    const existing = document.graph.getNode(materialization.ownerId)
    if (!existing) {
      throw new Error(`Declarative Mermaid owner "${materialization.ownerId}" disappeared.`)
    }
    page.childIds = page.childIds.filter((id) => id !== materialization.ownerId)
    document.graph.nodes.delete(materialization.ownerId)
    createMermaidDiagramInGraph(
      document.graph,
      materialization.pageId,
      scene,
      { x: materialization.x, y: materialization.y },
      { diagramId: materialization.ownerId, ownerId: materialization.ownerId }
    )
  }

  return {
    changed: true,
    document: writeAuthorityBoardDocument(document),
    invalidOwnerIds,
    ownerIds: [...scenes.keys()]
  }
}
