import {
  browserCaptureRecordingFile,
  browserCaptureSessionAgentContext,
  browserCaptureSessionSnapshotFiles
} from './context'
import type { BrowserCaptureDragPayload } from './drag'
import { getBrowserCaptureSession, type BrowserCaptureSession } from './state'

export const BROWSER_CAPTURE_ATTACHMENT_TYPE =
  'application/vnd.openpencil.browser-capture-session+json'

type BrowserCaptureAttachmentDescriptor = {
  agentContext: string
  annotationCount: number
  captureCount: number
  contract: 'openpencil-browser-capture-attachment/v1'
  recordingCount: number
  recordingId?: string
  selectionId?: string
  sessionId: string
  title: string
  traceSessionId?: string
}

type AttachedBrowserCapture = {
  descriptor: BrowserCaptureAttachmentDescriptor
  session: BrowserCaptureSession
}

const attachedCaptures = new WeakMap<File, AttachedBrowserCapture>()
const MAX_SESSION_CONTEXT_SELECTIONS = 5

function captureSequence(selection: BrowserCaptureSession['selections'][number]) {
  return selection.session.sequence ?? Number.MAX_SAFE_INTEGER
}

function boundedSessionSelections(session: BrowserCaptureSession, maximum: number) {
  const ordered = [...session.selections].sort(
    (left, right) => captureSequence(left) - captureSequence(right)
  )
  const prioritized = [
    ...ordered.filter((selection) => selection.annotations?.length),
    ...ordered.filter((selection) => !selection.annotations?.length)
  ].slice(0, Math.max(0, maximum))
  const selectedIds = new Set(prioritized.map((selection) => selection.id))
  return ordered.filter((selection) => selectedIds.has(selection.id))
}

function compactAgentContext(session: BrowserCaptureSession) {
  const visibleSelections = boundedSessionSelections(session, MAX_SESSION_CONTEXT_SELECTIONS)
  const context = browserCaptureSessionAgentContext({ ...session, selections: visibleSelections })
  const omitted = session.selections.length - visibleSelections.length
  return omitted > 0
    ? `${context}\n${String(omitted)} additional capture${omitted === 1 ? '' : 's'} omitted from the prompt; use the Trace session reference for the full sequence.`
    : context
}

function attachmentSession(
  session: BrowserCaptureSession,
  selectionId?: string,
  recordingId?: string
): BrowserCaptureSession | null {
  if (selectionId) {
    const selection = session.selections.find((candidate) => candidate.id === selectionId)
    return selection ? { ...session, recordings: [], selections: [selection] } : null
  }
  if (recordingId) {
    const recording = session.recordings.find((candidate) => candidate.id === recordingId)
    return recording ? { ...session, recordings: [recording], selections: [] } : null
  }
  return session
}

function descriptorFor(
  session: BrowserCaptureSession,
  selectionId?: string,
  recordingId?: string
): BrowserCaptureAttachmentDescriptor {
  return {
    agentContext: compactAgentContext(session),
    annotationCount: session.selections.reduce(
      (total, selection) => total + (selection.annotations?.length ?? 0),
      0
    ),
    captureCount: session.selections.length,
    contract: 'openpencil-browser-capture-attachment/v1',
    recordingCount: session.recordings.length,
    ...(recordingId ? { recordingId } : {}),
    ...(selectionId ? { selectionId } : {}),
    sessionId: session.id,
    title: session.title,
    ...(session.traceSessionId ? { traceSessionId: session.traceSessionId } : {})
  }
}

export function createBrowserCaptureAttachment(
  session: BrowserCaptureSession,
  selectionId?: string,
  recordingId?: string
): File | null {
  if (selectionId && recordingId) return null
  const attached = attachmentSession(session, selectionId, recordingId)
  if (!attached) return null
  const descriptor = descriptorFor(attached, selectionId, recordingId)
  const suffixIdentifier = selectionId || recordingId
  const suffix = suffixIdentifier ? '-' + suffixIdentifier : ''
  const file = new File(
    [JSON.stringify(descriptor)],
    `browser-capture-${session.id}${suffix}.json`,
    {
      lastModified: Date.parse(session.startedAt),
      type: BROWSER_CAPTURE_ATTACHMENT_TYPE
    }
  )
  attachedCaptures.set(file, { descriptor, session: attached })
  return file
}

export function browserCaptureAttachmentFromDrag(payload: BrowserCaptureDragPayload): File | null {
  const session = getBrowserCaptureSession(payload.sessionId)
  return session
    ? createBrowserCaptureAttachment(session, payload.selectionId, payload.recordingId)
    : null
}

