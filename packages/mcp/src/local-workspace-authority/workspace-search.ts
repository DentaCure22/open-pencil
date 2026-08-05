import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import {
  WORKSPACE_SEARCH_CONTRACT,
  type WorkspaceSearchHit,
  type WorkspaceSearchResult
} from '@open-pencil/core/rpc'
import { canonicalMemoryObjectId, canonicalMemorySourceNodeId } from '@open-pencil/core/tools'
import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { openSqliteDatabase, type SqliteDatabase, type SqliteStatement } from './database'
import { readAuthorityBoardDocument } from './document'
import type { LocalWorkspaceAuthorityHead } from './types'

const SEARCH_DATABASE_FILE = 'workspace-search.sqlite3'
const SEARCH_SCHEMA_VERSION = 2
const MAX_SEARCH_LIMIT = 100
const MAX_CANDIDATES = 10_000
const MAX_SEARCHABLE_TEXT = 4_096

type WorkspaceSearchEntity = {
  boardId: string
  boardName: string
  bounds?: Rect
  canonicalObjectId: string
  fingerprint: string
  id: string
  kind: 'board' | 'object'
  name: string
  nodeType: string
  ownerId: string
  parentId?: string
  searchableText: string
  sourceNodeId?: string
}

type SearchEntityRow = {
  board_id: string
  board_name: string
  canonical_object_id: string
  entity_id: string
  fingerprint: string
  kind: 'board' | 'object'
  name: string
  node_type: string
  owner_id: string
  parent_id: string | null
  searchable_text: string
  source_node_id: string | null
}

type RankedSearchEntityRow = SearchEntityRow & {
  rank_group: number
  search_score: number
}

type SearchMetaRow = {
  value: string
}

type SearchVersionRow = {
  user_version: number
}

type WorkspaceSearchSyncStatements = {
  deleteEntity: SqliteStatement
  deleteFts: SqliteStatement
  deletePlacement: SqliteStatement
  existing: SqliteStatement
  insertFts: SqliteStatement
  markSeen: SqliteStatement
  upsertEntity: SqliteStatement
  upsertPlacement: SqliteStatement
}

export type WorkspaceSearchSyncResult = {
  changed: number
  deleted: number
  indexedRevision: number
  total: number
}

function normalized(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US')
}

function boundedSearchText(parts: Iterable<unknown>): string {
  let text = ''
  for (const raw of parts) {
    if (typeof raw !== 'string') continue
    const part = raw.trim()
    if (!part) continue
    const remaining = MAX_SEARCHABLE_TEXT - text.length - (text ? 1 : 0)
    if (remaining <= 0) break
    text += `${text ? ' ' : ''}${part.slice(0, remaining)}`
  }
  return text
}

function nodeText(node: SceneNode, ownerName: string): string {
  const parts = [node.name, ownerName]
  if (node.type === 'TEXT') parts.push(node.text)
  if ('mermaidSource' in node && typeof node.mermaidSource === 'string') {
    parts.push(node.mermaidSource)
  }
  return boundedSearchText(parts)
}

function subtreeText(graph: SceneGraph, node: SceneNode): string {
  function* parts(): Iterable<string> {
    yield nodeText(node, node.name)
    for (const descendant of graph.getDescendants(node.id)) {
      yield nodeText(descendant, node.name)
    }
  }
  return boundedSearchText(parts())
}

function entityFingerprint(entity: Omit<WorkspaceSearchEntity, 'fingerprint'>): string {
  return createHash('sha256').update(JSON.stringify(entity)).digest('hex')
}

function workspaceSearchEntity(
  value: Omit<WorkspaceSearchEntity, 'fingerprint'>
): WorkspaceSearchEntity {
  return { ...value, fingerprint: entityFingerprint(value) }
}

function searchableBounds(bounds: Rect): Rect | undefined {
  return Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
    ? bounds
    : undefined
}

