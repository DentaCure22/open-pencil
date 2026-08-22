import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const ANTIGRAVITY_CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/
const NODE_SQLITE_SPECIFIER = ['node', 'sqlite'].join(':')

export type AntigravityTokenUsage = {
  cacheRead: number
  generation: number
  input: number
  output: number
  reasoning: number
}

export type AntigravityUsageCursor = {
  conversationId: string | null
  maxGenerationIndex: number
}

export type AntigravitySqlStatement = {
  all(...parameters: unknown[]): unknown[]
  get(...parameters: unknown[]): unknown
}

export type AntigravitySqlDatabase = {
  close(): void
  prepare(sql: string): AntigravitySqlStatement
}

export type AntigravityUsageReaderOptions = {
  conversationsDirectory?: string
  openDatabase?: (databasePath: string) => Promise<AntigravitySqlDatabase | null>
  sessionMapPath?: string
}

type SessionMapping = {
  conversationId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function safeInteger(value: unknown): number | null {
  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function defaultPaths(): Required<
  Pick<AntigravityUsageReaderOptions, 'conversationsDirectory' | 'sessionMapPath'>
> {
  const home = homedir()
  return {
    conversationsDirectory: path.join(home, '.gemini', 'antigravity-cli', 'conversations'),
    sessionMapPath: path.join(home, '.pi', 'agent', 'antigravity-bridge', 'sessions.json')
  }
}

async function defaultOpenDatabase(databasePath: string): Promise<AntigravitySqlDatabase | null> {
  try {
    const sqliteModule: unknown = await import(NODE_SQLITE_SPECIFIER)
    if (!isRecord(sqliteModule) || typeof sqliteModule.DatabaseSync !== 'function') return null
    const DatabaseSync = sqliteModule.DatabaseSync as new (
      filename: string,
      options: { readOnly: boolean }
    ) => AntigravitySqlDatabase
    return new DatabaseSync(databasePath, { readOnly: true })
  } catch {
    return null
  }
}

async function readSessionMapping(
  sessionIds: readonly string[],
  sessionMapPath: string
): Promise<SessionMapping | null | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(sessionMapPath, 'utf8')) as unknown
  } catch (error) {
    return isMissingFile(error) ? null : undefined
  }
  if (!isRecord(parsed)) return undefined
  for (const sessionId of sessionIds) {
    const value = parsed[`sid:${sessionId}`]
    if (!isRecord(value) || typeof value.conversationId !== 'string') continue
    if (!ANTIGRAVITY_CONVERSATION_ID.test(value.conversationId)) return undefined
    return { conversationId: value.conversationId }
  }
  return null
}

class ProtoReader {
  private cursor = 0

  constructor(private readonly data: Uint8Array) {}

  readVarint(): number | undefined {
    let result = 0n
    let shift = 0n
    while (this.cursor < this.data.length && shift < 64n) {
      const byte = this.data[this.cursor]
      this.cursor += 1
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) {
        return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : undefined
      }
      shift += 7n
    }
    return undefined
  }

  nextTag(): { field: number; wireType: number } | undefined {
    const key = this.readVarint()
    if (key === undefined) return undefined
    return { field: Math.floor(key / 8), wireType: key & 0x07 }
  }

  readBytes(): Uint8Array | undefined {
    const length = this.readVarint()
    if (length === undefined || length > this.data.length - this.cursor) return undefined
    const bytes = this.data.subarray(this.cursor, this.cursor + length)
    this.cursor += length
    return bytes
  }

  skip(wireType: number): boolean {
    if (wireType === 0) return this.readVarint() !== undefined
    if (wireType === 1) return this.advance(8)
    if (wireType === 2) {
      const length = this.readVarint()
      return length !== undefined && this.advance(length)
    }
    if (wireType === 5) return this.advance(4)
    return false
  }

  private advance(length: number): boolean {
    if (length > this.data.length - this.cursor) return false
    this.cursor += length
    return true
  }
}

function emptyUsage(): AntigravityTokenUsage {
  return { cacheRead: 0, generation: 0, input: 0, output: 0, reasoning: 0 }
}

function parseTokenStats(data: Uint8Array): AntigravityTokenUsage {
  const reader = new ProtoReader(data)
  const usage = emptyUsage()
  for (let tag = reader.nextTag(); tag; tag = reader.nextTag()) {
    if (tag.wireType !== 0) {
      if (!reader.skip(tag.wireType)) break
      continue
    }
    const value = reader.readVarint()
    if (value === undefined) break
    if (tag.field === 2) usage.input = value
    else if (tag.field === 3) usage.output = value
    else if (tag.field === 5) usage.cacheRead = value
    else if (tag.field === 9) usage.reasoning = value
    else if (tag.field === 10) usage.generation = value
  }
  return usage
}

