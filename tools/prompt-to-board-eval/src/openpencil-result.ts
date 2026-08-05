import type { EvalEventKind, EvalTarget } from './schema'

type OpenPencilResultObject = { [key: string]: unknown }

export interface ProjectedOpenPencilEvent {
  data: Record<string, unknown>
  kind: Extract<EvalEventKind, 'durability_confirmed' | 'openpencil_result'>
}

function record(value: unknown): OpenPencilResultObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as OpenPencilResultObject)
    : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function stringMap(value: unknown): Record<string, string> | null {
  const candidate = record(value)
  if (!candidate) return null
  const entries = Object.entries(candidate)
  if (entries.some(([key, item]) => !key.trim() || typeof item !== 'string' || !item.trim())) {
    return null
  }
  return Object.fromEntries(entries) as Record<string, string>
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.some((item) => typeof item !== 'string' || !item.trim())) return null
  return [...value]
}

function field(value: OpenPencilResultObject | null, ...names: string[]): unknown {
  for (const name of names) if (value?.[name] !== undefined) return value[name]
  return undefined
}

function exactTarget(value: unknown): EvalTarget | null {
  const target = record(value)
  const runtime = string(field(target, 'runtime_instance_id', 'runtimeInstanceId'))
  const workspace = string(field(target, 'workspace_id', 'workspaceId'))
  const document = string(field(target, 'document_id', 'documentId'))
  const contentDocument = string(field(target, 'content_document_id', 'contentDocumentId'))
  const page = string(field(target, 'page_id', 'pageId'))
  return runtime && workspace && document && contentDocument && page
    ? {
        content_document_id: contentDocument,
        document_id: document,
        page_id: page,
        runtime_instance_id: runtime,
        workspace_id: workspace
      }
    : null
}

function parseJSON(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function resultPayload(value: unknown): OpenPencilResultObject | null {
  const envelope = record(value)
  if (!envelope) return null
  const structured = record(field(envelope, 'structured_content', 'structuredContent'))
  if (structured) return record(structured.result) ?? structured
  const directResult = record(envelope.result)
  if (directResult && !envelope.status && !envelope.owner_id && !envelope.receipt) {
    return directResult
  }
  if (!envelope.status && Array.isArray(envelope.content)) {
    for (const block of envelope.content) {
      const content = record(block)
      if (content?.type !== 'text' || typeof content.text !== 'string') continue
      const parsed = record(parseJSON(content.text))
      if (parsed) return record(parsed.result) ?? parsed
    }
  }
  return envelope
}

export function parseCliOpenPencilOutput(output: unknown): OpenPencilResultObject | null {
  if (typeof output !== 'string' || !output.trim()) return null
  return resultPayload(parseJSON(output.trim()))
}

function requestId(payload: OpenPencilResultObject): string | null {
  const receipt = record(payload.receipt) ?? record(payload.mutation_receipt)
  const nextAction = record(payload.next_action)
  return (
    string(field(receipt, 'request_id', 'requestId')) ??
    string(field(nextAction, 'request_id', 'requestId'))
  )
}

function ownerId(payload: OpenPencilResultObject): string | null {
  const receipt = record(payload.receipt) ?? record(payload.mutation_receipt)
  const semanticOwner = record(field(receipt, 'semantic_owner', 'semanticOwner'))
  return (
    string(field(payload, 'owner_id', 'ownerId', 'connection_id', 'connectionId')) ??
    string(field(semanticOwner, 'owner_id', 'ownerId'))
  )
}

function ownerIds(payload: OpenPencilResultObject): Record<string, string> | null {
  const receipt = record(payload.receipt) ?? record(payload.mutation_receipt)
  return (
    stringMap(field(payload, 'owner_ids', 'ownerIds')) ??
    stringMap(field(receipt, 'owner_ids', 'ownerIds'))
  )
}

function connectionIds(payload: OpenPencilResultObject): string[] | null {
  const receipt = record(payload.receipt) ?? record(payload.mutation_receipt)
  return (
    stringList(field(payload, 'connection_ids', 'connectionIds')) ??
    stringList(field(receipt, 'connection_ids', 'connectionIds'))
  )
}

export function projectOpenPencilResult(
  semanticCommand: string | null,
  value: unknown
): ProjectedOpenPencilEvent[] {
  const mutating = new Set([
    'board_build',
    'board_change',
    'connect_objects',
    'build',
    'connect',
    'create',
    'edit'
  ])
  if (!semanticCommand || !mutating.has(semanticCommand)) return []
  const payload = resultPayload(value)
  if (!payload) return []
  const status = record(payload.status)
  const mutationState = string(status?.mutation) ?? string(payload.mutation)
  if (!mutationState) return []
  const target = exactTarget(payload.target)
  const projectedOwnerIds = ownerIds(payload)
  const projectedConnectionIds = connectionIds(payload)
  const base = {
    command_status: string(status?.command),
    mutation_state: mutationState,
    owner_id: ownerId(payload),
    ...(projectedOwnerIds ? { owner_ids: projectedOwnerIds } : {}),
    ...(projectedConnectionIds ? { connection_ids: projectedConnectionIds } : {}),
    raw_result: payload,
    request_id: requestId(payload),
    semantic_command: semanticCommand,
    ...(target ? { target } : {})
  }
  const events: ProjectedOpenPencilEvent[] = [{ data: base, kind: 'openpencil_result' }]
  const persistence = record(payload.persistence)
  if (persistence?.status === 'durable') {
    events.push({
      data: {
        current: true,
        raw_persistence: persistence,
        request_id: requestId(payload),
        ...(target ? { target } : {})
      },
      kind: 'durability_confirmed'
    })
  }
  return events
}
