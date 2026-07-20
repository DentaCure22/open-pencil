import type { PluginDataEntry } from '@open-pencil/scene-graph'

import type { MermaidSceneSpec } from './types'

export function mermaidSourcePluginData(diagram: MermaidSceneSpec): PluginDataEntry[] {
  return [
    {
      pluginId: 'open-pencil',
      key: 'mermaid/source',
      value: diagram.source
    },
    {
      pluginId: 'open-pencil',
      key: 'mermaid/revision',
      value: String(diagram.revision)
    },
    {
      pluginId: 'open-pencil',
      key: 'mermaid/parser',
      value: diagram.parser
    }
  ]
}

export function mermaidDiagramPluginData(
  diagramId: string,
  diagram: MermaidSceneSpec
): PluginDataEntry[] {
  return [
    {
      pluginId: 'open-pencil',
      key: 'mermaid/diagram-id',
      value: diagramId
    },
    ...mermaidSourcePluginData(diagram)
  ]
}
