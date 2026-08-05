import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const AUTHORITY_DATABASE_FILE = 'authority.sqlite3'
const AUTHORITY_SCHEMA_VERSION = 3

export type SqliteRunResult = {
  changes?: number | bigint
}

export type SqliteStatement = {
  all: (...values: unknown[]) => unknown[]
  get: (...values: unknown[]) => unknown
  run: (...values: unknown[]) => SqliteRunResult
}

export type SqliteDatabase = {
  close: () => void
  exec: (sql: string) => unknown
  prepare?: (sql: string) => SqliteStatement
  query?: (sql: string) => SqliteStatement
}

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase

export type LocalWorkspaceAuthorityJson =
  | boolean
  | number
  | string
  | null
  | LocalWorkspaceAuthorityJson[]
  | { [key: string]: LocalWorkspaceAuthorityJson }

type JsonRow = {
  value_json: string
}

type CountRow = {
  count: number | bigint
}

type TraceEvidenceRow = {
  bytes: Uint8Array
  mime_type: string
}

export type LocalWorkspaceTraceEvidence = {
  bytes: Uint8Array
  mimeType: string
}

const sqliteSpecifier =
  typeof (globalThis as { Bun?: unknown }).Bun === 'object' ? 'bun:sqlite' : 'node:sqlite'
const sqliteModule = (await import(sqliteSpecifier)) as {
  Database?: SqliteDatabaseConstructor
  DatabaseSync?: SqliteDatabaseConstructor
}
function sqliteConstructor(): SqliteDatabaseConstructor {
  const constructor = sqliteModule.Database ?? sqliteModule.DatabaseSync
  if (!constructor) throw new Error(`SQLite is unavailable from ${sqliteSpecifier}`)
  return constructor
}

const Sqlite = sqliteConstructor()

