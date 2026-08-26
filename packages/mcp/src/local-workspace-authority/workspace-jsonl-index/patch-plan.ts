import { nodePairs } from '#mcp/local-workspace-authority/mermaid-presence'

export type WorkspaceJsonlIndexPatchNode = {
  childIds?: unknown
  flipX?: unknown
  flipY?: unknown
  height?: unknown
  mermaidSource?: unknown
  name?: unknown
  parentId?: unknown
  pluginData?: unknown
  rotation?: unknown
  text?: unknown
  type?: unknown
  width?: unknown
  x?: unknown
  y?: unknown
}

type PatchRecordReference = {
  id: string
  parentId: string | null
}

type NodeDelta = { dx: number; dy: number }

export type WorkspaceJsonlIndexPatchPlan = Map<
  string,
  NodeDelta & { node: WorkspaceJsonlIndexPatchNode }
>

type WorkspaceJsonlIndexPatchPlanInput = {
  expectedRootId: string
  nextDocument: unknown
  previousDocument: unknown
  records: readonly PatchRecordReference[]
}

function nodeMap(document: unknown): Map<string, WorkspaceJsonlIndexPatchNode> | null {
  const pairs = nodePairs(document)
  return pairs ? new Map(pairs) : null
}

function documentRootId(document: unknown): string | null {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null
  const rootId = (document as { rootId?: unknown }).rootId
  return typeof rootId === 'string' ? rootId : null
}

function sameIdList(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

function structureEquals(
  previous: WorkspaceJsonlIndexPatchNode,
  next: WorkspaceJsonlIndexPatchNode
): boolean {
  return (
    previous.parentId === next.parentId &&
    previous.type === next.type &&
    previous.rotation === next.rotation &&
    previous.flipX === next.flipX &&
    previous.flipY === next.flipY &&
    sameIdList(previous.childIds, next.childIds)
  )
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function geometryChanged(
  previous: WorkspaceJsonlIndexPatchNode,
  next: WorkspaceJsonlIndexPatchNode
): boolean {
  return (
    finiteNumber(next.x) !== finiteNumber(previous.x) ||
    finiteNumber(next.y) !== finiteNumber(previous.y) ||
    finiteNumber(next.width) !== finiteNumber(previous.width) ||
    finiteNumber(next.height) !== finiteNumber(previous.height)
  )
}

function hasNonTranslationTransform(node: WorkspaceJsonlIndexPatchNode): boolean {
  const rotation = finiteNumber(node.rotation)
  return (rotation !== null && rotation !== 0) || node.flipX === true || node.flipY === true
}

function localDelta(
  previous: WorkspaceJsonlIndexPatchNode,
  next: WorkspaceJsonlIndexPatchNode
): NodeDelta {
  return {
    dx: (finiteNumber(next.x) ?? 0) - (finiteNumber(previous.x) ?? 0),
    dy: (finiteNumber(next.y) ?? 0) - (finiteNumber(previous.y) ?? 0)
  }
}

function nodeMaps(input: WorkspaceJsonlIndexPatchPlanInput): {
  next: Map<string, WorkspaceJsonlIndexPatchNode>
  previous: Map<string, WorkspaceJsonlIndexPatchNode>
} | null {
  const previous = nodeMap(input.previousDocument)
  const next = nodeMap(input.nextDocument)
  if (!previous || !next || documentRootId(input.nextDocument) !== input.expectedRootId) return null
  return { next, previous }
}

function recordsKeepStructure(
  records: readonly PatchRecordReference[],
  nodes: NonNullable<ReturnType<typeof nodeMaps>>
): boolean {
  return records.every((record) => {
    const previousNode = nodes.previous.get(record.id)
    const nextNode = nodes.next.get(record.id)
    return Boolean(previousNode && nextNode && structureEquals(previousNode, nextNode))
  })
}

function createNodeDeltaResolver(
  records: readonly PatchRecordReference[],
  nodes: NonNullable<ReturnType<typeof nodeMaps>>
): (id: string) => NodeDelta {
  const parentById = new Map(records.map((record) => [record.id, record.parentId] as const))
  const cache = new Map<string, NodeDelta>()

  const resolve = (id: string): NodeDelta => {
    const cached = cache.get(id)
    if (cached) return cached
    const previousNode = nodes.previous.get(id)
    const nextNode = nodes.next.get(id)
    if (!previousNode || !nextNode) return { dx: Number.NaN, dy: Number.NaN }
    if (
      geometryChanged(previousNode, nextNode) &&
      (hasNonTranslationTransform(previousNode) || hasNonTranslationTransform(nextNode))
    ) {
      const unsupported = { dx: Number.NaN, dy: Number.NaN }
      cache.set(id, unsupported)
      return unsupported
    }
    const local = localDelta(previousNode, nextNode)
    const parentId = parentById.get(id)
    const parent = parentId ? resolve(parentId) : { dx: 0, dy: 0 }
    const delta = { dx: local.dx + parent.dx, dy: local.dy + parent.dy }
    cache.set(id, delta)
    return delta
  }

  return resolve
}

export function planWorkspaceJsonlIndexPatch(
  input: WorkspaceJsonlIndexPatchPlanInput
): WorkspaceJsonlIndexPatchPlan | null {
  const nodes = nodeMaps(input)
  if (!nodes || !recordsKeepStructure(input.records, nodes)) return null
  const deltaFor = createNodeDeltaResolver(input.records, nodes)
  const plan: WorkspaceJsonlIndexPatchPlan = new Map()
  for (const record of input.records) {
    const node = nodes.next.get(record.id)
    if (!node) return null
    const delta = deltaFor(record.id)
    if (!Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) return null
    plan.set(record.id, { ...delta, node })
  }
  return plan
}
