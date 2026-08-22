import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

export function pluginDataEntry(pluginId: string, key: string, value: string): PluginDataEntry {
  return { key, pluginId, value }
}

export function pluginDataValues(
  node: Pick<SceneNode, 'pluginData'>,
  pluginId: string
): ReadonlyMap<string, string> {
  const values = new Map<string, string>()
  for (const item of node.pluginData) {
    if (item.pluginId === pluginId) values.set(item.key, item.value)
  }
  return values
}
