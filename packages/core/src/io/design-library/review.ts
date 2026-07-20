import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { parseDtcgTokens, reviewTokenSnapshot } from '#core/io/tokens'

import {
  type DesignLibraryReview,
  type DesignLibraryReviewCount,
  type OpenPencilLibrary,
  OPENPENCIL_LIBRARY_FORMAT,
  OPENPENCIL_LIBRARY_PLUGIN_ID
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLibrary(value: unknown): value is OpenPencilLibrary {
  return (
    isRecord(value) &&
    value.format === OPENPENCIL_LIBRARY_FORMAT &&
    isRecord(value.library) &&
    typeof value.library.key === 'string' &&
    typeof value.library.name === 'string' &&
    typeof value.library.version === 'string' &&
    typeof value.library.publishedAt === 'string' &&
    Array.isArray(value.components) &&
    isRecord(value.tokens) &&
    isRecord(value.images)
  )
}

export function parseOpenPencilLibrary(input: unknown): OpenPencilLibrary {
  const value = typeof input === 'string' ? JSON.parse(input) : input
  if (!isLibrary(value)) throw new Error('Not a valid OpenPencil library package')
  return structuredClone(value)
}

function metadata(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find(
      (entry) => entry.pluginId === OPENPENCIL_LIBRARY_PLUGIN_ID && entry.key === key
    )?.value ?? null
  )
}

function importedRoots(graph: SceneGraph, libraryKey: string): SceneNode[] {
  return [...graph.nodes.values()].filter(
    (node) =>
      (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') &&
      node.sourceLibraryKey === libraryKey &&
      metadata(node, 'root') === 'true'
  )
}

export function reviewOpenPencilLibrary(
  graph: SceneGraph,
  library: OpenPencilLibrary
): DesignLibraryReview {
  const components: DesignLibraryReviewCount = {
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0
  }
  const current = new Map(
    importedRoots(graph, library.library.key).map((node) => [node.publishId, node])
  )
  const incoming = new Set<string>()
  for (const component of library.components) {
    incoming.add(component.publishId)
    const node = current.get(component.publishId)
    if (!node) components.added++
    else if (metadata(node, 'signature') === component.signature) components.unchanged++
    else components.updated++
  }
  for (const publishId of current.keys()) {
    if (publishId && !incoming.has(publishId)) components.removed++
  }
  const tokenImport = parseDtcgTokens(library.tokens)
  return {
    components,
    tokens: reviewTokenSnapshot(graph, tokenImport.snapshot),
    tokenSnapshot: tokenImport.snapshot,
    warnings: tokenImport.warnings
  }
}