export function isBrowserCaptureAttachment(file: File): boolean {
  return file.type === BROWSER_CAPTURE_ATTACHMENT_TYPE
}

export function browserCaptureAttachmentSummary(file: File): {
  annotationCount: number
  captureCount: number
  recordingCount: number
  title: string
  traceLinked: boolean
} | null {
  if (!isBrowserCaptureAttachment(file)) return null
  const descriptor = attachedCaptures.get(file)?.descriptor
  return descriptor
    ? {
        annotationCount: descriptor.annotationCount,
        captureCount: descriptor.captureCount,
        recordingCount: descriptor.recordingCount,
        title: descriptor.title,
        traceLinked: Boolean(descriptor.traceSessionId)
      }
    : {
        annotationCount: 0,
        captureCount: 1,
        recordingCount: 0,
        title: 'Chrome capture',
        traceLinked: true
      }
}

export type BrowserCaptureAttachmentPreview = {
  height: number
  imageUrl: string
  title: string
  width: number
}

export function browserCaptureAttachmentPreview(
  file: File
): BrowserCaptureAttachmentPreview | null {
  if (!isBrowserCaptureAttachment(file)) return null
  const attached = attachedCaptures.get(file)
  if (!attached) return null
  const { descriptor, session } = attached
  const selection = descriptor.selectionId
    ? session.selections.find((candidate) => candidate.id === descriptor.selectionId)
    : session.selections[0]
  const snapshot = selection?.snapshot
  if (!snapshot?.dataUrl || snapshot.width < 1 || snapshot.height < 1) return null
  return {
    height: snapshot.height,
    imageUrl: snapshot.dataUrl,
    title: descriptor.title,
    width: snapshot.width
  }
}

export function browserCaptureAttachmentKey(file: File): string | null {
  if (!isBrowserCaptureAttachment(file)) return null
  const descriptor = attachedCaptures.get(file)?.descriptor
  return descriptor
    ? `${descriptor.sessionId}:${descriptor.selectionId ?? descriptor.recordingId ?? '*'}`
    : `${file.name}:${String(file.lastModified)}`
}

export function browserCaptureAttachmentAgentContext(file: File): string | null {
  const session = attachedCaptures.get(file)?.session
  return session ? compactAgentContext(session) : null
}

export async function browserCaptureAttachmentEvidenceFiles(
  file: File,
  maximumFiles = 5
): Promise<File[]> {
  const attached = attachedCaptures.get(file)
  const limit = Math.max(0, Math.floor(maximumFiles))
  if (!attached || !limit) return []
  const { descriptor, session } = attached
  const recording = descriptor.selectionId ? undefined : session.recordings.at(-1)
  const recordingFile = recording
    ? await browserCaptureRecordingFile(recording).catch(() => null)
    : null
  const snapshotLimit = limit - (recordingFile ? 1 : 0)
  const snapshots = await browserCaptureSessionSnapshotFiles({
    ...session,
    selections: boundedSessionSelections(session, snapshotLimit)
  })
  return recordingFile ? [...snapshots, recordingFile] : snapshots
}

export async function resolveBrowserCaptureAttachments(
  attachments: File[],
  maximumFiles = 5
): Promise<{ attachments: File[]; contextPrompt?: string }> {
  const captures = attachments.filter(isBrowserCaptureAttachment)
  if (!captures.length) return { attachments }
  const captureContexts = captures.map((file) => ({
    context: browserCaptureAttachmentAgentContext(file),
    file
  }))
  const ordinary = [
    ...attachments.filter((file) => !isBrowserCaptureAttachment(file)),
    ...captureContexts.flatMap(({ context, file }) => (context ? [] : [file]))
  ]
  const resolvedCaptures = captureContexts.flatMap(({ context, file }) =>
    context ? [{ context, file }] : []
  )
  const contexts = resolvedCaptures.map(({ context }) => context)
  const evidenceLimit = Math.max(0, maximumFiles - ordinary.length)
  const evidence = (
    await Promise.all(
      resolvedCaptures.map(({ file }) =>
        browserCaptureAttachmentEvidenceFiles(file, evidenceLimit).catch(() => [])
      )
    )
  )
    .flat()
    .filter(
      (file, index, files) =>
        ordinary.every((candidate) => candidate.name !== file.name) &&
        files.findIndex((candidate) => candidate.name === file.name) === index
    )
    .slice(0, evidenceLimit)
  return {
    attachments: [...ordinary, ...evidence],
    ...(contexts.length ? { contextPrompt: contexts.join('\n\n') } : {})
  }
}
