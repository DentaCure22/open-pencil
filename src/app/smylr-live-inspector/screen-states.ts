import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '../editor/session'
import {
  cloneSmylrSceneNodeIntoGraph,
  copySmylrLiveContainerGraphResources,
  smylrLiveContainerToSceneGraph
} from '../smylr-live-container'
import type { SmylrLiveContainerDocument } from '../smylr-live-container/types'
import { findCurrentSmylrLiveAppFrame } from '../smylr-production/workspace'

const PLUGIN_ID = 'smylr-screen-state'
const STATE_KEY = 'state'

export const DENTAL_CHART_SCREEN_STATES = [
  { id: 'exam-setup', label: 'Dental Chart / Exam setup' },
  { id: 'active-charting', label: 'Dental Chart / Active charting' },
  { id: 'review', label: 'Dental Chart / Review' }
] as const

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function stateId(node: SceneNode) {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === STATE_KEY)
    ?.value
}

/**
 * Materialize production-derived screen states as ordinary Open Pencil nodes.
 * These are editable scene-graph snapshots, not additional app runtimes.
 */
export function ensureDentalChartNativeScreenStates(
  store: EditorStore,
  document: SmylrLiveContainerDocument
): string[] {
  const route = document.route.replace(/\/+$/, '')
  if (route !== '/dental-chart' && route !== 'dental-chart') return []

  const liveFrame = findCurrentSmylrLiveAppFrame(store)
  if (!liveFrame) return []
  const pageId = store.state.currentPageId
  const existing = new Map(
    store.graph
      .getChildren(pageId)
      .map((node) => [stateId(node), node] as const)
      .filter((entry): entry is [string, SceneNode] => Boolean(entry[0]))
  )
  if (DENTAL_CHART_SCREEN_STATES.every((state) => existing.has(state.id))) {
    return DENTAL_CHART_SCREEN_STATES.flatMap((state) => {
      const node = existing.get(state.id)
      return node ? [node.id] : []
    })
  }

  const source = smylrLiveContainerToSceneGraph(document)
  const sourcePage = source.getPages()[0]
  const sourceRoot = sourcePage ? source.getChildren(sourcePage.id)[0] : null
  if (!sourceRoot) return []
  copySmylrLiveContainerGraphResources(source, store.graph)

  const gap = 120
  const ids: string[] = []
  DENTAL_CHART_SCREEN_STATES.forEach((state, index) => {
    const prior = existing.get(state.id)
    if (prior) {
      ids.push(prior.id)
      return
    }
    const node = cloneSmylrSceneNodeIntoGraph(source, sourceRoot, store.graph, pageId)
    store.graph.updateNode(node.id, {
      name: state.label,
      x: liveFrame.x + (index + 1) * (liveFrame.width + gap),
      y: liveFrame.y,
      pluginData: [
        ...node.pluginData,
        pluginData(STATE_KEY, state.id),
        pluginData('kind', 'production-snapshot'),
        pluginData('route', document.route)
      ]
    })
    ids.push(node.id)
  })

  computeAllLayouts(store.graph, pageId)
  // Route mutations through the editor selection path so canvas/Layers refresh.
  // Keep the primary live tile as the visual anchor; materializing alternate
  // states must not replace the page-switch camera with a whole-flow fit.
  store.select([liveFrame.id])
  return ids
}
