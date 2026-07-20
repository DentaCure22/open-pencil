import {
  contentSourcePluginData,
  mergeContentSourcePluginData,
  readContentSource,
  type ContentSourceMetadata
} from '@open-pencil/core/io'
import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import { solid, thinStroke } from '../demo/colors'

const PLUGIN_ID = 'open-pencil-source-document'
const KIND = 'source-document'
const PREVIEW_KIND = 'source-preview'
const MAX_PREVIEW_LINES = 22
const MAX_PREVIEW_LINE_LENGTH = 92

export type SourceDocumentFormat = 'html' | 'jsx' | 'tsx'

export type SourceDocument = {
  node: SceneNode
  source: ContentSourceMetadata & { format: SourceDocumentFormat }
}

export type CreateSourceDocumentOptions = {
  fileName?: string
  format: SourceDocumentFormat
}

const COLOR = {
  accent: { r: 0.6, g: 0.48, b: 0.96, a: 1 } satisfies Color,
  code: { r: 0.055, g: 0.059, b: 0.075, a: 1 } satisfies Color,
  line: { r: 0.22, g: 0.23, b: 0.28, a: 1 } satisfies Color,
  muted: { r: 0.68, g: 0.69, b: 0.74, a: 1 } satisfies Color,
  panel: { r: 0.09, g: 0.094, b: 0.11, a: 1 } satisfies Color,
  surface: { r: 0.93, g: 0.93, b: 0.95, a: 1 } satisfies Color
}

const FORMAT_MIME_TYPE = {
  html: 'text/html',
  jsx: 'text/jsx',
  tsx: 'text/tsx'
} satisfies Record<SourceDocumentFormat, string>

function documentPluginData(format: SourceDocumentFormat, fileName: string, source: string) {
  return [
    { pluginId: PLUGIN_ID, key: 'kind', value: KIND },
    ...contentSourcePluginData({
      fileName,
      format,
      mimeType: FORMAT_MIME_TYPE[format],
      revision: 1,
      source
    })
  ]
}

function rolePluginData(role: string) {
  return [{ pluginId: PLUGIN_ID, key: 'kind', value: role }]
}

function hasKind(node: SceneNode, kind: string): boolean {
  return node.pluginData.some(
    (entry) => entry.pluginId === PLUGIN_ID && entry.key === 'kind' && entry.value === kind
  )
}

function isSourceDocumentFormat(format: string): format is SourceDocumentFormat {
  return format === 'html' || format === 'jsx' || format === 'tsx'
}

export function isSourceDocumentNode(node: SceneNode | null | undefined): node is SceneNode {
  if (!node || !hasKind(node, KIND)) return false
  const source = readContentSource(node)
  return Boolean(source && isSourceDocumentFormat(source.format))
}

