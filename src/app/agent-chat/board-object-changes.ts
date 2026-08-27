import type { AiBoardObjectChange, AiMessage, AiMessagePart } from './types'

type JsonRecord = Record<string, unknown>

type BoardApplyReceipt = {
  changedIds: string[]
  createdIds: string[]
  deletedIds: string[]
  nodes: Map<string, { name?: string; type?: string }>
  pageId?: string
}

const BOARD_OBJECT_CHANGE_LIMIT = 25

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseJson(value: string | undefined): unknown {
  if (!value?.trim()) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => (typeof entry === 'string' && entry.trim() ? [entry.trim()] : []))
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toolNameCandidates(part: Extract<AiMessagePart, { type: 'tool' }>): string[] {
  const candidates = [part.name]
  const input = parseJson(part.input)
  if (!isRecord(input)) return candidates
  for (const record of [input, input.Arguments, input.args].filter(isRecord)) {
    for (const key of ['ToolName', 'action', 'tool', 'toolAction'] as const) {
      const value = stringField(record[key])
      if (value) candidates.push(value)
    }
  }
  return candidates
}

function isBoardApplyPart(part: Extract<AiMessagePart, { type: 'tool' }>): boolean {
  return toolNameCandidates(part).some((candidate) => {
    const normalized = candidate
      .trim()
      .replace(/[\s-]+/g, '_')
      .toLowerCase()
    return normalized === 'board_apply' || normalized.endsWith('_board_apply')
  })
}

function outputRecords(output: string | undefined): JsonRecord[] {
  const parsed = parseJson(output)
  if (!isRecord(parsed)) return []
  const records: JsonRecord[] = [parsed]
  const structured = parsed.structuredContent
  if (isRecord(structured)) records.push(structured)
  const content = parsed.content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item)) continue
      const nested = parseJson(stringField(item.text))
      if (isRecord(nested)) records.push(nested)
    }
  }
  return records
}

function receiptFromRecord(record: JsonRecord): BoardApplyReceipt | null {
  const result = isRecord(record.result) ? record.result : record
  const changedIds = strings(result.changed_ids ?? result.changedIds)
  const createdIds = strings(result.created_ids ?? result.createdIds)
  const deletedIds = strings(result.deleted_ids ?? result.deletedIds)
  if (!changedIds.length && !createdIds.length && !deletedIds.length) return null

  const nodes = new Map<string, { name?: string; type?: string }>()
  if (Array.isArray(result.nodes)) {
    for (const value of result.nodes) {
      if (!isRecord(value)) continue
      const id = stringField(value.id)
      if (!id) continue
      nodes.set(id, {
        name: stringField(value.name),
        type: stringField(value.type)
      })
    }
  }
  const target = isRecord(record.target) ? record.target : undefined
  return {
    changedIds,
    createdIds,
    deletedIds,
    nodes,
    pageId:
      stringField(target?.page_id) ??
      stringField(target?.pageId) ??
      stringField(result.page_id) ??
      stringField(result.pageId)
  }
}

function boardApplyReceipt(output: string | undefined): BoardApplyReceipt | null {
  for (const record of outputRecords(output)) {
    const receipt = receiptFromRecord(record)
    if (receipt) return receipt
  }
  return null
}

function humanizeNodeType(type: string | undefined): string {
  if (!type) return 'Board object'
  return type
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
}

export function boardObjectChangesFromMessages(
  messages: readonly AiMessage[]
): AiBoardObjectChange[] {
  const changes = new Map<string, AiBoardObjectChange>()

  for (const message of messages) {
    for (const receipt of boardApplyReceipts(message)) applyReceipt(changes, receipt)
  }

  return [...changes.values()].slice(0, BOARD_OBJECT_CHANGE_LIMIT)
}

function boardApplyReceipts(message: AiMessage): BoardApplyReceipt[] {
  return (message.parts ?? []).flatMap((part) => {
    if (part.type !== 'tool' || part.state !== 'success' || !isBoardApplyPart(part)) return []
    const receipt = boardApplyReceipt(part.output)
    return receipt ? [receipt] : []
  })
}

function applyReceipt(changes: Map<string, AiBoardObjectChange>, receipt: BoardApplyReceipt) {
  for (const id of receipt.deletedIds) changes.delete(id)
  const created = new Set(receipt.createdIds)
  const deleted = new Set(receipt.deletedIds)
  const changedIds = [...new Set([...receipt.changedIds, ...receipt.createdIds])]
  for (const id of changedIds) {
    if (deleted.has(id)) continue
    changes.set(id, changeFromReceipt(changes.get(id), receipt, id, created.has(id)))
  }
}

function changeFromReceipt(
  previous: AiBoardObjectChange | undefined,
  receipt: BoardApplyReceipt,
  id: string,
  created: boolean
): AiBoardObjectChange {
  const node = receipt.nodes.get(id)
  const type = node?.type ?? previous?.type
  const pageId = receipt.pageId ?? previous?.pageId
  const change: AiBoardObjectChange = {
    id,
    name: node?.name ?? previous?.name ?? humanizeNodeType(type),
    verb: created || previous?.verb === 'created' ? 'created' : 'edited'
  }
  if (pageId) change.pageId = pageId
  if (type) change.type = type
  return change
}
