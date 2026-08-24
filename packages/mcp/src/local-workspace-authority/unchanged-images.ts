type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

export function restoreUnchangedAuthorityImages(document: unknown, previous: unknown): unknown {
  const next = record(document)
  if (!next || next.imagesUnchanged !== true) return document
  const prev = record(previous)
  if (!prev || !Array.isArray(prev.images)) {
    throw new TypeError('Cannot reuse Board images because the previous head has none')
  }
  const restored = { ...next, images: prev.images }
  delete restored.imagesUnchanged
  return restored
}
