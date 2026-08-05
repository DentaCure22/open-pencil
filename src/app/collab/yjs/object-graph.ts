import * as Y from 'yjs'

import {
  objectGraphConnectionsPluginData,
  parseObjectGraphConnection,
  readObjectGraphConnections,
  type ObjectGraphConnection,
  type PluginDataEntry,
  type SceneNode
} from '@open-pencil/scene-graph'

export const OBJECT_GRAPH_YJS_RECORDS_MAP = 'objectGraphConnections:v1'

const CONNECTION_VALUE_KEY = 'connection'
const DELETED_VALUE_KEY = 'deleted'
const MIGRATED_VALUE_KEY = 'migrated'

type ObjectGraphYRecord = Y.Map<unknown>
export type ObjectGraphYRecords = Y.Map<ObjectGraphYRecord>

type ObjectGraphYKey =
  | { connectionId: string; kind: 'record'; pageId: string }
  | { kind: 'page'; pageId: string }

function pageKey(pageId: string): string {
  return JSON.stringify(['page', pageId])
}

function recordKey(pageId: string, connectionId: string): string {
  return JSON.stringify(['record', pageId, connectionId])
}

function parseKey(key: string): ObjectGraphYKey | null {
  try {
    const value: unknown = JSON.parse(key)
    if (!Array.isArray(value) || typeof value[1] !== 'string') return null
    if (value[0] === 'page' && value.length === 2) {
      return { kind: 'page', pageId: value[1] }
    }
    if (value[0] === 'record' && value.length === 3 && typeof value[2] === 'string') {
      return { connectionId: value[2], kind: 'record', pageId: value[1] }
    }
    return null
  } catch {
    return null
  }
}

function pluginData(value: unknown): PluginDataEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is PluginDataEntry =>
    Boolean(
      entry &&
      typeof entry === 'object' &&
      'key' in entry &&
      typeof entry.key === 'string' &&
      'pluginId' in entry &&
      typeof entry.pluginId === 'string' &&
      'value' in entry &&
      typeof entry.value === 'string'
    )
  )
}

function ensureRecord(records: ObjectGraphYRecords, key: string): ObjectGraphYRecord {
  const existing = records.get(key)
  if (existing) return existing
  const created = new Y.Map<unknown>()
  records.set(key, created)
  return created
}

function connectionById(connections: ObjectGraphConnection[]): Map<string, ObjectGraphConnection> {
  return new Map(connections.map((connection) => [connection.id, connection]))
}

export function getObjectGraphYRecords(ydoc: Y.Doc): ObjectGraphYRecords {
  return ydoc.getMap<ObjectGraphYRecord>(OBJECT_GRAPH_YJS_RECORDS_MAP)
}

export function isObjectGraphPageMigrated(records: ObjectGraphYRecords, pageId: string): boolean {
  return records.get(pageKey(pageId))?.get(MIGRATED_VALUE_KEY) === true
}

export function readObjectGraphYConnections(
  records: ObjectGraphYRecords,
  pageId: string
): ObjectGraphConnection[] | null {
  if (!isObjectGraphPageMigrated(records, pageId)) return null
  const connections: ObjectGraphConnection[] = []
  for (const [key, record] of records) {
    const parsedKey = parseKey(key)
    if (parsedKey?.kind !== 'record' || parsedKey.pageId !== pageId) continue
    if (record.get(DELETED_VALUE_KEY) === true) continue
    const connection = parseObjectGraphConnection(record.get(CONNECTION_VALUE_KEY))
    if (connection && connection.id === parsedKey.connectionId) connections.push(connection)
  }
  return connections.sort((left, right) => left.id.localeCompare(right.id))
}

export function objectGraphPluginDataFromYjs(
  records: ObjectGraphYRecords,
  pageId: string,
  basePluginData: PluginDataEntry[]
): PluginDataEntry[] {
  const connections = readObjectGraphYConnections(records, pageId)
  return connections === null
    ? structuredClone(basePluginData)
    : objectGraphConnectionsPluginData({ pluginData: basePluginData }, connections)
}

export function syncObjectGraphPageToYjs(
  records: ObjectGraphYRecords,
  page: Pick<SceneNode, 'id' | 'pluginData'>,
  previousPluginData: PluginDataEntry[] = []
): void {
  const previous = connectionById(readObjectGraphConnections({ pluginData: previousPluginData }))
  const current = connectionById(readObjectGraphConnections(page))
  const migration = ensureRecord(records, pageKey(page.id))

  if (!isObjectGraphPageMigrated(records, page.id)) {
    for (const connection of previous.values()) {
      const record = ensureRecord(records, recordKey(page.id, connection.id))
      record.set(CONNECTION_VALUE_KEY, structuredClone(connection))
      record.set(DELETED_VALUE_KEY, false)
    }
    migration.set(MIGRATED_VALUE_KEY, true)
  }

  for (const connection of previous.values()) {
    if (current.has(connection.id)) continue
    ensureRecord(records, recordKey(page.id, connection.id)).set(DELETED_VALUE_KEY, true)
  }

  for (const connection of current.values()) {
    const record = ensureRecord(records, recordKey(page.id, connection.id))
    record.set(CONNECTION_VALUE_KEY, structuredClone(connection))
    // Creating a record or causally restoring one after its deletion is an
    // explicit resurrection. Ordinary updates leave the tombstone untouched,
    // so a concurrent delete wins over an offline edit.
    if (!previous.has(connection.id)) record.set(DELETED_VALUE_KEY, false)
  }
}

export function tombstoneObjectGraphPageInYjs(
  records: ObjectGraphYRecords,
  pageId: string,
  previousPluginData: PluginDataEntry[]
): void {
  const migration = ensureRecord(records, pageKey(pageId))
  migration.set(MIGRATED_VALUE_KEY, true)
  for (const connection of readObjectGraphConnections({ pluginData: previousPluginData })) {
    ensureRecord(records, recordKey(pageId, connection.id)).set(DELETED_VALUE_KEY, true)
  }
}

function keyForNestedRecord(
  records: ObjectGraphYRecords,
  target: ObjectGraphYRecord
): string | null {
  for (const [key, record] of records) {
    if (record === target) return key
  }
  return null
}

export function objectGraphPageIdsFromYjsEvents(
  records: ObjectGraphYRecords,
  events: Y.YEvent<ObjectGraphYRecord>[]
): Set<string> {
  const pageIds = new Set<string>()
  for (const event of events) {
    if (event.target === records) {
      for (const key of event.changes.keys.keys()) {
        const parsed = parseKey(key)
        if (parsed) pageIds.add(parsed.pageId)
      }
      continue
    }
    const key = keyForNestedRecord(records, event.target)
    const parsed = key ? parseKey(key) : null
    if (parsed) pageIds.add(parsed.pageId)
  }
  return pageIds
}

export function readYNodePluginData(ynode: Y.Map<unknown> | undefined): PluginDataEntry[] {
  return pluginData(ynode?.get('pluginData'))
}
