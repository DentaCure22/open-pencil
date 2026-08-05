import { createHash } from 'node:crypto'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Board request contains a non-finite number.')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'))
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) throw new TypeError('Board request must contain only plain JSON values.')
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key.normalize('NFC'), entry] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`
}

export function authorityMutationInputDigest(route: string, input: JsonRecord): string {
  return `sha256:${createHash('sha256').update(stableJson({ input, route })).digest('hex')}`
}
