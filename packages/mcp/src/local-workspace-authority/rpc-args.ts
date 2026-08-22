type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeAuthorityRpcArgs(body: JsonRecord): JsonRecord {
  const args = isRecord(body.args) ? body.args : {}
  if (!isRecord(args.base)) return args
  const { base, ...logical } = args
  return { ...base, ...logical }
}
