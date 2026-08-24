type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

export function nodePairs(value: unknown): Array<[string, JsonRecord]> | null {
  const document = record(value)
  if (!Array.isArray(document?.nodes)) return null
  const pairs: Array<[string, JsonRecord]> = []
  for (const entry of document.nodes) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') return null
    const node = record(entry[1])
    if (!node) return null
    pairs.push([entry[0], node])
  }
  return pairs
}

export function pluginValue(node: JsonRecord, key: string): string | null {
  if (!Array.isArray(node.pluginData)) return null
  for (const value of node.pluginData) {
    const entry = record(value)
    if (entry?.pluginId === 'open-pencil' && entry.key === key && typeof entry.value === 'string') {
      return entry.value
    }
  }
  return null
}

function mermaidFingerprint(value: unknown): string | null {
  const document = record(value)
  return typeof document?.mermaidFingerprint === 'string' ? document.mermaidFingerprint : null
}

export function documentMayNeedMermaidMaterialization(value: unknown, previous?: unknown): boolean {
  const document = record(value)
  if (document?.mermaidPresent === false) return false
  const nextPrint = mermaidFingerprint(value)
  const previousPrint = mermaidFingerprint(previous)
  if (nextPrint !== null && previousPrint !== null && nextPrint === previousPrint) return false
  if (document?.mermaidPresent === true) return true
  const pairs = nodePairs(value)
  if (!pairs) return false
  return pairs.some(([, node]) => {
    if (typeof node.mermaidSource === 'string') return true
    return pluginValue(node, 'mermaid/role') === 'diagram'
  })
}
