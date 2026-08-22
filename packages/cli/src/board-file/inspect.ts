import { readFile } from 'node:fs/promises'

export const MAX_GET_NODES = 12
export const MAX_LS_ROWS = 64
export const DEFAULT_NEARBY_ROWS = 8
export const MAX_NEARBY_ROWS = 20
export const TRUNCATE_STRING_CHARS = 2000
export const TRUNCATE_LIST_BYTES = 4000

export const WORKSPACE_GET_CONTRACT = 'workspace-get/v1'
export const WORKSPACE_LS_CONTRACT = 'workspace-ls/v1'
export const WORKSPACE_NEARBY_CONTRACT = 'workspace-nearby/v1'

type JsonRecord = Record<string, unknown>

export type SlimUnit = {
  childCount: number
  height: number
  id: string
  name: string
  type: string
  width: number
  x: number
  y: number
}

export type GetNodeResult = {
  id: string
  node: unknown
  parentId: string | null
  truncated: string[]
}

export type WorkspaceGetResult = {
  contract: typeof WORKSPACE_GET_CONTRACT
  missing: string[]
  nodes: GetNodeResult[]
}

export type WorkspaceLsResult = {
  container: SlimUnit
  contract: typeof WORKSPACE_LS_CONTRACT
  omitted: number
  units: SlimUnit[]
}

export type WorkspaceNearbyResult = {
  around: SlimUnit
  contract: typeof WORKSPACE_NEARBY_CONTRACT
  omitted: number
  units: SlimUnit[]
}

type LoadedWorkspace = {
  nodes: Map<string, JsonRecord>
  parentOf: Map<string, string>
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as JsonRecord
}

export function parseIdList(raw: readonly string[]): string[] {
  const ids = raw
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  const unique = [...new Set(ids)]
  if (unique.length === 0) throw new Error('Pass at least one object id.')
  if (unique.length > MAX_GET_NODES) {
    throw new Error(`Request at most ${String(MAX_GET_NODES)} nodes at a time.`)
  }
  return unique
}

export function parseRowLimit(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`--limit must be an integer from 1 to ${String(max)}.`)
  }
  return parsed
}

function truncateNode(value: unknown, path: string, truncated: string[]): unknown {
  if (typeof value === 'string') {
    if (value.length > TRUNCATE_STRING_CHARS) {
      truncated.push(path)
      return `[truncated ${String(value.length)} chars — rerun with --full for complete content]`
    }
    return value
  }
  if (Array.isArray(value)) {
    if (JSON.stringify(value).length > TRUNCATE_LIST_BYTES && path.endsWith('.pluginData')) {
      truncated.push(path)
      return `[truncated pluginData, ${String(JSON.stringify(value).length)} bytes — rerun with --full]`
    }
    return value.map((item, index) => truncateNode(item, `${path}[${String(index)}]`, truncated))
  }
  if (value && typeof value === 'object') {
    const out: JsonRecord = {}
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      out[key] = truncateNode(child, `${path}.${key}`, truncated)
    }
    return out
  }
  return value
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function slimUnit(id: string, node: JsonRecord): SlimUnit | undefined {
  const x = finiteNumber(node.x)
  const y = finiteNumber(node.y)
  const width = finiteNumber(node.width)
  const height = finiteNumber(node.height)
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined
  }
  if (width <= 0 || height <= 0) return undefined
  return {
    childCount: Array.isArray(node.childIds) ? node.childIds.length : 0,
    height,
    id,
    name: typeof node.name === 'string' && node.name ? node.name : id,
    type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
    width,
    x,
    y
  }
}

function centerDistance(first: SlimUnit, second: SlimUnit): number {
  return Math.hypot(
    second.x + second.width / 2 - (first.x + first.width / 2),
    second.y + second.height / 2 - (first.y + first.height / 2)
  )
}

