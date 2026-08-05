import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import type { MermaidSceneSpec } from './types'

const MERMAID_DIAGRAM_ID_KEY = 'mermaid/diagram-id'
const MERMAID_ROLE_KEY = 'mermaid/role'

const MERMAID_KIND_NAMES: Record<string, string> = {
  architecture: 'Architecture',
  'architecture-beta': 'Architecture',
  block: 'Block',
  c4context: 'C4',
  c4container: 'C4',
  c4component: 'C4',
  c4deployment: 'C4',
  c4dynamic: 'C4',
  classdiagram: 'Class',
  erdiagram: 'Entity relationship',
  flowchart: 'Flowchart',
  graph: 'Flowchart',
  gantt: 'Gantt',
  gitgraph: 'Git graph',
  journey: 'User journey',
  ishikawa: 'Ishikawa',
  kanban: 'Kanban',
  mindmap: 'Mindmap',
  packet: 'Packet',
  pie: 'Pie',
  quadrantchart: 'Quadrant',
  'radar-beta': 'Radar',
  radarchart: 'Radar',
  requirementdiagram: 'Requirement',
  sankey: 'Sankey',
  'sankey-beta': 'Sankey',
  sequencediagram: 'Sequence',
  statediagram: 'State',
  'statediagram-v2': 'State',
  timeline: 'Timeline',
  treeview: 'Tree view',
  'treemap-beta': 'Treemap',
  treemap: 'Treemap',
  venn: 'Venn',
  xychart: 'XY chart',
  'xychart-beta': 'XY chart'
}

export function mermaidDiagramName(source: string): string {
  const lines = source.split(/\r?\n/u).map((line) => line.trim())
  const frontmatter = lines[0] === '---'
  const declaration = lines.find((line, index) => {
    if (!line || line.startsWith('%%')) return false
    if (!frontmatter) return true
    const closingFrontmatter = lines.indexOf('---', 1)
    return closingFrontmatter !== -1 && index > closingFrontmatter
  })
  const kind = declaration?.split(/\s+/u)[0]?.toLowerCase() ?? ''
  return `Mermaid · ${MERMAID_KIND_NAMES[kind] ?? 'Diagram'}`
}

export function isMermaidDiagramContainer(node: SceneNode | undefined): boolean {
  return Boolean(
    node &&
    (node.type === 'GROUP' || node.type === 'FRAME') &&
    !node.pluginData.some(
      (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/semantic-id'
    ) &&
    node.pluginData.some(
      (entry) =>
        entry.pluginId === 'open-pencil' &&
        entry.key === MERMAID_ROLE_KEY &&
        entry.value === 'diagram'
    )
  )
}

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
    },
    {
      pluginId: 'open-pencil',
      key: 'mermaid/appearance',
      value: diagram.appearance
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
      key: MERMAID_DIAGRAM_ID_KEY,
      value: diagramId
    },
    ...mermaidSourcePluginData(diagram)
  ]
}

export function mermaidDiagramOwnerPluginData(
  diagramId: string,
  diagram: MermaidSceneSpec
): PluginDataEntry[] {
  return [
    ...mermaidDiagramPluginData(diagramId, diagram),
    { pluginId: 'open-pencil', key: MERMAID_ROLE_KEY, value: 'diagram' }
  ]
}
