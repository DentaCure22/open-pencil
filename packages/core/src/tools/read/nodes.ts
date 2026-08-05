import type { FigmaNodeProxy } from '#core/figma-api'
import { defineTool, nodeSummary, nodeToResult } from '#core/tools/schema'

interface TreeEntry {
  id: string
  type: string
  name: string
  w: number
  h: number
  children?: TreeEntry[]
}

function nodeToTreeEntry(
  node: FigmaNodeProxy,
  level: number,
  maxDepth?: number,
  typeFilter?: Set<string>
): TreeEntry | null {
  const children: TreeEntry[] = []
  if ((maxDepth === undefined || level < maxDepth) && node.children.length > 0) {
    for (const child of node.children) {
      const entry = nodeToTreeEntry(child, level + 1, maxDepth, typeFilter)
      if (entry) children.push(entry)
    }
  }

  const matches = !typeFilter || typeFilter.has(node.type)
  if (!matches && children.length === 0) return null

  const entry: TreeEntry = {
    id: node.id,
    type: node.type,
    name: node.name,
    w: node.width,
    h: node.height
  }
  if (children.length > 0) entry.children = children
  return entry
}

export const getPageTree = defineTool({
  name: 'get_page_tree',
  description:
    'Get the node tree of the current page. Returns lightweight hierarchy: id, type, name, size. Use depth, root_id, or node_types to keep large pages small. Use get_node for full properties of a specific node.',
  params: {
    depth: {
      type: 'number',
      description: 'Max nesting depth to return (1 = returned root nodes only). Default: 2, max: 5',
      min: 1,
      max: 5
    },
    root_id: {
      type: 'string',
      description: 'Return only this node subtree instead of the whole current page'
    },
    node_types: {
      type: 'string[]',
      description: 'Keep only these node types and their ancestors, for example FRAME or TEXT'
    }
  },
  execute: (figma, { depth, root_id, node_types }) => {
    const boundedDepth = Math.min(depth ?? 2, 5)
    const typeFilter = node_types && node_types.length > 0 ? new Set(node_types) : undefined

    if (root_id !== undefined) {
      const root = figma.getNodeById(root_id)
      if (!root) return { error: `Node "${root_id}" not found` }
      return { root: root.id, tree: nodeToTreeEntry(root, 1, boundedDepth, typeFilter) }
    }

    const page = figma.currentPage
    const children: TreeEntry[] = []
    for (const child of page.children) {
      const entry = nodeToTreeEntry(child, 1, boundedDepth, typeFilter)
      if (entry) children.push(entry)
    }
    return { page: page.name, children }
  }
})

export const getNode = defineTool({
  name: 'get_node',
  description:
    'Get bounded detailed properties of one node. Depth defaults to 0 and is capped at 3; use another exact call for deeper context.',
  params: {
    id: { type: 'string', description: 'Node ID', required: true },
    depth: {
      type: 'number',
      description: 'Max depth of children to include (0 = no children). Default: 0, max: 3',
      min: 0,
      max: 3
    }
  },
  execute: (figma, { id, depth }) => {
    const node = figma.getNodeById(id)
    if (!node) return { error: `Node "${id}" not found` }
    return nodeToResult(node, Math.min(depth ?? 0, 3))
  }
})

export const findNodes = defineTool({
  name: 'find_nodes',
  description: 'Find nodes by name pattern and/or type.',
  params: {
    name: { type: 'string', description: 'Name substring to match (case-insensitive)' },
    limit: {
      type: 'number',
      description: 'Maximum summaries to return. Default: 25, max: 100',
      min: 1,
      max: 100
    },
    type: {
      type: 'string',
      description: 'Node type filter',
      enum: [
        'FRAME',
        'RECTANGLE',
        'ELLIPSE',
        'TEXT',
        'LINE',
        'STAR',
        'POLYGON',
        'SECTION',
        'GROUP',
        'COMPONENT',
        'INSTANCE',
        'VECTOR'
      ]
    }
  },
  execute: (figma, args) => {
    const page = figma.currentPage
    const matches = page.findAll((node) => {
      if (args.type && node.type !== args.type) return false
      if (args.name && !node.name.toLowerCase().includes(args.name.toLowerCase())) return false
      return true
    })
    const limit = Math.min(args.limit ?? 25, 100)
    return {
      count: matches.length,
      limit,
      nodes: matches.slice(0, limit).map(nodeSummary),
      truncated: matches.length > limit
    }
  }
})
