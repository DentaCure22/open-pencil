import { appendFile, chmod, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type {
  TraceHistorySession,
  TraceQueryRecordSummary,
  TraceQuerySpokenTurn
} from '@open-pencil/core/rpc'

import {
  LOCAL_WORKSPACE_TRACE_CONTEXT_FILE,
  LOCAL_WORKSPACE_TRACE_CONTEXT_TTL_MS
} from './agent-context'
import { readJsonFile, writeJsonFile } from './json-file'
import type { LocalWorkspaceTraceGesture } from './trace'
import {
  createTraceCurrentContext,
  isTraceCurrentContext,
  type LocalWorkspaceTraceCurrentContext,
  type LocalWorkspaceTraceCurrentContextInput
} from './trace-current-context'
import {
  LocalWorkspaceTraceEvidenceStore,
  type LocalWorkspaceTraceEvidenceOverview,
  type LocalWorkspaceTraceEvidencePinResult,
  type LocalWorkspaceTraceEvidenceStatus,
  type LocalWorkspaceTraceFileEvidenceReference
} from './trace-evidence-store'
import { withTraceFileQueue } from './trace-file-queue'

export {
  DEFAULT_TRACE_EVIDENCE_BYTES,
  DEFAULT_TRACE_EVIDENCE_COUNT,
  LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_CONTRACT,
  LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_FILE,
  LOCAL_WORKSPACE_TRACE_EVIDENCE_OVERVIEW_CONTRACT,
  type LocalWorkspaceTraceEvidenceOverview,
  type LocalWorkspaceTraceEvidencePinResult,
  type LocalWorkspaceTraceEvidenceStatus,
  type LocalWorkspaceTraceFileEvidenceReference
} from './trace-evidence-store'

export {
  LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT,
  type LocalWorkspaceTraceCurrentContext
} from './trace-current-context'

export const LOCAL_WORKSPACE_TRACE_EVENT_DIRECTORY = 'trace-events'
export const LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT = 'trace-file-event/v1'
export const DEFAULT_TRACE_EVENT_SEGMENT_BYTES = 4 * 1024 * 1024

const TRACE_EVENT_SEGMENT_PATTERN = /^events-(\d{8})\.jsonl$/

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

export type LocalWorkspaceTraceFileStoreOptions = {
  maxEvidenceBytes?: number
  maxEvidenceCount?: number
  maxSegmentBytes?: number
  root: string
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

function segmentFileName(sequence: number): string {
  return `events-${String(sequence).padStart(8, '0')}.jsonl`
}

function segmentSequence(fileName: string): number | null {
  const match = TRACE_EVENT_SEGMENT_PATTERN.exec(fileName)
  return match ? Number(match[1]) : null
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

function eventLine(event: LocalWorkspaceTraceFileEvent): string {
  return `${JSON.stringify(event)}\n`
}

export class LocalWorkspaceTraceFileStore {
  readonly rootPath: string
  readonly eventDirectoryPath: string
  readonly currentContextPath: string
  readonly evidenceDirectoryPath: string
  readonly evidenceIndexPath: string
  private readonly evidence: LocalWorkspaceTraceEvidenceStore
  private readonly maxSegmentBytes: number

  constructor(options: LocalWorkspaceTraceFileStoreOptions) {
    this.rootPath = path.resolve(options.root)
    this.eventDirectoryPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_EVENT_DIRECTORY)
    this.currentContextPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_CONTEXT_FILE)
    this.evidence = new LocalWorkspaceTraceEvidenceStore({
      maxBytes: options.maxEvidenceBytes,
      maxCount: options.maxEvidenceCount,
      readEvents: () => this.readEventsWithoutWaiting(),
      root: this.rootPath
    })
    this.evidenceDirectoryPath = this.evidence.evidenceDirectoryPath
    this.evidenceIndexPath = this.evidence.evidenceIndexPath
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
        evidence: this.evidence.sessionReferences(input.session),
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
    return withTraceFileQueue(this.rootPath, () => this.readEventsWithoutWaiting())
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
    return this.evidence.writeEvidence(input)
  }

  readEvidence(evidenceId: string): Promise<{
    bytes: Uint8Array
    mimeType: 'image/png'
    path: string
  } | null> {
    return this.evidence.readEvidence(evidenceId)
  }

  evidenceStatus(evidenceId: string): Promise<LocalWorkspaceTraceEvidenceStatus> {
    return this.evidence.evidenceStatus(evidenceId)
  }

  evidenceStatuses(
    evidenceIds: readonly string[]
  ): Promise<Map<string, LocalWorkspaceTraceEvidenceStatus>> {
    return this.evidence.evidenceStatuses(evidenceIds)
  }

  evidenceOverview(evidenceIds: readonly string[]): Promise<LocalWorkspaceTraceEvidenceOverview> {
    return this.evidence.evidenceOverview(evidenceIds)
  }

  pinEvidence(evidenceId: string, pinId: string): Promise<LocalWorkspaceTraceEvidencePinResult> {
    return this.evidence.pinEvidence(evidenceId, pinId)
  }

  unpinEvidence(evidenceId: string, pinId: string): Promise<boolean> {
    return this.evidence.unpinEvidence(evidenceId, pinId)
  }

  releaseEvidencePins(pinId: string): Promise<number> {
    return this.evidence.releaseEvidencePins(pinId)
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

  private async readEventsWithoutWaiting(): Promise<LocalWorkspaceTraceFileEvent[]> {
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
        ? { evidence: this.evidence.reference(gesture.evidence.evidenceId) }
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
    const reference = input.gesture?.evidence
      ? this.evidence.reference(input.gesture.evidence.evidenceId)
      : undefined
    const status = reference
      ? await this.evidence.statusWithoutWaiting(reference.evidenceId)
      : undefined
    return createTraceCurrentContext(
      input,
      ttlMs,
      reference ? { reference, status: status ?? 'missing' } : undefined
    )
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
}
