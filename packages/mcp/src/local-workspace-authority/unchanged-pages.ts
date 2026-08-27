type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function nodeMap(value: unknown): Map<string, unknown> {
  if (!Array.isArray(value)) return new Map()
  const nodes = new Map<string, unknown>()
  for (const entry of value) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
    nodes.set(entry[0], entry[1])
  }
  return nodes
}

function childIdsOf(node: unknown): string[] {
  const ids = record(node)?.childIds
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string')
}

export function restoreUnchangedAuthorityPages(document: unknown, previous: unknown): unknown {
  const next = record(document)
  if (!next || !Array.isArray(next.retainedPageIds) || next.retainedPageIds.length === 0) {
    return document
  }
  const prev = record(previous)
  if (!prev || !Array.isArray(prev.nodes)) {
    throw new TypeError('Cannot reuse Board pages because the previous head has none')
  }
  const previousNodes = nodeMap(prev.nodes)
  const merged = nodeMap(next.nodes)
  for (const pageId of next.retainedPageIds) {
    if (typeof pageId !== 'string') {
      throw new TypeError('Cannot reuse Board pages because a retained page id is invalid')
    }
    const stack = [pageId]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const id = stack.pop()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const node = previousNodes.get(id)
      if (!node) {
        throw new TypeError(
          `Cannot reuse Board page "${pageId}" because the previous head is missing it`
        )
      }
      if (!merged.has(id)) merged.set(id, node)
      stack.push(...childIdsOf(node))
    }
  }
  const restored: JsonRecord = { ...next, nodes: [...merged] }
  delete restored.retainedPageIds
  return restored
}
