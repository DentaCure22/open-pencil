import type { UnknownRecord } from '@/app/automation/bridge/target'

export function trimmedString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key]
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

export function requiredString(record: UnknownRecord, key: string): string {
  const value = trimmedString(record, key)
  if (!value) throw new Error(`Missing "${key}".`)
  return value
}

export function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const resolved = value === undefined ? fallback : value
  if (typeof resolved !== 'number' || !Number.isFinite(resolved)) {
    throw new TypeError('Board tool numeric values must be finite.')
  }
  return Math.min(maximum, Math.max(minimum, resolved))
}