function workspaceSearchEntities(head: LocalWorkspaceAuthorityHead): WorkspaceSearchEntity[] {
  const { graph } = readAuthorityBoardDocument(head.document)
  const entities: WorkspaceSearchEntity[] = []
  for (const board of graph.getPages()) {
    entities.push(
      workspaceSearchEntity({
        boardId: board.id,
        boardName: board.name,
        canonicalObjectId: board.id,
        id: board.id,
        kind: 'board',
        name: board.name,
        nodeType: board.type,
        ownerId: board.id,
        searchableText: subtreeText(graph, board)
      })
    )
    for (const ownerId of board.childIds) {
      const owner = graph.getNode(ownerId)
      if (!owner) continue
      const ownerName = owner.name || owner.id
      const sourceNodeId = canonicalMemorySourceNodeId(owner)
      const bounds = searchableBounds(graph.getAbsoluteBounds(owner.id))
      entities.push(
        workspaceSearchEntity({
          boardId: board.id,
          boardName: board.name,
          ...(bounds ? { bounds } : {}),
          canonicalObjectId: canonicalMemoryObjectId(owner),
          id: owner.id,
          kind: 'object',
          name: ownerName,
          nodeType: owner.type,
          ownerId: owner.id,
          ...(owner.parentId ? { parentId: owner.parentId } : {}),
          searchableText: subtreeText(graph, owner),
          ...(sourceNodeId ? { sourceNodeId } : {})
        })
      )
    }
  }
  return entities
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEARCH_LIMIT) {
    throw new Error(`Workspace search limit must be between 1 and ${MAX_SEARCH_LIMIT}.`)
  }
  return value
}

function ftsQuery(value: string): string | undefined {
  const tokens = value.normalize('NFKC').match(/[\p{L}\p{N}_-]+/gu)
  if (!tokens || tokens.length === 0) return undefined
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ')
}

function hit(row: SearchEntityRow): WorkspaceSearchHit {
  return {
    board: { id: row.board_id, name: row.board_name },
    canonical_object_id: row.canonical_object_id,
    id: row.entity_id,
    kind: row.kind,
    name: row.name,
    owner_id: row.owner_id,
    type: row.node_type
  }
}

function ownerRank(row: SearchEntityRow): number {
  return row.entity_id === row.owner_id ? 0 : 1
}

function kindRank(row: SearchEntityRow): number {
  return row.kind === 'board' ? 0 : 1
}

export class LocalWorkspaceSearchIndex {
  readonly filePath: string
  private readonly database: SqliteDatabase

  constructor(root: string) {
    mkdirSync(root, { mode: 0o700, recursive: true })
    this.filePath = path.join(root, SEARCH_DATABASE_FILE)
    this.database = openSqliteDatabase(this.filePath)
    try {
      chmodSync(this.filePath, 0o600)
    } catch (error) {
      console.warn('[Workspace search] Could not restrict database permissions:', error)
    }
    this.database.exec('PRAGMA busy_timeout = 5000')
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA synchronous = NORMAL')
    this.ensureSchema()
  }

  close(): void {
    this.database.close()
  }

