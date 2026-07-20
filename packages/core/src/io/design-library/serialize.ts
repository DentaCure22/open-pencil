import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import { exportVariablesToDtcg } from '#core/io/tokens'

import {
  type LibraryComponent,
  type LibrarySceneNode,
  type OpenPencilLibrary,
  OPENPENCIL_LIBRARY_FORMAT
} from './types'

export interface BuildDesignLibraryOptions {
  key: string
  name: string
  version: string
  publishedAt?: string
}

function serializeNode(graph: SceneGraph, node: SceneNode): LibrarySceneNode {
  const { id, parentId: _parentId, childIds: _childIds, textPicture, ...props } = node
  return {
    ...structuredClone(props),
    sourceId: id,
    textPicture: textPicture?.toBase64() ?? null,
    children: graph.getChildren(id).map((child) => serializeNode(graph, child))
  }
}

function localComponentRoots(graph: SceneGraph): SceneNode[] {
  return [...graph.nodes.values()]
    .filter((node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
    .filter((node) => !node.internalOnly && !node.sourceLibraryKey)
    .filter((node) => {
      if (node.type === 'COMPONENT_SET') return true
      const parent = node.parentId ? graph.getNode(node.parentId) : undefined
      return parent?.type !== 'COMPONENT_SET'
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function componentRecord(graph: SceneGraph, node: SceneNode, version: string): LibraryComponent {
  const serialized = serializeNode(graph, node)
  const signature = computeImageHash(new TextEncoder().encode(JSON.stringify(serialized)))
  return {
    publishId: node.publishId ?? node.id,
    name: node.name,
    version,
    signature,
    node: serialized
  }
}

function collectImageHashes(node: LibrarySceneNode, hashes: Set<string>) {
  for (const fill of node.fills) {
    if (fill.type === 'IMAGE' && fill.imageHash) hashes.add(fill.imageHash)
  }
  for (const child of node.children) collectImageHashes(child, hashes)
}

export function buildOpenPencilLibrary(
  graph: SceneGraph,
  options: BuildDesignLibraryOptions
): OpenPencilLibrary {
  const components = localComponentRoots(graph).map((node) =>
    componentRecord(graph, node, options.version)
  )
  const imageHashes = new Set<string>()
  for (const component of components) collectImageHashes(component.node, imageHashes)
  const images: Record<string, string> = {}
  for (const hash of imageHashes) {
    const bytes = graph.images.get(hash)
    if (bytes) images[hash] = bytes.toBase64()
  }
  return {
    format: OPENPENCIL_LIBRARY_FORMAT,
    library: {
      key: options.key,
      name: options.name,
      version: options.version,
      publishedAt: options.publishedAt ?? new Date().toISOString()
    },
    components,
    tokens: exportVariablesToDtcg(graph),
    images
  }
}
