import { ALL_TOOLS, type ToolDef } from '@open-pencil/core/tools'

export const SEARCH_TOOLS_NAME = 'search_tools'
export const INVOKE_TOOL_NAME = 'invoke_tool'
export const DEFAULT_TOOL_SEARCH_LIMIT = 8
export const MAX_TOOL_SEARCH_LIMIT = 16

/** Always listed when tool search is on. Everything else is found, then invoked. */
export const ADVERTISED_BOARD_TOOL_NAMES = [
  'find_nodes',
  'get_node',
  'get_page_tree',
  'get_selection',
  'search_board_memory'
] as const

export type ToolSearchHit = {
  description: string
  mutates: boolean
  name: string
  params: string[]
}

const SEARCHABLE_TOOLS = ALL_TOOLS.filter(
  (tool) => tool.name !== SEARCH_TOOLS_NAME && tool.name !== INVOKE_TOOL_NAME
)

function normalizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1)
}

function scoreTool(tool: ToolDef, query: string, tokens: string[]): number {
  const name = tool.name.toLowerCase()
  const description = tool.description.toLowerCase()
  const haystack = `${name} ${description}`
  const folded = query.trim().toLowerCase()
  if (!folded) return 0
  if (name === folded) return 100
  if (name.startsWith(folded) || name.includes(folded.replace(/\s+/g, '_'))) return 80
  if (description.includes(folded)) return 50
  let score = 0
  for (const token of tokens) {
    if (name.includes(token)) score += 20
    else if (description.includes(token)) score += 8
    else if (!haystack.includes(token)) return 0
  }
  return score
}

export function searchOpenPencilTools(
  query: string,
  limit = DEFAULT_TOOL_SEARCH_LIMIT
): ToolSearchHit[] {
  const tokens = normalizeQuery(query)
  const folded = query.trim()
  if (!folded) return []
  const capped = Math.min(MAX_TOOL_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)))
  return SEARCHABLE_TOOLS.map((tool) => ({
    score: scoreTool(tool, folded, tokens),
    tool
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name)
    )
    .slice(0, capped)
    .map(({ tool }) => ({
      description: tool.description,
      mutates: tool.mutates === true,
      name: tool.name,
      params: Object.keys(tool.params)
    }))
}

export function findOpenPencilTool(name: string): ToolDef | undefined {
  const trimmed = name.trim()
  return SEARCHABLE_TOOLS.find((tool) => tool.name === trimmed)
}

export function advertisedToolSearchNames(): readonly string[] {
  return ADVERTISED_BOARD_TOOL_NAMES
}
