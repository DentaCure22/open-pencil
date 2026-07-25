import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { DesignDocumentSource, DesignElement, DesignText } from './types'

export const DOM_CSS_PLUGIN_ID = 'open-pencil-dom-css'
export const SOURCE_ID_KEY = 'source-id'
export const SOURCE_TAG_KEY = 'source-tag'
export const SOURCE_COMPONENT_KEY = 'source-component'
export const SOURCE_INTERACTIONS_KEY = 'source-interactions'
export const SOURCE_STATE_BINDINGS_KEY = 'source-state-bindings'
export const SOURCE_BASELINE_KEY = 'source-baseline'
export const SOURCE_STATUS_KEY = 'source-status'
export const DOCUMENT_SOURCE_KEY = 'document-source'

function entry(key: string, value: string): PluginDataEntry {
  return { pluginId: DOM_CSS_PLUGIN_ID, key, value }
}

function withoutSourceMetadata(pluginData: PluginDataEntry[]): PluginDataEntry[] {
  const sourceKeys = new Set([
    SOURCE_ID_KEY,
    SOURCE_TAG_KEY,
    SOURCE_COMPONENT_KEY,
    SOURCE_INTERACTIONS_KEY,
    SOURCE_STATE_BINDINGS_KEY,
    SOURCE_BASELINE_KEY,
    SOURCE_STATUS_KEY
  ])
  return pluginData.filter(
    (item) => item.pluginId !== DOM_CSS_PLUGIN_ID || !sourceKeys.has(item.key)
  )
}

function jsonEntry(key: string, value: unknown): PluginDataEntry {
  return entry(key, JSON.stringify(value))
}

export function sourceControlledSnapshot(node: SceneNode): Record<string, unknown> {
  const {
    id: _id,
    type: _type,
    parentId: _parentId,
    childIds: _childIds,
    pluginData: _pluginData,
    source: _source,
    overrides: _overrides,
    boundVariables: _boundVariables,
    ...controlled
  } = node
  return structuredClone(controlled)
}

function applySourceMetadata(
  node: SceneNode,
  source: Pick<DesignElement, 'sourceId' | 'sourceComponent'>,
  tagName: string,
  interactions?: DesignElement['interactions'],
  stateBindings?: DesignElement['stateBindings']
): void {
  if (!source.sourceId) return
  const metadata = [
    entry(SOURCE_ID_KEY, source.sourceId),
    entry(SOURCE_TAG_KEY, tagName),
    entry(SOURCE_STATUS_KEY, 'current')
  ]
  if (source.sourceComponent) metadata.push(entry(SOURCE_COMPONENT_KEY, source.sourceComponent))
  if (interactions?.length) {
    metadata.push(jsonEntry(SOURCE_INTERACTIONS_KEY, interactions))
  }
  if (stateBindings?.length) {
    metadata.push(jsonEntry(SOURCE_STATE_BINDINGS_KEY, stateBindings))
  }
  metadata.push(jsonEntry(SOURCE_BASELINE_KEY, sourceControlledSnapshot(node)))
  node.pluginData = [...withoutSourceMetadata(node.pluginData), ...metadata]
}

export function applyElementSourceMetadata(node: SceneNode, element: DesignElement): void {
  applySourceMetadata(node, element, element.tagName, element.interactions, element.stateBindings)
}

export function applyTextSourceMetadata(node: SceneNode, text: DesignText): void {
  applySourceMetadata(node, text, '#text')
}

export function refreshSourceBaselines(graph: SceneGraph): void {
  for (const node of graph.getAllNodes()) {
    if (!sourceIdForNode(node)) continue
    node.pluginData = [
      ...node.pluginData.filter(
        (item) => item.pluginId !== DOM_CSS_PLUGIN_ID || item.key !== SOURCE_BASELINE_KEY
      ),
      jsonEntry(SOURCE_BASELINE_KEY, sourceControlledSnapshot(node))
    ]
  }
}