export function sourceDocumentForNode(
  graph: SceneGraph,
  nodeId: string | null | undefined
): SourceDocument | null {
  let node = nodeId ? graph.getNode(nodeId) : undefined
  while (node) {
    const source = readContentSource(node)
    if (hasKind(node, KIND) && source && isSourceDocumentFormat(source.format)) {
      return { node, source: { ...source, format: source.format } }
    }
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return null
}

export function selectedSourceDocument(store: EditorStore): SourceDocument | null {
  const ids = [...store.state.selectedIds]
  return ids.length === 1 ? sourceDocumentForNode(store.graph, ids[0]) : null
}

function sourcePreview(source: string): string {
  const lines = source.split('\n')
  const visible = lines
    .slice(0, MAX_PREVIEW_LINES)
    .map((line) =>
      line.length > MAX_PREVIEW_LINE_LENGTH
        ? `${line.slice(0, MAX_PREVIEW_LINE_LENGTH - 1)}…`
        : line
    )
  if (lines.length > visible.length) visible.push(`… ${lines.length - visible.length} more lines`)
  return visible.join('\n') || 'Empty source document'
}

function defaultFileName(format: SourceDocumentFormat): string {
  return `untitled.${format}`
}

export function sourceDocumentStarter(format: SourceDocumentFormat): string {
  if (format === 'html') {
    return `<main class="source-document">
  <h1>Editable HTML source</h1>
  <p>Open Live View only when you want to render it.</p>
</main>`
  }
  if (format === 'jsx') {
    return `export function SourceCard() {
  return (
    <article>
      <h1>Editable JSX source</h1>
    </article>
  )
}`
  }
  return `type SourceCardProps = {
  title: string
}

export function SourceCard({ title }: SourceCardProps) {
  return <article><h1>{title}</h1></article>
}`
}

function textNode(
  store: EditorStore,
  parentId: string,
  text: string,
  options: {
    color: Color
    fontSize: number
    fontWeight?: number
    height: number
    name: string
    pluginData?: SceneNode['pluginData']
    width: number
    x: number
    y: number
  }
) {
  return store.graph.createNode('TEXT', parentId, {
    fills: [solid(options.color)],
    fontFamily: 'Inter',
    fontSize: options.fontSize,
    fontWeight: options.fontWeight ?? 400,
    height: options.height,
    name: options.name,
    pluginData: options.pluginData ?? [],
    text,
    textAutoResize: 'HEIGHT',
    width: options.width,
    x: options.x,
    y: options.y
  })
}

function restoreNodes(store: EditorStore, snapshots: SceneNode[]) {
  for (const snapshot of snapshots) {
    store.graph.createNodeWithId(
      snapshot.id,
      snapshot.type,
      snapshot.parentId ?? store.state.currentPageId,
      { ...structuredClone(snapshot), childIds: [] }
    )
  }
}

export function createSourceDocument(
  store: EditorStore,
  source: string,
  options: CreateSourceDocumentOptions
): SceneNode {
  const previousSelection = new Set(store.state.selectedIds)
  const siblings = store.graph.getChildren(store.state.currentPageId)
  const x =
    siblings.length > 0 ? Math.max(...siblings.map((node) => node.x + node.width)) + 120 : 96
  const fileName = options.fileName?.trim() || defaultFileName(options.format)
  const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
    clipsContent: true,
    cornerRadius: 14,
    fills: [solid(COLOR.panel)],
    height: 620,
    name: fileName,
    pluginData: documentPluginData(options.format, fileName, source),
    strokes: thinStroke(COLOR.line),
    width: 860,
    x,
    y: 88
  })
  store.graph.createNode('RECTANGLE', frame.id, {
    cornerRadius: 2,
    fills: [solid(COLOR.accent)],
    height: 4,
    name: 'Source document accent',
    width: 52,
    x: 36,
    y: 34
  })
  textNode(store, frame.id, fileName, {
    color: COLOR.surface,
    fontSize: 24,
    fontWeight: 600,
    height: 34,
    name: 'Source document name',
    width: 650,
    x: 36,
    y: 56
  })
  textNode(store, frame.id, `${options.format.toUpperCase()} SOURCE · EDITABLE · REVISION 1`, {
    color: COLOR.muted,
    fontSize: 11,
    fontWeight: 600,
    height: 18,
    name: 'Source document status',
    width: 420,
    x: 38,
    y: 102
  })
  store.graph.createNode('FRAME', frame.id, {
    cornerRadius: 10,
    fills: [solid(COLOR.code)],
    height: 408,
    name: 'Source preview',
    strokes: thinStroke(COLOR.line),
    width: 788,
    x: 36,
    y: 142
  })
  const previewContainer = store.graph
    .getChildren(frame.id)
    .find((node) => node.name === 'Source preview')
  if (previewContainer) {
    textNode(store, previewContainer.id, sourcePreview(source), {
      color: COLOR.surface,
      fontSize: 13,
      height: 360,
      name: 'Source preview text',
      pluginData: rolePluginData(PREVIEW_KIND),
      width: 740,
      x: 24,
      y: 22
    })
  }
  textNode(
    store,
    frame.id,
    options.format === 'html'
      ? 'Stored source is authoritative. Live View is an optional projection.'
      : 'Stored source is authoritative. JSX and TSX are not evaluated in Phase 1.',
    {
      color: COLOR.muted,
      fontSize: 12,
      height: 18,
      name: 'Source document boundary',
      width: 720,
      x: 38,
      y: 574
    }
  )

  const created = [frame, ...store.graph.flattenTree(frame.id).map(({ node }) => node)].filter(
    (node, index, nodes) => nodes.findIndex((candidate) => candidate.id === node.id) === index
  )
  const snapshots = created.map((node) => structuredClone(node))
  store.undo.push({
    label: `Create ${options.format.toUpperCase()} source document`,
    forward: () => {
      restoreNodes(store, snapshots)
      store.select([frame.id])
      store.requestRender()
    },
    inverse: () => {
      store.graph.deleteNode(frame.id)
      store.select([...previousSelection])
      store.requestRender()
    }
  })
  store.select([frame.id])
  store.requestRender()
  return frame
}

function previewNode(store: EditorStore, owner: SceneNode): SceneNode | null {
  return (
    store.graph
      .flattenTree(owner.id)
      .map(({ node }) => node)
      .find((node) => hasKind(node, PREVIEW_KIND)) ?? null
  )
}

export function updateSourceDocument(store: EditorStore, nodeId: string, source: string): boolean {
  const document = sourceDocumentForNode(store.graph, nodeId)
  if (!document || document.source.source === source) return false

  const nextMetadata = {
    ...document.source,
    revision: document.source.revision + 1,
    source
  }
  const previousPluginData = structuredClone(document.node.pluginData)
  const nextPluginData = mergeContentSourcePluginData(document.node.pluginData, nextMetadata)
  const preview = previewNode(store, document.node)
  const previousPreview = preview?.text ?? ''
  const nextPreview = sourcePreview(source)

  const apply = (pluginData: SceneNode['pluginData'], previewText: string) => {
    store.graph.updateNode(document.node.id, { pluginData })
    if (preview) store.graph.updateNode(preview.id, { text: previewText })
    store.select([document.node.id])
    store.requestRender()
  }

  apply(nextPluginData, nextPreview)
  store.undo.push({
    label: `Update ${document.source.format.toUpperCase()} source`,
    forward: () => apply(nextPluginData, nextPreview),
    inverse: () => apply(previousPluginData, previousPreview)
  })
  return true
}

export function sourceDocumentViewportInsets() {
  return { bottom: 84, left: 430, right: 24, top: 44 }
}