  sync(head: LocalWorkspaceAuthorityHead): WorkspaceSearchSyncResult {
    const indexedRevision = Number(this.meta('indexed_revision') ?? 0)
    const indexedHash = this.meta('content_hash')
    if (indexedRevision === head.revision && indexedHash === head.contentHash) {
      return {
        changed: 0,
        deleted: 0,
        indexedRevision,
        total: this.entityCount()
      }
    }

    const entities = workspaceSearchEntities(head)
    const statements = this.syncStatements()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const changed = this.upsertEntities(entities, head.revision, statements)
      const deleted = this.deleteStaleEntities(head.revision, statements)
      this.writeMeta('indexed_revision', String(head.revision))
      this.writeMeta('content_hash', head.contentHash)
      this.database.exec('COMMIT')
      return {
        changed,
        deleted,
        indexedRevision: head.revision,
        total: entities.length
      }
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  search(rawQuery: string, rawLimit = 20): WorkspaceSearchResult {
    const query = rawQuery.trim()
    if (!query) throw new Error('Workspace search query is required.')
    const limit = boundedLimit(rawLimit)
    const normalizedQuery = normalized(query)
    const candidateLimit = MAX_CANDIDATES
    const exactRows = this.statement(`
        SELECT
          entity_id, kind, name, node_type, board_id, board_name, parent_id, owner_id,
          canonical_object_id, source_node_id, searchable_text, fingerprint,
          CASE
            WHEN lower(entity_id) = ? THEN 0
            WHEN normalized_name = ? THEN 1
            ELSE 2
          END AS rank_group,
          0.0 AS search_score
        FROM search_entities
        WHERE lower(entity_id) = ? OR normalized_name = ? OR normalized_name LIKE ?
        ORDER BY rank_group, CASE WHEN entity_id = owner_id THEN 0 ELSE 1 END,
          CASE kind WHEN 'board' THEN 0 ELSE 1 END, name, entity_id
        LIMIT ?
      `).all(
      normalizedQuery,
      normalizedQuery,
      normalizedQuery,
      normalizedQuery,
      `${normalizedQuery}%`,
      candidateLimit
    ) as RankedSearchEntityRow[]

    const queryFts = ftsQuery(query)
    let ftsRows: RankedSearchEntityRow[] = []
    if (queryFts) {
      ftsRows = this.statement(`
            SELECT
              entity.entity_id, entity.kind, entity.name, entity.node_type, entity.board_id,
              entity.board_name, entity.parent_id, entity.owner_id,
              entity.canonical_object_id, entity.source_node_id, entity.searchable_text,
              entity.fingerprint, 3 AS rank_group,
              bm25(search_fts, 0.0, 5.0, 1.0, 1.0) AS search_score
            FROM search_fts
            JOIN search_entities AS entity ON entity.entity_id = search_fts.entity_id
            WHERE search_fts MATCH ?
            ORDER BY search_score,
              CASE WHEN entity.entity_id = entity.owner_id THEN 0 ELSE 1 END,
              CASE entity.kind WHEN 'board' THEN 0 ELSE 1 END, entity.name, entity.entity_id
            LIMIT ?
          `).all(queryFts, candidateLimit) as RankedSearchEntityRow[]
    }

    const ranked = new Map<string, RankedSearchEntityRow>()
    for (const row of [...exactRows, ...ftsRows]) {
      const prior = ranked.get(row.entity_id)
      if (
        !prior ||
        row.rank_group < prior.rank_group ||
        (row.rank_group === prior.rank_group && row.search_score < prior.search_score)
      ) {
        ranked.set(row.entity_id, row)
      }
    }
    const ordered = [...ranked.values()].sort(
      (left, right) =>
        left.rank_group - right.rank_group ||
        left.search_score - right.search_score ||
        ownerRank(left) - ownerRank(right) ||
        kindRank(left) - kindRank(right) ||
        left.name.localeCompare(right.name) ||
        left.entity_id.localeCompare(right.entity_id)
    )
    const results = ordered.slice(0, limit).map(hit)
    const indexedRevision = Number(this.meta('indexed_revision') ?? 0)
    return {
      contract: WORKSPACE_SEARCH_CONTRACT,
      indexed_revision: indexedRevision,
      query,
      results,
      returned: results.length,
      total: ordered.length,
      truncated: results.length < ordered.length
    }
  }

  private statement(sql: string): SqliteStatement {
    if (this.database.prepare) return this.database.prepare(sql)
    if (this.database.query) return this.database.query(sql)
    throw new Error('Workspace search SQLite statements are unavailable.')
  }

  private syncStatements(): WorkspaceSearchSyncStatements {
    return {
      deleteEntity: this.statement('DELETE FROM search_entities WHERE entity_id = ?'),
      deleteFts: this.statement('DELETE FROM search_fts WHERE entity_id = ?'),
      deletePlacement: this.statement('DELETE FROM object_placements WHERE node_id = ?'),
      existing: this.statement('SELECT fingerprint FROM search_entities WHERE entity_id = ?'),
      insertFts: this.statement(
        'INSERT INTO search_fts(entity_id, name, searchable_text, node_type) VALUES (?, ?, ?, ?)'
      ),
      markSeen: this.statement('UPDATE search_entities SET seen_revision = ? WHERE entity_id = ?'),
      upsertEntity: this.statement(`
        INSERT INTO search_entities(
          entity_id, kind, name, normalized_name, node_type, board_id, board_name, parent_id,
          owner_id, canonical_object_id, source_node_id, searchable_text, fingerprint, seen_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_id) DO UPDATE SET
          kind = excluded.kind, name = excluded.name, normalized_name = excluded.normalized_name,
          node_type = excluded.node_type, board_id = excluded.board_id,
          board_name = excluded.board_name, parent_id = excluded.parent_id,
          owner_id = excluded.owner_id, canonical_object_id = excluded.canonical_object_id,
          source_node_id = excluded.source_node_id, searchable_text = excluded.searchable_text,
          fingerprint = excluded.fingerprint, seen_revision = excluded.seen_revision
      `),
      upsertPlacement: this.statement(`
        INSERT INTO object_placements(
          node_id, canonical_object_id, board_id, parent_id, owner_id, x, y, width, height
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          canonical_object_id = excluded.canonical_object_id, board_id = excluded.board_id,
          parent_id = excluded.parent_id, owner_id = excluded.owner_id, x = excluded.x,
          y = excluded.y, width = excluded.width, height = excluded.height
      `)
    }
  }

  private upsertEntities(
    entities: WorkspaceSearchEntity[],
    revision: number,
    statements: WorkspaceSearchSyncStatements
  ): number {
    let changed = 0
    for (const entity of entities) {
      const prior = statements.existing.get(entity.id) as { fingerprint?: string } | undefined
      if (prior?.fingerprint === entity.fingerprint) {
        statements.markSeen.run(revision, entity.id)
        continue
      }
      changed += 1
      statements.upsertEntity.run(
        entity.id,
        entity.kind,
        entity.name,
        normalized(entity.name),
        entity.nodeType,
        entity.boardId,
        entity.boardName,
        entity.parentId ?? null,
        entity.ownerId,
        entity.canonicalObjectId,
        entity.sourceNodeId ?? null,
        entity.searchableText,
        entity.fingerprint,
        revision
      )
      statements.deleteFts.run(entity.id)
      statements.insertFts.run(entity.id, entity.name, entity.searchableText, entity.nodeType)
      if (entity.kind === 'object' && entity.bounds) {
        statements.upsertPlacement.run(
          entity.id,
          entity.canonicalObjectId,
          entity.boardId,
          entity.parentId ?? null,
          entity.ownerId,
          entity.bounds.x,
          entity.bounds.y,
          entity.bounds.width,
          entity.bounds.height
        )
      }
    }
    return changed
  }

  private deleteStaleEntities(revision: number, statements: WorkspaceSearchSyncStatements): number {
    const rows = this.statement(
      'SELECT entity_id FROM search_entities WHERE seen_revision != ?'
    ).all(revision) as Array<{ entity_id: string }>
    for (const { entity_id: id } of rows) {
      statements.deleteFts.run(id)
      statements.deletePlacement.run(id)
      statements.deleteEntity.run(id)
    }
    return rows.length
  }

  private ensureSchema(): void {
    const version = this.statement('PRAGMA user_version').get() as SearchVersionRow | undefined
    if (version?.user_version && version.user_version !== SEARCH_SCHEMA_VERSION) {
      this.database.exec(`
        DROP TABLE IF EXISTS search_fts;
        DROP TABLE IF EXISTS object_placements;
        DROP TABLE IF EXISTS search_entities;
        DROP TABLE IF EXISTS search_meta;
      `)
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS search_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS search_entities (
        entity_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('board', 'object')),
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        node_type TEXT NOT NULL,
        board_id TEXT NOT NULL,
        board_name TEXT NOT NULL,
        parent_id TEXT,
        owner_id TEXT NOT NULL,
        canonical_object_id TEXT NOT NULL,
        source_node_id TEXT,
        searchable_text TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        seen_revision INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS search_entities_name ON search_entities(normalized_name);
      CREATE INDEX IF NOT EXISTS search_entities_board ON search_entities(board_id, kind);
      CREATE INDEX IF NOT EXISTS search_entities_canonical
        ON search_entities(canonical_object_id, board_id);
      CREATE TABLE IF NOT EXISTS object_placements (
        node_id TEXT PRIMARY KEY,
        canonical_object_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        parent_id TEXT,
        owner_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS object_placements_canonical
        ON object_placements(canonical_object_id, board_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        entity_id UNINDEXED,
        name,
        searchable_text,
        node_type,
        prefix = '2 3',
        tokenize = 'unicode61 remove_diacritics 2'
      );
      PRAGMA user_version = ${String(SEARCH_SCHEMA_VERSION)};
    `)
  }

  private entityCount(): number {
    const row = this.statement('SELECT COUNT(*) AS count FROM search_entities').get() as
      | { count?: number | bigint }
      | undefined
    return Number(row?.count ?? 0)
  }

  private meta(key: string): string | undefined {
    const row = this.statement('SELECT value FROM search_meta WHERE key = ?').get(key) as
      | SearchMetaRow
      | undefined
    return row?.value
  }

  private writeMeta(key: string, value: string): void {
    this.statement(`
      INSERT INTO search_meta(key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }
}
