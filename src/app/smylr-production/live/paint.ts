import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'

function isLiveAppFrame(node: SceneNode) {
  return node.pluginData.some(
    (entry) => entry.pluginId === PLUGIN_ID && entry.key === 'kind' && entry.value === LIVE_APP_KIND
  )
}

/**
 * Live app frames are geometry anchors. The DOM runtime owns their visible
 * surface, so persisted native paint would render a second frame underneath.
 */
export function clearLiveFrameScenePaint(graph: SceneGraph, frame: SceneNode): boolean {
  if (!isLiveAppFrame(frame)) return false
  if (frame.effects.length === 0 && frame.fills.length === 0 && frame.strokes.length === 0) {
    return false
  }

  graph.updateNode(frame.id, { effects: [], fills: [], strokes: [] })
  return true
}