export function applyDocumentSourceMetadata(
  node: SceneNode,
  source: DesignDocumentSource | undefined
): void {
  if (!source) return
  node.pluginData = [
    ...node.pluginData.filter(
      (item) => item.pluginId !== DOM_CSS_PLUGIN_ID || item.key !== DOCUMENT_SOURCE_KEY
    ),
    jsonEntry(DOCUMENT_SOURCE_KEY, source),
    ...contentSourcePluginData({
      format: source.kind === 'react' ? 'tsx' : source.kind,
      mimeType: source.kind === 'react' ? 'text/tsx' : 'text/html',
      fileName: null,
      revision: CONTENT_SOURCE_REVISION,
      source: source.code
    })
  ]
}

function valueFor(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  return (
    node.pluginData.find((item) => item.pluginId === DOM_CSS_PLUGIN_ID && item.key === key)
      ?.value ?? null
  )
}

export function sourceIdForNode(node: Pick<SceneNode, 'pluginData'>): string | null {
  return valueFor(node, SOURCE_ID_KEY)
}

function isSourceSnapshot(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sourceBaselineForNode(
  node: Pick<SceneNode, 'pluginData'>
): Record<string, unknown> | null {
  const value = valueFor(node, SOURCE_BASELINE_KEY)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return isSourceSnapshot(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function sourceStateBindingsForNode(
  node: Pick<SceneNode, 'pluginData'>
): Array<{ field: string; stateIndex: number }> {
  const value = valueFor(node, SOURCE_STATE_BINDINGS_KEY)
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (binding): binding is { field: string; stateIndex: number } =>
        typeof binding === 'object' &&
        binding !== null &&
        typeof (binding as { field?: unknown }).field === 'string' &&
        Number.isSafeInteger((binding as { stateIndex?: unknown }).stateIndex)
    )
  } catch {
    return []
  }
}

export function replaceElementSourceMetadata(
  current: SceneNode,
  desired: SceneNode,
  status: 'current' | 'conflict' | 'detached'
): PluginDataEntry[] {
  const sourceEntries = desired.pluginData.filter(
    (item) => item.pluginId === DOM_CSS_PLUGIN_ID && item.key !== SOURCE_STATUS_KEY
  )
  return [
    ...withoutSourceMetadata(current.pluginData),
    ...sourceEntries,
    entry(SOURCE_STATUS_KEY, status)
  ]
}

export function replaceSourceStatus(
  node: Pick<SceneNode, 'pluginData'>,
  status: 'current' | 'conflict' | 'detached'
): PluginDataEntry[] {
  return [
    ...node.pluginData.filter(
      (item) => item.pluginId !== DOM_CSS_PLUGIN_ID || item.key !== SOURCE_STATUS_KEY
    ),
    entry(SOURCE_STATUS_KEY, status)
  ]
}

export function replaceDocumentSourceMetadata(
  current: Pick<SceneNode, 'pluginData'>,
  desired: Pick<SceneNode, 'pluginData'>
): PluginDataEntry[] {
  const isDocumentSourceEntry = (item: PluginDataEntry) =>
    (item.pluginId === DOM_CSS_PLUGIN_ID && item.key === DOCUMENT_SOURCE_KEY) ||
    (item.pluginId === 'open-pencil' && item.key.startsWith('content-source/'))
  return [
    ...current.pluginData.filter((item) => !isDocumentSourceEntry(item)),
    ...desired.pluginData.filter(isDocumentSourceEntry)
  ]
}

export function hasReactDocumentSource(node: Pick<SceneNode, 'pluginData'>): boolean {
  const value = valueFor(node, DOCUMENT_SOURCE_KEY)
  if (!value) return false
  try {
    const parsed = JSON.parse(value) as { kind?: unknown }
    return parsed.kind === 'react'
  } catch {
    return false
  }
}
