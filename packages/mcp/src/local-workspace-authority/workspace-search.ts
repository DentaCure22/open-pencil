import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  WORKSPACE_SEARCH_CONTRACT,
  type WorkspaceSearchHit,
  type WorkspaceSearchResult
} from '@open-pencil/core/rpc'

import type { LocalWorkspaceAuthorityHead } from './types'
import {
  buildWorkspaceJsonlIndex,
  parseWorkspaceJsonlIndexMetadata,
  WORKSPACE_JSONL_INDEX_FILE,
  workspaceJsonlIndexIsCurrent,
  type WorkspaceJsonlIndex,
  type WorkspaceJsonlIndexRecord,
  writeWorkspaceJsonlIndex
} from './workspace-jsonl-index'

const MAX_SEARCH_LIMIT = 100

function normalized(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase('en-US')
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_SEARCH_LIMIT) {
    throw new Error(`Workspace search limit must be between 1 and ${MAX_SEARCH_LIMIT}.`)
  }
  return value
}

function isIndexRecord(value: unknown): value is WorkspaceJsonlIndexRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<WorkspaceJsonlIndexRecord>
  return Boolean(
    (record.kind === 'node' || record.kind === 'page') &&
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.pageId === 'string' &&
    typeof record.pageName === 'string' &&
    typeof record.ownerId === 'string' &&
    typeof record.canonicalObjectId === 'string' &&
    typeof record.searchable === 'string'
  )
}

function parseIndex(value: string): WorkspaceJsonlIndex | null {
  const lines = value.split('\n').filter(Boolean)
  const metadata = parseWorkspaceJsonlIndexMetadata(lines[0] ?? '')
  if (!metadata) return null
  const records = lines.slice(1).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown
      return isIndexRecord(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
  return records.length === metadata.recordCount ? { metadata, records } : null
}

async function currentIndex(
  rootPath: string,
  head: LocalWorkspaceAuthorityHead
): Promise<WorkspaceJsonlIndex> {
  const filePath = path.join(rootPath, WORKSPACE_JSONL_INDEX_FILE)
  let parsed: WorkspaceJsonlIndex | null
  try {
    parsed = parseIndex(await readFile(filePath, 'utf8'))
  } catch {
    parsed = null
  }
  if (parsed && workspaceJsonlIndexIsCurrent(parsed.metadata, head)) return parsed
  const rebuilt = buildWorkspaceJsonlIndex(head)
  try {
    await writeWorkspaceJsonlIndex(rootPath, head, rebuilt)
  } catch (error) {
    console.warn('[Workspace search] Could not persist the disposable JSONL index:', error)
  }
  return rebuilt
}

function searchTokens(query: string): string[] {
  return query.match(/[\p{L}\p{N}_-]+/gu) ?? []
}

function recordRank(record: WorkspaceJsonlIndexRecord, query: string): number | null {
  const id = normalized(record.id)
  const name = normalized(record.name)
  if (id === query) return 0
  if (name === query) return 1
  if (name.startsWith(query)) return 2
  const tokens = searchTokens(query)
  return tokens.length > 0 && tokens.every((token) => record.searchable.includes(token)) ? 3 : null
}

function hit(record: WorkspaceJsonlIndexRecord): WorkspaceSearchHit {
  return {
    board: { id: record.pageId, name: record.pageName },
    canonical_object_id: record.canonicalObjectId,
    id: record.id,
    kind: record.kind === 'page' ? 'board' : 'object',
    name: record.name,
    owner_id: record.ownerId,
    type: record.type
  }
}

export async function searchWorkspaceIndex(
  rootPath: string,
  head: LocalWorkspaceAuthorityHead,
  rawQuery: string,
  rawLimit = 20
): Promise<WorkspaceSearchResult> {
  const query = rawQuery.trim()
  if (!query) throw new Error('Workspace search query is required.')
  const limit = boundedLimit(rawLimit)
  const normalizedQuery = normalized(query)
  const index = await currentIndex(rootPath, head)
  const ordered = index.records
    .flatMap((record) => {
      const rank = recordRank(record, normalizedQuery)
      return rank === null ? [] : [{ rank, record }]
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(left.record.id !== left.record.ownerId) -
          Number(right.record.id !== right.record.ownerId) ||
        Number(left.record.kind !== 'page') - Number(right.record.kind !== 'page') ||
        left.record.name.localeCompare(right.record.name) ||
        left.record.id.localeCompare(right.record.id)
    )
  const results = ordered.slice(0, limit).map(({ record }) => hit(record))
  return {
    contract: WORKSPACE_SEARCH_CONTRACT,
    indexed_revision: index.metadata.revision,
    query,
    results,
    returned: results.length,
    total: ordered.length,
    truncated: results.length < ordered.length
  }
}
