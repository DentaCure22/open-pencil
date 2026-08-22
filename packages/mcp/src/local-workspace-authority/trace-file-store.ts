import { appendFile, chmod, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import type {
  TraceHistorySession,
  TraceQueryRecordSummary,
  TraceQuerySpokenTurn
} from '@open-pencil/core/rpc'

import {
  localWorkspaceTraceEvidencePath,
  LOCAL_WORKSPACE_TRACE_CONTEXT_FILE,
  LOCAL_WORKSPACE_TRACE_CONTEXT_TTL_MS,
  LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY
} from './agent-context'
import { readJsonFile, writeBinaryFile, writeJsonFile } from './json-file'
import type { LocalWorkspaceTraceGesture } from './trace'

export const LOCAL_WORKSPACE_TRACE_EVENT_DIRECTORY = 'trace-events'
export const LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT = 'trace-file-event/v1'
export const LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT = 'trace-context/v2'
export const DEFAULT_TRACE_EVENT_SEGMENT_BYTES = 4 * 1024 * 1024

const TRACE_EVENT_SEGMENT_PATTERN = /^events-(\d{8})\.jsonl$/
/** The local authority is one writer process; keying its queue by canonical root also covers sibling instances. */
const traceFileTails = new Map<string, Promise<void>>()

export type LocalWorkspaceTraceFileEvidenceReference = {
  evidenceId: string
  mimeType: 'image/png'
  path: string
}

type LocalWorkspaceTraceFileEventBase = {
  appendedAt: string
  contract: typeof LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT
}

type LocalWorkspaceTraceFileEventShape = {
  appendedAt?: unknown
  contract?: unknown
  gesture?: { gestureId?: unknown; sessionId?: unknown }
  recordType?: unknown
  session?: { id?: unknown }
  sessionId?: unknown
  spokenTurn?: { id?: unknown }
  summary?: { id?: unknown }
}

export type LocalWorkspaceTraceFileSessionEvent = LocalWorkspaceTraceFileEventBase & {
  evidence: LocalWorkspaceTraceFileEvidenceReference[]
  recordType: 'session'
  session: TraceHistorySession
  summary: TraceQueryRecordSummary
}

export type LocalWorkspaceTraceFileGestureEvent = LocalWorkspaceTraceFileEventBase & {
  evidence?: LocalWorkspaceTraceFileEvidenceReference
  gesture: LocalWorkspaceTraceGesture
  recordType: 'gesture'
}

export type LocalWorkspaceTraceFileSpokenTurnEvent = LocalWorkspaceTraceFileEventBase & {
  recordType: 'spoken-turn'
  sessionId?: string
  spokenTurn: TraceQuerySpokenTurn
}

export type LocalWorkspaceTraceFileSessionDeletedEvent = LocalWorkspaceTraceFileEventBase & {
  recordType: 'session-deleted'
  sessionId: string
}

export type LocalWorkspaceTraceFileEvent =
  | LocalWorkspaceTraceFileGestureEvent
  | LocalWorkspaceTraceFileSessionEvent
  | LocalWorkspaceTraceFileSessionDeletedEvent
  | LocalWorkspaceTraceFileSpokenTurnEvent

export type LocalWorkspaceTraceAppendReceipt = {
  recordCount: number
  segmentPaths: string[]
}

export type LocalWorkspaceTraceCurrentContext = {
  captured_at: string
  contract: typeof LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT
  evidence?: {
    evidence_id: string
    mime_type: 'image/png'
    path: string
    status: 'missing' | 'ready'
  }
  expires_at: string
  gesture_id?: string
  reasons?: Array<'candidate_list_truncated' | 'page_missing' | 'target_missing'>
  region?: LocalWorkspaceTraceGesture['geometry']
  scope: {
    document_id: string
    page_id: string
    page_name?: string
    workspace_id: string
  }
  session_id?: string
  spoken_turn?: {
    ended_at: string
    id: string
    runtime_tab_binding_id?: string
    sequence: number
    started_at: string
    text: string
  }
  status: 'ambiguous' | 'ready'
  targets: {
    count: number
    items: Array<{ owner_id?: string; stable_id: string }>
    primary_stable_id?: string
    truncated: boolean
  }
  workspace_revision?: number
}

export type LocalWorkspaceTraceFileStoreOptions = {
  maxSegmentBytes?: number
  root: string
}

type LocalWorkspaceTraceCurrentContextInput = {
  gesture?: LocalWorkspaceTraceGesture
  pageMissing?: boolean
  pageName?: string
  spokenTurn?: TraceQuerySpokenTurn
  targetMissing?: boolean
  workspaceRevision?: number
}

type LocalWorkspaceTraceContextScope = {
  documentId: string
  pageId: string
  workspaceId: string
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function normalizedId(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} must be a non-empty string.`)
  return normalized
}

function contextScope(
  gesture?: LocalWorkspaceTraceGesture,
  spokenTurn?: TraceQuerySpokenTurn
): LocalWorkspaceTraceContextScope {
  if (!gesture && !spokenTurn) {
    throw new TypeError('Trace context requires a gesture or spoken turn.')
  }
  const gestureScope = gesture
    ? {
        documentId: gesture.boardOrigin.contentDocumentId,
        pageId: gesture.boardOrigin.pageId,
        workspaceId: gesture.boardOrigin.workspaceId
      }
    : undefined
  if (
    gestureScope &&
    spokenTurn &&
    (gestureScope.workspaceId !== spokenTurn.scope.workspaceId ||
      gestureScope.documentId !== spokenTurn.scope.documentId ||
      gestureScope.pageId !== spokenTurn.scope.pageId)
  ) {
    throw new TypeError('Trace context gesture and spoken turn must share one Board scope.')
  }
  return gestureScope ?? spokenTurn?.scope ?? unreachableTraceContext()
}

function unreachableTraceContext(): never {
  throw new TypeError('Trace context scope is unavailable.')
}

function contextCapturedAt(
  gesture?: LocalWorkspaceTraceGesture,
  spokenTurn?: TraceQuerySpokenTurn
): number {
  const capturedAt = Date.parse(gesture?.capturedAt ?? spokenTurn?.endedAt ?? '')
  if (!Number.isFinite(capturedAt)) {
    throw new TypeError('Trace gesture capturedAt must be an ISO date.')
  }
  return capturedAt
}

function contextReasons(
  input: LocalWorkspaceTraceCurrentContextInput
): NonNullable<LocalWorkspaceTraceCurrentContext['reasons']> {
  const reasons: NonNullable<LocalWorkspaceTraceCurrentContext['reasons']> = []
  if (input.pageMissing) reasons.push('page_missing')
  if (input.targetMissing) reasons.push('target_missing')
  if (input.gesture?.candidates.truncated) reasons.push('candidate_list_truncated')
  return reasons
}

function contextTargets(
  gesture?: LocalWorkspaceTraceGesture
): LocalWorkspaceTraceCurrentContext['targets'] {
  return {
    count: gesture?.candidates.count ?? 0,
    items: (gesture?.candidates.items ?? []).map(({ ownerId, stableId }) => ({
      ...(ownerId ? { owner_id: ownerId } : {}),
      stable_id: stableId
    })),
    ...(gesture?.candidates.primaryTargetId
      ? { primary_stable_id: gesture.candidates.primaryTargetId }
      : {}),
    truncated: gesture?.candidates.truncated ?? false
  }
}

function contextSpokenTurn(
  spokenTurn: TraceQuerySpokenTurn
): NonNullable<LocalWorkspaceTraceCurrentContext['spoken_turn']> {
  return {
    ended_at: spokenTurn.endedAt,
    id: spokenTurn.id,
    ...(spokenTurn.runtimeTabBindingId
      ? { runtime_tab_binding_id: spokenTurn.runtimeTabBindingId }
      : {}),
    sequence: spokenTurn.sequence,
    started_at: spokenTurn.startedAt,
    text: spokenTurn.text
  }
}

function segmentFileName(sequence: number): string {
  return `events-${String(sequence).padStart(8, '0')}.jsonl`
}

function segmentSequence(fileName: string): number | null {
  const match = TRACE_EVENT_SEGMENT_PATTERN.exec(fileName)
  return match ? Number(match[1]) : null
}

async function canonicalRoot(root: string): Promise<string> {
  await mkdir(root, { mode: 0o700, recursive: true })
  return realpath(root)
}

async function withTraceFileQueue<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = await canonicalRoot(root)
  const previous = traceFileTails.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  traceFileTails.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (traceFileTails.get(key) === current) traceFileTails.delete(key)
  }
}

function isTraceFileEvent(value: unknown): value is LocalWorkspaceTraceFileEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as LocalWorkspaceTraceFileEventShape
  if (
    record.contract !== LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT ||
    typeof record.appendedAt !== 'string'
  ) {
    return false
  }
  if (record.recordType === 'session-deleted') {
    return typeof record.sessionId === 'string' && record.sessionId.length > 0
  }
  if (record.recordType === 'session') {
    return typeof record.session?.id === 'string' && typeof record.summary?.id === 'string'
  }
  if (record.recordType === 'gesture') {
    return (
      typeof record.gesture?.gestureId === 'string' && typeof record.gesture.sessionId === 'string'
    )
  }
  if (record.recordType === 'spoken-turn') {
    return (
      typeof record.spokenTurn?.id === 'string' &&
      (record.sessionId === undefined || typeof record.sessionId === 'string')
    )
  }
  return false
}

function isTraceCurrentContext(value: unknown): value is LocalWorkspaceTraceCurrentContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const context = value as Partial<LocalWorkspaceTraceCurrentContext>
  const scope = context.scope
  const targets = context.targets
  if (
    context.contract !== LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT ||
    typeof context.captured_at !== 'string' ||
    !Number.isFinite(Date.parse(context.captured_at)) ||
    typeof context.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(context.expires_at)) ||
    (context.status !== 'ready' && context.status !== 'ambiguous') ||
    !scope ||
    typeof scope.document_id !== 'string' ||
    typeof scope.page_id !== 'string' ||
    typeof scope.workspace_id !== 'string' ||
    !targets ||
    !Number.isInteger(targets.count) ||
    !Array.isArray(targets.items) ||
    typeof targets.truncated !== 'boolean'
  ) {
    return false
  }
  return targets.items.every(
    (target) =>
      Boolean(target) &&
      typeof target.stable_id === 'string' &&
      (target.owner_id === undefined || typeof target.owner_id === 'string')
  )
}

function evidenceReference(
  root: string,
  evidenceId: string
): LocalWorkspaceTraceFileEvidenceReference {
  const normalized = normalizedId(evidenceId, 'Trace evidence ID')
  return {
    evidenceId: normalized,
    mimeType: 'image/png',
    path: localWorkspaceTraceEvidencePath(root, normalized)
  }
}

function sessionEvidenceReferences(root: string, session: TraceHistorySession) {
  const seen = new Set<string>()
  return session.events.flatMap((event) => {
    const evidenceId = event.evidence?.evidenceId.trim()
    if (!evidenceId || seen.has(evidenceId)) return []
    seen.add(evidenceId)
    return [evidenceReference(root, evidenceId)]
  })
}

function eventLine(event: LocalWorkspaceTraceFileEvent): string {
  return `${JSON.stringify(event)}\n`
}

export class LocalWorkspaceTraceFileStore {
  readonly rootPath: string
  readonly eventDirectoryPath: string
  readonly currentContextPath: string
  readonly evidenceDirectoryPath: string
  private readonly maxSegmentBytes: number

  constructor(options: LocalWorkspaceTraceFileStoreOptions) {
    this.rootPath = path.resolve(options.root)
    this.eventDirectoryPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_EVENT_DIRECTORY)
    this.currentContextPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_CONTEXT_FILE)
    this.evidenceDirectoryPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY)
    const maxSegmentBytes = options.maxSegmentBytes ?? DEFAULT_TRACE_EVENT_SEGMENT_BYTES
    if (!Number.isInteger(maxSegmentBytes) || maxSegmentBytes < 1) {
      throw new TypeError('Trace event segment size must be a positive integer.')
    }
    this.maxSegmentBytes = maxSegmentBytes
  }

  appendSession(input: {
    gestures?: readonly LocalWorkspaceTraceGesture[]
    session: TraceHistorySession
    spokenTurns?: readonly TraceQuerySpokenTurn[]
    summary: TraceQueryRecordSummary
  }): Promise<LocalWorkspaceTraceAppendReceipt> {
    const appendedAt = new Date().toISOString()
    const records: LocalWorkspaceTraceFileEvent[] = [
      {
        appendedAt,
        contract: LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT,
        evidence: sessionEvidenceReferences(this.rootPath, input.session),
        recordType: 'session',
        session: structuredClone(input.session),
        summary: structuredClone(input.summary)
      },
      ...(input.gestures ?? []).map((gesture) => this.gestureEvent(gesture, appendedAt)),
      ...(input.spokenTurns ?? []).map((spokenTurn) =>
        this.spokenTurnEvent(spokenTurn, appendedAt, input.session.id)
      )
    ]
    return this.appendRecords(records)
  }

  appendGestures(
    gestures: readonly LocalWorkspaceTraceGesture[]
  ): Promise<LocalWorkspaceTraceAppendReceipt> {
    if (gestures.length === 0) throw new TypeError('Trace gesture append requires records.')
    const appendedAt = new Date().toISOString()
    return this.appendRecords(gestures.map((gesture) => this.gestureEvent(gesture, appendedAt)))
  }

  appendSpokenTurns(
    spokenTurns: readonly TraceQuerySpokenTurn[]
  ): Promise<LocalWorkspaceTraceAppendReceipt> {
    if (spokenTurns.length === 0) throw new TypeError('Trace spoken-turn append requires records.')
    const appendedAt = new Date().toISOString()
    return this.appendRecords(
      spokenTurns.map((spokenTurn) => this.spokenTurnEvent(spokenTurn, appendedAt))
    )
  }

  appendSessionDeleted(sessionId: string): Promise<LocalWorkspaceTraceAppendReceipt> {
    return this.appendRecords([
      {
        appendedAt: new Date().toISOString(),
        contract: LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT,
        recordType: 'session-deleted',
        sessionId: normalizedId(sessionId, 'Trace session ID')
      }
    ])
  }

  async readEvents(): Promise<LocalWorkspaceTraceFileEvent[]> {
    return withTraceFileQueue(this.rootPath, async () => {
      const segmentPaths = (await this.segmentPathsWithoutWaiting()).map(({ filePath }) => filePath)
      const records: LocalWorkspaceTraceFileEvent[] = []
      for (const segmentPath of segmentPaths) {
        const contents = await readFile(segmentPath, 'utf8')
        const lines = contents.split('\n')
        const incompleteTailIndex = contents.endsWith('\n') ? -1 : lines.length - 1
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index].trim()
          if (!line) continue
          let parsed: unknown
          try {
            parsed = JSON.parse(line) as unknown
          } catch {
            if (index === incompleteTailIndex) break
            throw new TypeError(
              `Trace event segment ${path.basename(segmentPath)} has invalid JSON at line ${String(index + 1)}.`
            )
          }
          if (!isTraceFileEvent(parsed)) {
            if (index === incompleteTailIndex) break
            throw new TypeError(
              `Trace event segment ${path.basename(segmentPath)} has an invalid record at line ${String(index + 1)}.`
            )
          }
          records.push(parsed)
        }
      }
      return records
    })
  }

  listEventSegments(): Promise<string[]> {
    return withTraceFileQueue(this.rootPath, async () =>
      (await this.segmentPathsWithoutWaiting()).map(({ filePath }) => filePath)
    )
  }

  writeEvidence(input: {
    bytes: Uint8Array
    evidenceId: string
    mimeType: string
  }): Promise<LocalWorkspaceTraceFileEvidenceReference> {
    const reference = evidenceReference(this.rootPath, input.evidenceId)
    if (input.mimeType !== 'image/png') {
      throw new TypeError('Trace evidence must be an image/png payload.')
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
      throw new TypeError('Trace evidence bytes are required.')
    }
    return withTraceFileQueue(this.rootPath, async () => {
      await writeBinaryFile(reference.path, input.bytes)
      return reference
    })
  }

  async readEvidence(evidenceId: string): Promise<{
    bytes: Uint8Array
    mimeType: 'image/png'
    path: string
  } | null> {
    const reference = evidenceReference(this.rootPath, evidenceId)
    return withTraceFileQueue(this.rootPath, async () => {
      try {
        return {
          bytes: new Uint8Array(await readFile(reference.path)),
          mimeType: reference.mimeType,
          path: reference.path
        }
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return null
        throw error
      }
    })
  }

  writeCurrentContext(input: {
    gesture?: LocalWorkspaceTraceGesture
    pageMissing?: boolean
    pageName?: string
    spokenTurn?: TraceQuerySpokenTurn
    targetMissing?: boolean
    ttlMs?: number
    workspaceRevision?: number
  }): Promise<LocalWorkspaceTraceCurrentContext> {
    const ttlMs = input.ttlMs ?? LOCAL_WORKSPACE_TRACE_CONTEXT_TTL_MS
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw new TypeError('Trace context TTL must be a positive integer.')
    }
    return withTraceFileQueue(this.rootPath, async () => {
      const context = await this.currentContext(input, ttlMs)
      await writeJsonFile(this.currentContextPath, context)
      return context
    })
  }

  readCurrentContext(): Promise<LocalWorkspaceTraceCurrentContext | null> {
    return withTraceFileQueue(this.rootPath, async () => {
      try {
        const value = await readJsonFile(this.currentContextPath)
        return isTraceCurrentContext(value) ? value : null
      } catch {
        return null
      }
    })
  }

  private async appendRecords(
    records: readonly LocalWorkspaceTraceFileEvent[]
  ): Promise<LocalWorkspaceTraceAppendReceipt> {
    if (records.length === 0) throw new TypeError('Trace append requires records.')
    return withTraceFileQueue(this.rootPath, async () => {
      await mkdir(this.eventDirectoryPath, { mode: 0o700, recursive: true })
      await chmod(this.eventDirectoryPath, 0o700)
      const segmentPaths = await this.segmentPathsWithoutWaiting()
      let sequence = segmentPaths.at(-1)?.sequence ?? 1
      let filePath = path.join(this.eventDirectoryPath, segmentFileName(sequence))
      let size = await this.fileSize(filePath)
      if (size > 0 && !(await this.fileEndsWithNewline(filePath))) {
        sequence += 1
        filePath = path.join(this.eventDirectoryPath, segmentFileName(sequence))
        size = 0
      }
      const written = new Set<string>()
      for (const record of records) {
        const line = eventLine(record)
        const lineBytes = Buffer.byteLength(line, 'utf8')
        if (size > 0 && size + lineBytes > this.maxSegmentBytes) {
          sequence += 1
          filePath = path.join(this.eventDirectoryPath, segmentFileName(sequence))
          size = 0
        }
        await appendFile(filePath, line, { encoding: 'utf8', mode: 0o600 })
        await chmod(filePath, 0o600)
        size += lineBytes
        written.add(filePath)
      }
      return { recordCount: records.length, segmentPaths: [...written] }
    })
  }

  private gestureEvent(
    gesture: LocalWorkspaceTraceGesture,
    appendedAt: string
  ): LocalWorkspaceTraceFileGestureEvent {
    return {
      appendedAt,
      contract: LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT,
      ...(gesture.evidence
        ? { evidence: evidenceReference(this.rootPath, gesture.evidence.evidenceId) }
        : {}),
      gesture: structuredClone(gesture),
      recordType: 'gesture'
    }
  }

  private spokenTurnEvent(
    spokenTurn: TraceQuerySpokenTurn,
    appendedAt: string,
    sessionId?: string
  ): LocalWorkspaceTraceFileSpokenTurnEvent {
    return {
      appendedAt,
      contract: LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT,
      recordType: 'spoken-turn',
      ...(sessionId ? { sessionId } : {}),
      spokenTurn: structuredClone(spokenTurn)
    }
  }

  private async currentContext(
    input: LocalWorkspaceTraceCurrentContextInput,
    ttlMs: number
  ): Promise<LocalWorkspaceTraceCurrentContext> {
    const { gesture, spokenTurn } = input
    const scope = contextScope(gesture, spokenTurn)
    const capturedAt = contextCapturedAt(gesture, spokenTurn)
    const evidence = gesture?.evidence
      ? evidenceReference(this.rootPath, gesture.evidence.evidenceId)
      : undefined
    const evidenceReady = evidence ? await this.fileExists(evidence.path) : false
    const reasons = contextReasons(input)
    return {
      captured_at: new Date(capturedAt).toISOString(),
      contract: LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT,
      ...(evidence
        ? {
            evidence: {
              evidence_id: evidence.evidenceId,
              mime_type: evidence.mimeType,
              path: evidence.path,
              status: evidenceReady ? ('ready' as const) : ('missing' as const)
            }
          }
        : {}),
      expires_at: new Date(capturedAt + ttlMs).toISOString(),
      ...(gesture ? { gesture_id: gesture.gestureId } : {}),
      ...(reasons.length > 0 ? { reasons: [...reasons] } : {}),
      ...(gesture ? { region: structuredClone(gesture.geometry) } : {}),
      scope: {
        document_id: scope.documentId,
        page_id: scope.pageId,
        ...(input.pageName ? { page_name: input.pageName } : {}),
        workspace_id: scope.workspaceId
      },
      ...(gesture ? { session_id: gesture.sessionId } : {}),
      ...(spokenTurn ? { spoken_turn: contextSpokenTurn(spokenTurn) } : {}),
      status: reasons.length > 0 ? 'ambiguous' : 'ready',
      targets: contextTargets(gesture),
      ...(input.workspaceRevision === undefined
        ? {}
        : { workspace_revision: input.workspaceRevision })
    }
  }

  private async segmentPathsWithoutWaiting() {
    let fileNames: string[]
    try {
      fileNames = await readdir(this.eventDirectoryPath)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
    return fileNames
      .flatMap((fileName) => {
        const sequence = segmentSequence(fileName)
        return sequence === null
          ? []
          : [{ filePath: path.join(this.eventDirectoryPath, fileName), sequence }]
      })
      .sort((left, right) => left.sequence - right.sequence)
  }

  private async fileSize(filePath: string): Promise<number> {
    try {
      return (await stat(filePath)).size
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return 0
      throw error
    }
  }

  private async fileEndsWithNewline(filePath: string): Promise<boolean> {
    const bytes = await readFile(filePath)
    return bytes.at(-1) === 10
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      return (await stat(filePath)).isFile()
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return false
      throw error
    }
  }
}