export function openSqliteDatabase(filename: string): SqliteDatabase {
  return new Sqlite(filename)
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function changes(result: SqliteRunResult): number {
  return Number(result.changes ?? 0)
}

export class LocalWorkspaceAuthorityDatabase {
  readonly filePath: string
  private readonly database: SqliteDatabase

  constructor(root: string) {
    mkdirSync(root, { mode: 0o700, recursive: true })
    this.filePath = path.join(root, AUTHORITY_DATABASE_FILE)
    this.database = openSqliteDatabase(this.filePath)
    try {
      chmodSync(this.filePath, 0o600)
    } catch (error) {
      console.warn('[Local workspace authority] Could not restrict database permissions:', error)
    }
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec('PRAGMA journal_mode = DELETE')
    this.database.exec('PRAGMA synchronous = FULL')
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS trace_metadata (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS trace_sessions (
        session_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        session_json TEXT NOT NULL,
        summary_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS trace_gestures (
        gesture_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        content_document_id TEXT NOT NULL,
        page_id TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        gesture_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES trace_sessions(session_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS trace_gestures_scope_latest
        ON trace_gestures(workspace_id, content_document_id, page_id, captured_at DESC, gesture_id DESC);
      CREATE TABLE IF NOT EXISTS trace_spoken_turns (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        turn_json TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES trace_sessions(session_id) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS trace_spoken_turns_latest
        ON trace_spoken_turns(ended_at DESC, sequence DESC, turn_id DESC);
      CREATE TABLE IF NOT EXISTS trace_evidence (
        evidence_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS trace_evidence_session
        ON trace_evidence(session_id);
      PRAGMA user_version = ${String(AUTHORITY_SCHEMA_VERSION)};
    `)
  }

  beginImmediate(): void {
    this.database.exec('BEGIN IMMEDIATE')
  }

  commit(): void {
    this.database.exec('COMMIT')
  }

  rollback(): void {
    this.database.exec('ROLLBACK')
  }

  close(): void {
    this.database.close()
  }

  readTraceMetadata(key: string): LocalWorkspaceAuthorityJson | undefined {
    const row = this.statement('SELECT value_json FROM trace_metadata WHERE key = ?').get(key) as
      | JsonRow
      | undefined
    return row ? (parseJson(row.value_json) as LocalWorkspaceAuthorityJson) : undefined
  }

  writeTraceMetadata(key: string, value: unknown): void {
    this.statement(
      `INSERT INTO trace_metadata(key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(key, JSON.stringify(value), new Date().toISOString())
  }

  writeTraceSession(input: {
    gestures: Array<{
      boardOrigin: { contentDocumentId: string; pageId: string; workspaceId: string }
      capturedAt: string
      gestureId: string
      sessionId: string
    }>
    session: { id: string; startedAt: string }
    sessionValue: unknown
    spokenTurns?: Array<{
      endedAt: string
      id: string
      sequence: number
      startedAt: string
      value: unknown
    }>
    summaryValue: unknown
    updatedAt: string
  }): void {
    this.statement(
      `INSERT INTO trace_sessions(session_id, started_at, updated_at, session_json, summary_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         started_at = excluded.started_at,
         updated_at = excluded.updated_at,
         session_json = excluded.session_json,
         summary_json = excluded.summary_json`
    ).run(
      input.session.id,
      input.session.startedAt,
      input.updatedAt,
      JSON.stringify(input.sessionValue),
      JSON.stringify(input.summaryValue)
    )
    this.statement('DELETE FROM trace_gestures WHERE session_id = ?').run(input.session.id)
    const insert = this.statement(
      `INSERT INTO trace_gestures(
        gesture_id, session_id, workspace_id, content_document_id, page_id, captured_at, gesture_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const gesture of input.gestures) {
      insert.run(
        gesture.gestureId,
        gesture.sessionId,
        gesture.boardOrigin.workspaceId,
        gesture.boardOrigin.contentDocumentId,
        gesture.boardOrigin.pageId,
        gesture.capturedAt,
        JSON.stringify(gesture)
      )
    }
    if (input.spokenTurns) {
      this.statement('DELETE FROM trace_spoken_turns WHERE session_id = ?').run(input.session.id)
      const insertSpokenTurn = this.statement(
        `INSERT INTO trace_spoken_turns(
          turn_id, session_id, started_at, ended_at, sequence, turn_json
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const turn of input.spokenTurns) {
        insertSpokenTurn.run(
          turn.id,
          input.session.id,
          turn.startedAt,
          turn.endedAt,
          turn.sequence,
          JSON.stringify(turn.value)
        )
      }
    }
  }

  readTraceSession(sessionId: string): LocalWorkspaceAuthorityJson | undefined {
    const row = this.statement(
      'SELECT session_json AS value_json FROM trace_sessions WHERE session_id = ?'
    ).get(sessionId) as JsonRow | undefined
    return row ? (parseJson(row.value_json) as LocalWorkspaceAuthorityJson) : undefined
  }

  readTraceSessionSummaries(): LocalWorkspaceAuthorityJson[] {
    return this.statement(
      'SELECT summary_json AS value_json FROM trace_sessions ORDER BY updated_at DESC, session_id DESC'
    )
      .all()
      .map((row) => parseJson((row as JsonRow).value_json) as LocalWorkspaceAuthorityJson)
  }

  readTraceSpokenTurns(): LocalWorkspaceAuthorityJson[] {
    return this.statement(
      `SELECT turn_json AS value_json FROM trace_spoken_turns
       ORDER BY ended_at DESC, sequence DESC, turn_id DESC`
    )
      .all()
      .map((row) => parseJson((row as JsonRow).value_json) as LocalWorkspaceAuthorityJson)
  }

  deleteTraceSession(sessionId: string): boolean {
    this.statement('DELETE FROM trace_evidence WHERE session_id = ?').run(sessionId)
    return (
      changes(this.statement('DELETE FROM trace_sessions WHERE session_id = ?').run(sessionId)) > 0
    )
  }

  readTraceGesture(gestureId?: string): LocalWorkspaceAuthorityJson | undefined {
    const row = gestureId
      ? (this.statement(
          'SELECT gesture_json AS value_json FROM trace_gestures WHERE gesture_id = ?'
        ).get(gestureId) as JsonRow | undefined)
      : (this.statement(
          `SELECT gesture_json AS value_json FROM trace_gestures
           ORDER BY captured_at DESC, gesture_id DESC LIMIT 1`
        ).get() as JsonRow | undefined)
    return row ? (parseJson(row.value_json) as LocalWorkspaceAuthorityJson) : undefined
  }

  traceSessionCount(): number {
    const row = this.statement(
      'SELECT COUNT(DISTINCT session_id) AS count FROM trace_gestures'
    ).get() as CountRow | undefined
    return Number(row?.count ?? 0)
  }

  writeTraceEvidence(input: {
    bytes: Uint8Array
    evidenceId: string
    mimeType: string
    sessionId: string
  }): void {
    this.statement(
      `INSERT INTO trace_evidence(evidence_id, session_id, mime_type, bytes, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(evidence_id) DO UPDATE SET
         session_id = excluded.session_id,
         mime_type = excluded.mime_type,
         bytes = excluded.bytes`
    ).run(input.evidenceId, input.sessionId, input.mimeType, input.bytes, new Date().toISOString())
  }

  readTraceEvidence(evidenceId: string): LocalWorkspaceTraceEvidence | null {
    const row = this.statement(
      'SELECT mime_type, bytes FROM trace_evidence WHERE evidence_id = ?'
    ).get(evidenceId) as TraceEvidenceRow | undefined
    if (!row) return null
    return { bytes: new Uint8Array(row.bytes), mimeType: row.mime_type }
  }

  private statement(sql: string): SqliteStatement {
    const statement = this.database.prepare?.(sql) ?? this.database.query?.(sql)
    if (!statement) throw new Error('SQLite statement preparation is unavailable')
    return statement
  }
}
