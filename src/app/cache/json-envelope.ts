export type JsonCacheEnvelope<T> = {
  updatedAt: number
  value: T
}

function isFresh(updatedAt: number, maxAgeMs?: number): boolean {
  return maxAgeMs === undefined || Date.now() - updatedAt <= maxAgeMs
}

export function parseJsonEnvelope<T>(raw: string, maxAgeMs?: number): JsonCacheEnvelope<T> | null {
  try {
    const envelope = JSON.parse(raw) as Partial<JsonCacheEnvelope<T>>
    if (typeof envelope.updatedAt !== 'number' || !('value' in envelope)) return null
    if (!isFresh(envelope.updatedAt, maxAgeMs)) return null
    return { updatedAt: envelope.updatedAt, value: envelope.value as T }
  } catch {
    return null
  }
}

export function coerceIndexedDbJsonValue<T>(
  stored: unknown,
  maxAgeMs?: number
): JsonCacheEnvelope<T> | null {
  if (stored && typeof stored === 'object' && 'value' in stored) {
    const envelope = stored as Partial<JsonCacheEnvelope<T>>
    if (typeof envelope.updatedAt === 'number') {
      if (!isFresh(envelope.updatedAt, maxAgeMs)) return null
      return { updatedAt: envelope.updatedAt, value: envelope.value as T }
    }
    return { updatedAt: 0, value: envelope.value as T }
  }

  if (typeof stored === 'string') return { updatedAt: 0, value: stored as T }
  return null
}