export function parseAntigravityGenerationMetadata(data: Uint8Array): AntigravityTokenUsage {
  const outer = new ProtoReader(data)
  let usage = emptyUsage()
  for (let tag = outer.nextTag(); tag; tag = outer.nextTag()) {
    if (tag.field !== 1 || tag.wireType !== 2) {
      if (!outer.skip(tag.wireType)) break
      continue
    }
    const metadata = outer.readBytes()
    if (!metadata) break
    const nested = new ProtoReader(metadata)
    for (let nestedTag = nested.nextTag(); nestedTag; nestedTag = nested.nextTag()) {
      if (nestedTag.field === 4 && nestedTag.wireType === 2) {
        const tokenStats = nested.readBytes()
        if (!tokenStats) break
        usage = parseTokenStats(tokenStats)
      } else if (!nested.skip(nestedTag.wireType)) {
        break
      }
    }
  }
  return usage
}

function byteView(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return null
}

function addUsage(total: AntigravityTokenUsage, usage: AntigravityTokenUsage): void {
  total.cacheRead += usage.cacheRead
  total.generation += usage.generation
  total.input += usage.input
  total.output += usage.output
  total.reasoning += usage.reasoning
}

async function openConversationDatabase(
  conversationId: string,
  options: AntigravityUsageReaderOptions
): Promise<AntigravitySqlDatabase | null> {
  const defaults = defaultPaths()
  const directory = options.conversationsDirectory ?? defaults.conversationsDirectory
  const openDatabase = options.openDatabase ?? defaultOpenDatabase
  return openDatabase(path.join(directory, `${conversationId}.db`))
}

export async function captureAntigravityUsageCursor(
  sessionIds: readonly string[],
  options: AntigravityUsageReaderOptions = {}
): Promise<AntigravityUsageCursor | null> {
  const defaults = defaultPaths()
  const mapping = await readSessionMapping(
    sessionIds,
    options.sessionMapPath ?? defaults.sessionMapPath
  )
  if (mapping === undefined) return null
  if (mapping === null) return { conversationId: null, maxGenerationIndex: -1 }
  const database = await openConversationDatabase(mapping.conversationId, options)
  if (!database) return null
  try {
    const row = database.prepare('SELECT MAX(idx) AS maxIndex FROM gen_metadata').get()
    if (!isRecord(row)) return null
    const maxGenerationIndex =
      row.maxIndex === null ? -1 : (safeInteger(row.maxIndex) ?? Number.NaN)
    if (!Number.isSafeInteger(maxGenerationIndex)) return null
    return { conversationId: mapping.conversationId, maxGenerationIndex }
  } catch {
    return null
  } finally {
    database.close()
  }
}

async function readAntigravityTurnUsageOnce(
  sessionIds: readonly string[],
  cursor: AntigravityUsageCursor,
  options: AntigravityUsageReaderOptions = {}
): Promise<AntigravityTokenUsage | null> {
  const defaults = defaultPaths()
  const mapping = await readSessionMapping(
    sessionIds,
    options.sessionMapPath ?? defaults.sessionMapPath
  )
  if (!mapping) return null
  const database = await openConversationDatabase(mapping.conversationId, options)
  if (!database) return null
  try {
    const minimumIndex =
      cursor.conversationId === mapping.conversationId ? cursor.maxGenerationIndex : -1
    const rows = database
      .prepare('SELECT idx, data FROM gen_metadata WHERE idx > ? ORDER BY idx ASC')
      .all(minimumIndex)
    const total = emptyUsage()
    let decodedRows = 0
    for (const row of rows) {
      if (!isRecord(row)) continue
      const bytes = byteView(row.data)
      if (!bytes) continue
      addUsage(total, parseAntigravityGenerationMetadata(bytes))
      decodedRows += 1
    }
    return decodedRows > 0 ? total : null
  } catch {
    return null
  } finally {
    database.close()
  }
}

export async function readAntigravityTurnUsage(
  sessionIds: readonly string[],
  cursor: AntigravityUsageCursor,
  options: AntigravityUsageReaderOptions = {}
): Promise<AntigravityTokenUsage | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const usage = await readAntigravityTurnUsageOnce(sessionIds, cursor, options)
    if (usage) return usage
    if (attempt < 2) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25 * (attempt + 1))
      })
    }
  }
  return null
}
