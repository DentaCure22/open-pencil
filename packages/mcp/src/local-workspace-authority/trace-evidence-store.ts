import { createHash } from 'node:crypto'
import { chmod, link, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { TraceHistorySession } from '@open-pencil/core/rpc'

import {
  localWorkspaceTraceEvidencePath,
  LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY
} from './agent-context'
import { readJsonFile, writeBinaryFile, writeJsonFile } from './json-file'
import { withTraceFileQueue } from './trace-file-queue'

export const LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_CONTRACT = 'trace-evidence-index/v1'
export const LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_FILE = 'trace-evidence.json'
export const LOCAL_WORKSPACE_TRACE_EVIDENCE_OVERVIEW_CONTRACT = 'trace-evidence-overview/v1'
export const DEFAULT_TRACE_EVIDENCE_COUNT = 100
export const DEFAULT_TRACE_EVIDENCE_BYTES = 250 * 1024 * 1024

export type LocalWorkspaceTraceFileEvidenceReference = {
  evidenceId: string
  mimeType: 'image/png'
  path: string
}

export type LocalWorkspaceTraceEvidenceStatus = 'evicted' | 'missing' | 'ready'

export type LocalWorkspaceTraceEvidencePinResult = 'already_pinned' | 'missing' | 'pinned'

export type LocalWorkspaceTraceEvidenceOverview = {
  contract: typeof LOCAL_WORKSPACE_TRACE_EVIDENCE_OVERVIEW_CONTRACT
  evidence: Record<
    string,
    {
      pinned: boolean
      status: LocalWorkspaceTraceEvidenceStatus
    }
  >
  limits: {
    bytes: number
    count: number
  }
  usage: {
    bytes: number
    count: number
    deduplicatedCount: number
    evictableCount: number
    evictedCount: number
    pinnedCount: number
  }
}

type LocalWorkspaceTraceEvidenceIndexEntry = {
  byteSize: number
  contentHash: string
  evidenceIds: string[]
  fileNames: string[]
  pins: string[]
  sequence: number
  status: Exclude<LocalWorkspaceTraceEvidenceStatus, 'missing'>
}

type LocalWorkspaceTraceEvidenceIndex = {
  contract: typeof LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_CONTRACT
  entries: LocalWorkspaceTraceEvidenceIndexEntry[]
  nextSequence: number
}

export type LocalWorkspaceTraceEvidenceFileEvent =
  | { evidence: LocalWorkspaceTraceFileEvidenceReference[]; recordType: 'session' }
  | { evidence?: LocalWorkspaceTraceFileEvidenceReference; recordType: 'gesture' }
  | { recordType: 'session-deleted' | 'spoken-turn' }

export type LocalWorkspaceTraceEvidenceStoreOptions = {
  maxBytes?: number
  maxCount?: number
  readEvents: () => Promise<readonly LocalWorkspaceTraceEvidenceFileEvent[]>
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function isTraceEvidenceIndexEntry(value: unknown): value is LocalWorkspaceTraceEvidenceIndexEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<LocalWorkspaceTraceEvidenceIndexEntry>
  return (
    Number.isInteger(entry.byteSize) &&
    (entry.byteSize ?? 0) > 0 &&
    typeof entry.contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(entry.contentHash) &&
    isStringArray(entry.evidenceIds) &&
    isStringArray(entry.fileNames) &&
    entry.fileNames.every(
      (fileName) => path.basename(fileName) === fileName && fileName.endsWith('.png')
    ) &&
    isStringArray(entry.pins) &&
    Number.isInteger(entry.sequence) &&
    (entry.sequence ?? 0) > 0 &&
    (entry.status === 'ready' || entry.status === 'evicted')
  )
}

function isTraceEvidenceIndex(value: unknown): value is LocalWorkspaceTraceEvidenceIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const index = value as Partial<LocalWorkspaceTraceEvidenceIndex>
  return (
    index.contract === LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_CONTRACT &&
    Number.isInteger(index.nextSequence) &&
    (index.nextSequence ?? 0) > 0 &&
    Array.isArray(index.entries) &&
    index.entries.every(isTraceEvidenceIndexEntry)
  )
}

function evidenceContentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
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

export class LocalWorkspaceTraceEvidenceStore {
  readonly rootPath: string
  readonly evidenceDirectoryPath: string
  readonly evidenceIndexPath: string
  private readonly maxEvidenceBytes: number
  private readonly maxEvidenceCount: number
  private readonly readTraceEvents: LocalWorkspaceTraceEvidenceStoreOptions['readEvents']

  constructor(options: LocalWorkspaceTraceEvidenceStoreOptions) {
    this.rootPath = path.resolve(options.root)
    this.evidenceDirectoryPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY)
    this.evidenceIndexPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_FILE)
    this.readTraceEvents = options.readEvents

    const maxEvidenceCount = options.maxCount ?? DEFAULT_TRACE_EVIDENCE_COUNT
    if (!Number.isInteger(maxEvidenceCount) || maxEvidenceCount < 1) {
      throw new TypeError('Trace evidence count limit must be a positive integer.')
    }
    this.maxEvidenceCount = maxEvidenceCount

    const maxEvidenceBytes = options.maxBytes ?? DEFAULT_TRACE_EVIDENCE_BYTES
    if (!Number.isInteger(maxEvidenceBytes) || maxEvidenceBytes < 1) {
      throw new TypeError('Trace evidence byte limit must be a positive integer.')
    }
    this.maxEvidenceBytes = maxEvidenceBytes
  }

  reference(evidenceId: string): LocalWorkspaceTraceFileEvidenceReference {
    return evidenceReference(this.rootPath, evidenceId)
  }

  sessionReferences(session: TraceHistorySession): LocalWorkspaceTraceFileEvidenceReference[] {
    return sessionEvidenceReferences(this.rootPath, session)
  }

  async statusWithoutWaiting(evidenceId: string): Promise<LocalWorkspaceTraceEvidenceStatus> {
    const normalizedEvidenceId = normalizedId(evidenceId, 'Trace evidence ID')
    const index = await this.readEvidenceIndexWithoutWaiting()
    return this.evidenceStatusWithoutWaiting(index, normalizedEvidenceId)
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
      const index = await this.readEvidenceIndexWithoutWaiting()
      const contentHash = evidenceContentHash(input.bytes)
      const priorEntry = index.entries.find((entry) =>
        entry.evidenceIds.includes(reference.evidenceId)
      )
      if (priorEntry?.status === 'ready') {
        if (priorEntry.contentHash !== contentHash) {
          throw new TypeError('Trace evidence ID already identifies different image bytes.')
        }
        return reference
      }
      if (priorEntry) {
        priorEntry.evidenceIds = priorEntry.evidenceIds.filter(
          (evidenceId) => evidenceId !== reference.evidenceId
        )
      }

      await mkdir(this.evidenceDirectoryPath, { mode: 0o700, recursive: true })
      await chmod(this.evidenceDirectoryPath, 0o700)
      const targetFileName = path.basename(reference.path)
      const pathEntry = index.entries.find(
        (entry) => entry.status === 'ready' && entry.fileNames.includes(targetFileName)
      )
      if (pathEntry && pathEntry.contentHash !== contentHash) {
        pathEntry.fileNames = pathEntry.fileNames.filter((fileName) => fileName !== targetFileName)
        if (pathEntry.fileNames.length === 0) {
          pathEntry.pins = []
          pathEntry.status = 'evicted'
        }
      }
      let contentEntry =
        pathEntry?.status === 'ready' && pathEntry.contentHash === contentHash
          ? pathEntry
          : index.entries.find(
              (entry) => entry.status === 'ready' && entry.contentHash === contentHash
            )
      if (contentEntry) {
        const sourcePath = await this.firstAvailableEvidencePath(contentEntry)
        if (sourcePath) {
          if (!(await this.fileExists(reference.path))) {
            await link(sourcePath, reference.path)
            await chmod(reference.path, 0o600)
          } else if (
            evidenceContentHash(new Uint8Array(await readFile(reference.path))) !== contentHash
          ) {
            throw new TypeError('Trace evidence path already contains different image bytes.')
          }
          if (!contentEntry.fileNames.includes(targetFileName)) {
            contentEntry.fileNames.push(targetFileName)
          }
          contentEntry.evidenceIds.push(reference.evidenceId)
          contentEntry.sequence = index.nextSequence
          index.nextSequence += 1
        } else {
          contentEntry.status = 'evicted'
          contentEntry.fileNames = []
          contentEntry.pins = []
          contentEntry = undefined
        }
      }
      if (!contentEntry) {
        await writeBinaryFile(reference.path, input.bytes)
        index.entries.push({
          byteSize: input.bytes.byteLength,
          contentHash,
          evidenceIds: [reference.evidenceId],
          fileNames: [targetFileName],
          pins: [],
          sequence: index.nextSequence,
          status: 'ready'
        })
        index.nextSequence += 1
      }
      index.entries = index.entries.filter(
        (entry) => entry.status === 'ready' || entry.evidenceIds.length > 0
      )
      await this.pruneEvidenceIndexWithoutWaiting(index)
      await writeJsonFile(this.evidenceIndexPath, index)
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
      const index = await this.readEvidenceIndexWithoutWaiting()
      const entry = index.entries.find((candidate) =>
        candidate.evidenceIds.includes(reference.evidenceId)
      )
      if (entry?.status === 'evicted') return null
      const candidates = [
        reference.path,
        ...(entry?.fileNames ?? []).map((fileName) => this.evidenceFilePath(fileName))
      ]
      const seen = new Set<string>()
      for (const candidate of candidates) {
        if (seen.has(candidate)) continue
        seen.add(candidate)
        try {
          return {
            bytes: new Uint8Array(await readFile(candidate)),
            mimeType: reference.mimeType,
            path: candidate
          }
        } catch (error) {
          if (errorCode(error) === 'ENOENT') continue
          throw error
        }
      }
      return null
    })
  }

  evidenceStatus(evidenceId: string): Promise<LocalWorkspaceTraceEvidenceStatus> {
    const normalizedEvidenceId = normalizedId(evidenceId, 'Trace evidence ID')
    return withTraceFileQueue(this.rootPath, async () => {
      const index = await this.readEvidenceIndexWithoutWaiting()
      return this.evidenceStatusWithoutWaiting(index, normalizedEvidenceId)
    })
  }

  evidenceStatuses(
    evidenceIds: readonly string[]
  ): Promise<Map<string, LocalWorkspaceTraceEvidenceStatus>> {
    const normalizedEvidenceIds = evidenceIds.map((evidenceId) =>
      normalizedId(evidenceId, 'Trace evidence ID')
    )
    return withTraceFileQueue(this.rootPath, async () => {
      const index = await this.readEvidenceIndexWithoutWaiting()
      return new Map(
        await Promise.all(
          normalizedEvidenceIds.map(
            async (evidenceId) =>
              [evidenceId, await this.evidenceStatusWithoutWaiting(index, evidenceId)] as const
          )
        )
      )
    })
  }

  evidenceOverview(evidenceIds: readonly string[]): Promise<LocalWorkspaceTraceEvidenceOverview> {
    const normalizedEvidenceIds = [
      ...new Set(evidenceIds.map((evidenceId) => normalizedId(evidenceId, 'Trace evidence ID')))
    ]
    return withTraceFileQueue(this.rootPath, async () => {
      const index = await this.readEvidenceIndexWithoutWaiting()
      const readyEntries = index.entries.filter((entry) => entry.status === 'ready')
      const evidence = Object.fromEntries(
        await Promise.all(
          normalizedEvidenceIds.map(async (evidenceId) => {
            const entry = index.entries.find((candidate) =>
              candidate.evidenceIds.includes(evidenceId)
            )
            return [
              evidenceId,
              {
                pinned: entry?.status === 'ready' && entry.pins.length > 0,
                status: await this.evidenceStatusWithoutWaiting(index, evidenceId)
              }
            ] as const
          })
        )
      )
      return {
        contract: LOCAL_WORKSPACE_TRACE_EVIDENCE_OVERVIEW_CONTRACT,
        evidence,
        limits: {
          bytes: this.maxEvidenceBytes,
          count: this.maxEvidenceCount
        },
        usage: {
          bytes: readyEntries.reduce((total, entry) => total + entry.byteSize, 0),
          count: readyEntries.length,
          deduplicatedCount: Math.max(
            0,
            readyEntries.reduce((total, entry) => total + entry.evidenceIds.length, 0) -
              readyEntries.length
          ),
          evictableCount: readyEntries.filter((entry) => entry.pins.length === 0).length,
          evictedCount: index.entries.filter((entry) => entry.status === 'evicted').length,
          pinnedCount: readyEntries.filter((entry) => entry.pins.length > 0).length
        }
      }
    })
  }

  pinEvidence(evidenceId: string, pinId: string): Promise<LocalWorkspaceTraceEvidencePinResult> {
    const normalizedEvidenceId = normalizedId(evidenceId, 'Trace evidence ID')
    const normalizedPinId = normalizedId(pinId, 'Trace evidence pin ID')
    return withTraceFileQueue(this.rootPath, async () => {
      const index = await this.readEvidenceIndexWithoutWaiting()
      const entry = index.entries.find(
        (candidate) =>
          candidate.status === 'ready' && candidate.evidenceIds.includes(normalizedEvidenceId)
      )
      if (!entry || !(await this.firstAvailableEvidencePath(entry))) return 'missing'
      if (entry.pins.includes(normalizedPinId)) return 'already_pinned'
      entry.pins.push(normalizedPinId)
      await writeJsonFile(this.evidenceIndexPath, index)
      return 'pinned'
    })
  }

  unpinEvidence(evidenceId: string, pinId: string): Promise<boolean> {
    const normalizedEvidenceId = normalizedId(evidenceId, 'Trace evidence ID')
    const normalizedPinId = normalizedId(pinId, 'Trace evidence pin ID')
    return withTraceFileQueue(this.rootPath, async () => {
      const index = await this.readEvidenceIndexWithoutWaiting()
      const entry = index.entries.find((candidate) =>
        candidate.evidenceIds.includes(normalizedEvidenceId)
      )
      if (!entry?.pins.includes(normalizedPinId)) return false
      entry.pins = entry.pins.filter((candidate) => candidate !== normalizedPinId)
      await this.pruneEvidenceIndexWithoutWaiting(index)
      await writeJsonFile(this.evidenceIndexPath, index)
      return true
    })
  }

  releaseEvidencePins(pinId: string): Promise<number> {
    const normalizedPinId = normalizedId(pinId, 'Trace evidence pin ID')
    return withTraceFileQueue(this.rootPath, async () => {
      const index = await this.readEvidenceIndexWithoutWaiting()
      let released = 0
      for (const entry of index.entries) {
        if (!entry.pins.includes(normalizedPinId)) continue
        entry.pins = entry.pins.filter((candidate) => candidate !== normalizedPinId)
        released += 1
      }
      if (released === 0) return 0
      await this.pruneEvidenceIndexWithoutWaiting(index)
      await writeJsonFile(this.evidenceIndexPath, index)
      return released
    })
  }

  private async readEvidenceIndexWithoutWaiting(): Promise<LocalWorkspaceTraceEvidenceIndex> {
    const value = await readJsonFile(this.evidenceIndexPath)
    if (isTraceEvidenceIndex(value)) return value
    const index = await this.bootstrapEvidenceIndexWithoutWaiting()
    await this.pruneEvidenceIndexWithoutWaiting(index)
    await writeJsonFile(this.evidenceIndexPath, index)
    return index
  }

  private async bootstrapEvidenceIndexWithoutWaiting(): Promise<LocalWorkspaceTraceEvidenceIndex> {
    const evidenceIdsByFileName = new Map<string, Set<string>>()
    for (const event of await this.readTraceEvents()) {
      let references: LocalWorkspaceTraceFileEvidenceReference[] = []
      if (event.recordType === 'session') references = event.evidence
      else if (event.recordType === 'gesture' && event.evidence) references = [event.evidence]
      for (const reference of references) {
        const fileName = path.basename(reference.path)
        const evidenceIds = evidenceIdsByFileName.get(fileName) ?? new Set<string>()
        evidenceIds.add(reference.evidenceId)
        evidenceIdsByFileName.set(fileName, evidenceIds)
      }
    }

    let fileNames: string[]
    try {
      fileNames = (await readdir(this.evidenceDirectoryPath)).filter((fileName) =>
        fileName.endsWith('.png')
      )
    } catch (error) {
      if (errorCode(error) === 'ENOENT') fileNames = []
      else throw error
    }
    const files: Array<{
      byteSize: number
      contentHash: string
      evidenceIds: string[]
      fileName: string
      modifiedAtMs: number
    }> = []
    for (const fileName of fileNames) {
      const filePath = this.evidenceFilePath(fileName)
      const details = await stat(filePath)
      const bytes = await readFile(filePath)
      files.push({
        byteSize: details.size,
        contentHash: evidenceContentHash(new Uint8Array(bytes)),
        evidenceIds: [...(evidenceIdsByFileName.get(fileName) ?? [])],
        fileName,
        modifiedAtMs: details.mtimeMs
      })
    }
    files.sort(
      (left, right) =>
        left.modifiedAtMs - right.modifiedAtMs || left.fileName.localeCompare(right.fileName)
    )
    return {
      contract: LOCAL_WORKSPACE_TRACE_EVIDENCE_INDEX_CONTRACT,
      entries: files.map((file, index) => ({
        byteSize: file.byteSize,
        contentHash: file.contentHash,
        evidenceIds: file.evidenceIds,
        fileNames: [file.fileName],
        pins: [],
        sequence: index + 1,
        status: 'ready'
      })),
      nextSequence: files.length + 1
    }
  }

  private evidenceFilePath(fileName: string): string {
    return path.join(this.evidenceDirectoryPath, fileName)
  }

  private async firstAvailableEvidencePath(
    entry: LocalWorkspaceTraceEvidenceIndexEntry
  ): Promise<string | null> {
    for (const fileName of entry.fileNames) {
      const filePath = this.evidenceFilePath(fileName)
      if (await this.fileExists(filePath)) return filePath
    }
    return null
  }

  private async evidenceStatusWithoutWaiting(
    index: LocalWorkspaceTraceEvidenceIndex,
    evidenceId: string
  ): Promise<LocalWorkspaceTraceEvidenceStatus> {
    const entry = index.entries.find((candidate) => candidate.evidenceIds.includes(evidenceId))
    if (entry?.status === 'evicted') return 'evicted'
    if (entry && (await this.firstAvailableEvidencePath(entry))) return 'ready'
    return (await this.fileExists(evidenceReference(this.rootPath, evidenceId).path))
      ? 'ready'
      : 'missing'
  }

  private async pruneEvidenceIndexWithoutWaiting(
    index: LocalWorkspaceTraceEvidenceIndex
  ): Promise<void> {
    let readyEntries = index.entries.filter((entry) => entry.status === 'ready')
    let readyBytes = readyEntries.reduce((total, entry) => total + entry.byteSize, 0)
    while (readyEntries.length > this.maxEvidenceCount || readyBytes > this.maxEvidenceBytes) {
      const candidate = readyEntries
        .filter((entry) => entry.pins.length === 0)
        .sort(
          (left, right) =>
            left.sequence - right.sequence || left.contentHash.localeCompare(right.contentHash)
        )
        .at(0)
      if (!candidate) break
      await Promise.all(
        candidate.fileNames.map((fileName) =>
          unlink(this.evidenceFilePath(fileName)).catch((error: unknown) => {
            if (errorCode(error) !== 'ENOENT') throw error
          })
        )
      )
      candidate.fileNames = []
      candidate.pins = []
      candidate.status = 'evicted'
      readyBytes -= candidate.byteSize
      readyEntries = readyEntries.filter((entry) => entry !== candidate)
    }
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
