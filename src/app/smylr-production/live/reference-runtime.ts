import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'
const LIVE_APP_FRAME_WIDTH = 1280
const LIVE_APP_FRAME_HEIGHT = 900
const LIVE_APP_FRAME_GAP = 120
const LIVE_APP_FRAME_ROW_GAP = 240
const REFERENCE_MODE = 'read-only'
const REFERENCE_KEYS = new Set([
  'kind',
  'pageId',
  'referenceBaseUrl',
  'referenceMode',
  'referenceRevision',
  'route',
  'state'
])

export type SmylrHistoricalReferenceInput = {
  baseUrl: string
  name?: string
  revision: string
  route: string
}

export type SmylrHistoricalReferenceResult = {
  created: boolean
  currentCreated: boolean
  currentFrame: SceneNode
  frame: SceneNode
}

type ReferenceFrameStore = Pick<EditorStore, 'graph' | 'requestRender'>

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

export function normalizeLocalReferenceBaseUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (url.protocol !== 'http:' || !isLoopback) return null
    return url.origin
  } catch {
    return null
  }
}

export function isSmylrReadOnlyReferenceFrame(node: SceneNode | null | undefined): boolean {
  if (!node || pluginValue(node, 'referenceMode') !== REFERENCE_MODE) return false
  return Boolean(
    pluginValue(node, 'referenceRevision') &&
    normalizeLocalReferenceBaseUrl(pluginValue(node, 'referenceBaseUrl') ?? '')
  )
}

export function smylrRuntimeBaseUrlForFrame(node: SceneNode, defaultBaseUrl: string): string {
  if (!isSmylrReadOnlyReferenceFrame(node)) return defaultBaseUrl
  return (
    normalizeLocalReferenceBaseUrl(pluginValue(node, 'referenceBaseUrl') ?? '') ?? defaultBaseUrl
  )
}

export function upsertSmylrHistoricalReferenceFrame(
  store: ReferenceFrameStore,
  pageId: string,
  input: SmylrHistoricalReferenceInput
): SmylrHistoricalReferenceResult {
  const baseUrl = normalizeLocalReferenceBaseUrl(input.baseUrl)
  if (!baseUrl) throw new Error('reference_base_url_must_be_local_http')

  const revision = input.revision.trim()
  const route = input.route.trim()
  if (!revision) throw new Error('reference_revision_required')
  if (!route.startsWith('/')) throw new Error('reference_route_must_be_absolute')

  const frames = store.graph.getChildren(pageId)
  let current = frames.find(
    (node) =>
      pluginValue(node, 'kind') === LIVE_APP_KIND && pluginValue(node, 'state') === 'current'
  )
  const currentCreated = !current
  if (!current) {
    const pageContent = frames.filter((node) => pluginValue(node, 'kind') !== LIVE_APP_KIND)
    const x = pageContent.length > 0 ? Math.min(...pageContent.map((node) => node.x)) : 96
    const y =
      pageContent.length > 0
        ? Math.min(...pageContent.map((node) => node.y)) -
          LIVE_APP_FRAME_HEIGHT -
          LIVE_APP_FRAME_ROW_GAP
        : 88
    const pageIdentity = route.replace(/^\/+|\/+$/g, '') || 'dental-chart'
    current = store.graph.createNode('FRAME', pageId, {
      x,
      y,
      width: LIVE_APP_FRAME_WIDTH,
      height: LIVE_APP_FRAME_HEIGHT,
      name: 'Dental Chart / Current',
      cornerRadius: 12,
      clipsContent: true,
      fills: [],
      strokes: [],
      pluginData: [
        pluginData('kind', LIVE_APP_KIND),
        pluginData('pageId', pageIdentity),
        pluginData('route', route),
        pluginData('state', 'current')
      ]
    })
  }

  const existing = store.graph
    .getChildren(pageId)
    .find(
      (node) =>
        pluginValue(node, 'kind') === LIVE_APP_KIND &&
        pluginValue(node, 'referenceRevision') === revision
    )
  const name = input.name?.trim() || `Reference · before fast merge · ${revision.slice(0, 8)}`
  const managedPluginData: SceneNode['pluginData'] = [
    pluginData('kind', LIVE_APP_KIND),
    pluginData('pageId', pluginValue(current, 'pageId') ?? 'dental-chart'),
    pluginData('route', route),
    pluginData('state', `reference-${revision.slice(0, 12)}`),
    pluginData('referenceMode', REFERENCE_MODE),
    pluginData('referenceRevision', revision),
    pluginData('referenceBaseUrl', baseUrl)
  ]

  if (existing) {
    store.graph.updateNode(existing.id, {
      name,
      pluginData: [
        ...existing.pluginData.filter(
          (entry) => entry.pluginId !== PLUGIN_ID || !REFERENCE_KEYS.has(entry.key)
        ),
        ...managedPluginData
      ]
    })
    store.requestRender()
    return {
      created: false,
      currentCreated,
      currentFrame: current,
      frame: store.graph.getNode(existing.id) ?? existing
    }
  }

  const frame = store.graph.createNode('FRAME', pageId, {
    x: current.x + current.width + LIVE_APP_FRAME_GAP,
    y: current.y,
    width: current.width,
    height: current.height,
    name,
    cornerRadius: current.cornerRadius,
    clipsContent: true,
    fills: [],
    strokes: [],
    pluginData: managedPluginData
  })
  store.requestRender()
  return { created: true, currentCreated, currentFrame: current, frame }
}
