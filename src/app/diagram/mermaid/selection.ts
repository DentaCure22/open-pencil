import type { SceneNode } from '@open-pencil/scene-graph'

export function isMermaidDiagramNode(node: SceneNode | undefined): boolean {
  return Boolean(node?.pluginData.some((entry) => entry.key === 'mermaid/diagram-id'))
}