export async function loadWorkspace(workspacePath: string): Promise<LoadedWorkspace> {
  let document: JsonRecord
  try {
    document = record(JSON.parse(await readFile(workspacePath, 'utf8')), 'Workspace')
  } catch (error) {
    throw new Error(
      `Could not read workspace file: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!Array.isArray(document.nodes)) throw new Error('workspace.json has no nodes array.')

  const nodes = new Map<string, JsonRecord>()
  const parentOf = new Map<string, string>()
  for (const [index, pair] of document.nodes.entries()) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string') {
      throw new TypeError(`Workspace node entry ${String(index)} is invalid`)
    }
    const node = record(pair[1], `Workspace node ${pair[0]}`)
    nodes.set(pair[0], node)
    if (typeof node.parentId === 'string' && node.parentId) parentOf.set(pair[0], node.parentId)
    if (!Array.isArray(node.childIds)) continue
    for (const childId of node.childIds) {
      if (typeof childId === 'string') parentOf.set(childId, pair[0])
    }
  }
  return { nodes, parentOf }
}

export function getWorkspaceNodes(
  workspace: LoadedWorkspace,
  nodeIds: readonly string[],
  full = false
): WorkspaceGetResult {
  const nodes: GetNodeResult[] = []
  const missing: string[] = []
  for (const id of nodeIds) {
    const node = workspace.nodes.get(id)
    if (!node) {
      missing.push(id)
      continue
    }
    const truncated: string[] = []
    nodes.push({
      id,
      node: full ? node : truncateNode(node, id, truncated),
      parentId:
        workspace.parentOf.get(id) ?? (typeof node.parentId === 'string' ? node.parentId : null),
      truncated
    })
  }
  return { contract: WORKSPACE_GET_CONTRACT, missing, nodes }
}

function containerUnit(id: string, node: JsonRecord): SlimUnit {
  return (
    slimUnit(id, node) ?? {
      childCount: Array.isArray(node.childIds) ? node.childIds.length : 0,
      height: 0,
      id,
      name: typeof node.name === 'string' && node.name ? node.name : id,
      type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
      width: 0,
      x: 0,
      y: 0
    }
  )
}

function childUnits(workspace: LoadedWorkspace, containerId: string): SlimUnit[] {
  const container = workspace.nodes.get(containerId)
  if (!container) throw new Error(`missing:${containerId}`)
  if (!Array.isArray(container.childIds)) {
    throw new TypeError(`container:${containerId} requires childIds`)
  }
  return container.childIds.flatMap((value) => {
    if (typeof value !== 'string') return []
    const node = workspace.nodes.get(value)
    if (!node) return []
    const unit = slimUnit(value, node)
    return unit ? [unit] : []
  })
}

export function listWorkspaceChildren(
  workspace: LoadedWorkspace,
  containerId: string,
  limit = MAX_LS_ROWS
): WorkspaceLsResult {
  const container = workspace.nodes.get(containerId)
  if (!container) throw new Error(`missing:${containerId}`)
  const units = childUnits(workspace, containerId)
  const only = units[0]
  if (container.type === 'CANVAS' && units.length === 1 && only && only.childCount > 0) {
    return listWorkspaceChildren(workspace, only.id, limit)
  }
  return {
    container: containerUnit(containerId, container),
    contract: WORKSPACE_LS_CONTRACT,
    omitted: Math.max(0, units.length - limit),
    units: units.slice(0, limit)
  }
}

export function nearbyWorkspaceUnits(
  workspace: LoadedWorkspace,
  nodeId: string,
  limit = DEFAULT_NEARBY_ROWS
): WorkspaceNearbyResult {
  const node = workspace.nodes.get(nodeId)
  if (!node) throw new Error(`missing:${nodeId}`)
  const around = slimUnit(nodeId, node)
  if (!around) throw new Error(`missing-geometry:${nodeId}`)

  const parentId = workspace.parentOf.get(nodeId)
  if (!parentId) {
    if (!Array.isArray(node.childIds)) {
      return { around, contract: WORKSPACE_NEARBY_CONTRACT, omitted: 0, units: [around] }
    }
    const children = childUnits(workspace, nodeId)
    const ranked = [...children].sort(
      (left, right) => centerDistance(around, left) - centerDistance(around, right)
    )
    const units = [around, ...ranked.filter((unit) => unit.id !== nodeId)].slice(0, limit + 1)
    return {
      around,
      contract: WORKSPACE_NEARBY_CONTRACT,
      omitted: Math.max(0, children.length - (units.length - 1)),
      units
    }
  }

  const siblings = childUnits(workspace, parentId)
  const ranked = siblings
    .filter((unit) => unit.id !== nodeId)
    .sort((left, right) => centerDistance(around, left) - centerDistance(around, right))
  const units = [around, ...ranked.slice(0, limit)]
  return {
    around,
    contract: WORKSPACE_NEARBY_CONTRACT,
    omitted: Math.max(0, ranked.length - limit),
    units
  }
}
