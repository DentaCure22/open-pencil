import type { FigmaNodeProxy } from '#core/figma-api'
import { defineTool, nodeToResult } from '#core/tools/schema'

export const getSelection = defineTool({
  name: 'get_selection',
  description: 'Get bounded details for up to 25 selected nodes. Child depth defaults to 0.',
  params: {
    depth: {
      type: 'number',
      description: 'Child depth per selected node. Default: 0, max: 2',
      min: 0,
      max: 2
    }
  },
  execute: (figma, { depth }) => {
    const selection = figma.currentPage.selection
    const limit = 25
    return {
      count: selection.length,
      limit,
      selection: selection
        .slice(0, limit)
        .map((node) => nodeToResult(node, Math.min(depth ?? 0, 2))),
      truncated: selection.length > limit
    }
  }
})

export const selectNodes = defineTool({
  name: 'select_nodes',
  mutates: true,
  description: 'Select one or more nodes by ID.',
  params: {
    ids: { type: 'string[]', description: 'Node IDs to select', required: true }
  },
  execute: (figma, { ids }) => {
    figma.currentPage.selection = ids
      .map((id) => figma.getNodeById(id))
      .filter((node): node is FigmaNodeProxy => node !== null)
    return { selected: ids }
  }
})
