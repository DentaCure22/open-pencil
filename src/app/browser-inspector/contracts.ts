import type { Rect } from '@open-pencil/scene-graph/primitives'

export const BROWSER_ELEMENT_EVENT_CONTRACT = 'openpencil-browser-element/v1'
export const BROWSER_ELEMENT_COMMAND_CONTRACT = 'openpencil-browser-element-command/v1'
export const BROWSER_ELEMENT_COMMAND_RESULT_CONTRACT =
  'openpencil-browser-element-command-result/v1'

export type BrowserElementAnnotation = {
  comment: string
  id: string
  x: number
  y: number
}

export type BrowserElementSelection = {
  annotations?: BrowserElementAnnotation[]
  capturedAt: string
  element: {
    accessibleName: string
    attributes: Record<string, string>
    bounds: Rect
    classes: string[]
    role: string
    selector: string
    tag: string
    text: string
  }
  id: string
  page: { origin: string; title: string; url: string }
  sourceWindow?: {
    devicePixelRatio: number
    innerHeight: number
    innerWidth: number
    outerHeight: number
    outerWidth: number
    screenX: number
    screenY: number
  }
  session: {
    captureSessionId?: string
    captureStartedAt?: string
    documentId?: string
    frameId: number
    sequence?: number
    tabId: number
  }
  snapshot: { dataUrl: string; height: number; width: number }
  surfacePreview?: { dataUrl: string; height: number; width: number }
  traceEventId?: string
}

export type BrowserCaptureRecording = {
  attachment?: {
    name: string
    path: string
    size?: number
    type?: string
  }
  captureSessionId: string
  dataUrl: string
  durationMs: number
  endedAt: string
  id: string
  mimeType: string
  startedAt: string
  traceEventId?: string
}

export type BrowserElementEvent =
  | {
      annotations: BrowserElementAnnotation[]
      captureSessionId: string
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'annotations-updated'
      selectionId: string
    }
  | {
      captureSessionId: string
      captureStartedAt: string
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'annotate-requested'
      selectionId: string
      sequence: number
    }
  | {
      captureSessionId: string
      captureStartedAt: string
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'picker-started'
      page: BrowserElementSelection['page']
    }
  | {
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'selection'
      selection: BrowserElementSelection
    }
  | {
      captureSessionId: string
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'selection-removed'
      selectionId: string
    }
  | {
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      captureSessionId?: string
      captureStartedAt?: string
      endedAt?: string
      kind: 'picker-ended'
      reason?: string
    }
  | {
      captureSessionId: string
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'recording-started'
      mimeType: string
      startedAt: string
    }
  | {
      captureSessionId: string
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'recording-failed'
      reason: string
    }
  | {
      contract: typeof BROWSER_ELEMENT_EVENT_CONTRACT
      kind: 'recording'
      recording: BrowserCaptureRecording
    }

export type BrowserElementPickerCommand = {
  command: { kind: 'activate-picker' }
  contract: typeof BROWSER_ELEMENT_COMMAND_CONTRACT
  requestId: string
}

export type BrowserElementCommandResult = {
  contract: typeof BROWSER_ELEMENT_COMMAND_RESULT_CONTRACT
  ok: boolean
  reason?: string
  requestId: string
}

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function httpUrl(value: unknown): value is string {
  if (!boundedString(value, 4_096)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function httpOrigin(value: unknown): value is string {
  if (!boundedString(value, 512)) return false
  try {
    const url = new URL(value)
    return url.origin === value && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
}

function validBounds(value: UnknownRecord | null) {
  return Boolean(
    value &&
    finiteNumber(value.x) &&
    finiteNumber(value.y) &&
    finiteNumber(value.width) &&
    finiteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  )
}

function validAttributes(value: UnknownRecord | null): value is Record<string, string> {
  return Boolean(
    value &&
    Object.keys(value).length <= 24 &&
    Object.entries(value).every(
      ([name, entry]) => boundedString(name, 80) && boundedString(entry, 500)
    )
  )
}

function validElement(value: UnknownRecord | null) {
  if (!value || !validBounds(record(value.bounds)) || !validAttributes(record(value.attributes))) {
    return false
  }
  return (
    boundedString(value.accessibleName, 500) &&
    boundedString(value.role, 160) &&
    boundedString(value.selector, 1_024) &&
    boundedString(value.tag, 80) &&
    boundedString(value.text, 1_000) &&
    Array.isArray(value.classes) &&
    value.classes.length <= 24 &&
    value.classes.every((entry) => boundedString(entry, 160))
  )
}

function validPage(value: UnknownRecord | null) {
  return Boolean(
    value && httpOrigin(value.origin) && boundedString(value.title, 500) && httpUrl(value.url)
  )
}

function validSession(value: UnknownRecord | null) {
  return Boolean(
    value &&
    Number.isSafeInteger(value.frameId) &&
    Number.isSafeInteger(value.tabId) &&
    (value.documentId === undefined || boundedString(value.documentId, 128)) &&
    (value.captureSessionId === undefined || boundedString(value.captureSessionId, 128)) &&
    (value.captureStartedAt === undefined || validTimestamp(value.captureStartedAt)) &&
    (value.sequence === undefined ||
      (Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0))
  )
}

function validSnapshot(value: UnknownRecord | null) {
  return Boolean(
    value &&
    boundedString(value.dataUrl, 2_000_000) &&
    value.dataUrl.startsWith('data:image/') &&
    finiteNumber(value.width) &&
    finiteNumber(value.height) &&
    value.width > 0 &&
    value.height > 0
  )
}

function validSourceWindow(value: unknown) {
  if (value === undefined) return true
  const candidate = record(value)
  return Boolean(
    candidate &&
    finiteNumber(candidate.screenX) &&
    finiteNumber(candidate.screenY) &&
    finiteNumber(candidate.outerWidth) &&
    candidate.outerWidth > 0 &&
    finiteNumber(candidate.outerHeight) &&
    candidate.outerHeight > 0 &&
    finiteNumber(candidate.innerWidth) &&
    candidate.innerWidth > 0 &&
    finiteNumber(candidate.innerHeight) &&
    candidate.innerHeight > 0 &&
    finiteNumber(candidate.devicePixelRatio) &&
    candidate.devicePixelRatio > 0
  )
}

function validTimestamp(value: unknown): value is string {
  return boundedString(value, 64) && Boolean(value) && Number.isFinite(Date.parse(value))
}

function validAnnotations(value: unknown): value is BrowserElementAnnotation[] {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 64 &&
      value.every((entry) => {
        const annotation = record(entry)
        return Boolean(
          annotation &&
          boundedString(annotation.id, 128) &&
          annotation.id &&
          boundedString(annotation.comment, 2_000) &&
          finiteNumber(annotation.x) &&
          annotation.x >= 0 &&
          annotation.x <= 1 &&
          finiteNumber(annotation.y) &&
          annotation.y >= 0 &&
          annotation.y <= 1
        )
      }))
  )
}

function validRecording(value: UnknownRecord | null): value is BrowserCaptureRecording {
  return Boolean(
    value &&
    boundedString(value.captureSessionId, 128) &&
    value.captureSessionId &&
    boundedString(value.id, 128) &&
    value.id &&
    validTimestamp(value.startedAt) &&
    validTimestamp(value.endedAt) &&
    finiteNumber(value.durationMs) &&
    value.durationMs >= 0 &&
    value.durationMs <= 60_000 &&
    boundedString(value.mimeType, 160) &&
    value.mimeType.startsWith('video/webm') &&
    boundedString(value.dataUrl, 20_000_000) &&
    value.dataUrl.startsWith('data:video/webm') &&
    value.attachment === undefined &&
    value.traceEventId === undefined
  )
}

function browserElementSelection(value: unknown): BrowserElementSelection | null {
  const candidate = record(value)
  if (
    !candidate ||
    !boundedString(candidate.id, 128) ||
    !candidate.id ||
    !validTimestamp(candidate.capturedAt) ||
    !validElement(record(candidate.element)) ||
    !validPage(record(candidate.page)) ||
    !validSession(record(candidate.session)) ||
    !validSnapshot(record(candidate.snapshot)) ||
    (candidate.surfacePreview !== undefined && !validSnapshot(record(candidate.surfacePreview))) ||
    !validSourceWindow(candidate.sourceWindow) ||
    !validAnnotations(candidate.annotations) ||
    (candidate.traceEventId !== undefined && !boundedString(candidate.traceEventId, 128))
  ) {
    return null
  }
  return structuredClone(value) as BrowserElementSelection
}

function parseAnnotateRequested(candidate: UnknownRecord): BrowserElementEvent | null {
  const sequence = candidate.sequence
  if (
    !boundedString(candidate.captureSessionId, 128) ||
    !candidate.captureSessionId ||
    !validTimestamp(candidate.captureStartedAt) ||
    !boundedString(candidate.selectionId, 128) ||
    !candidate.selectionId ||
    !Number.isSafeInteger(sequence) ||
    typeof sequence !== 'number' ||
    sequence < 1
  ) {
    return null
  }
  return {
    captureSessionId: candidate.captureSessionId,
    captureStartedAt: candidate.captureStartedAt,
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    kind: 'annotate-requested',
    selectionId: candidate.selectionId,
    sequence
  }
}

function parseAnnotationsUpdated(candidate: UnknownRecord): BrowserElementEvent | null {
  if (
    !boundedString(candidate.captureSessionId, 128) ||
    !candidate.captureSessionId ||
    !boundedString(candidate.selectionId, 128) ||
    !candidate.selectionId ||
    !Array.isArray(candidate.annotations) ||
    !validAnnotations(candidate.annotations)
  ) {
    return null
  }
  return {
    annotations: structuredClone(candidate.annotations),
    captureSessionId: candidate.captureSessionId,
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    kind: 'annotations-updated',
    selectionId: candidate.selectionId
  }
}

function parseSelectionRemoved(candidate: UnknownRecord): BrowserElementEvent | null {
  if (
    !boundedString(candidate.captureSessionId, 128) ||
    !candidate.captureSessionId ||
    !boundedString(candidate.selectionId, 128) ||
    !candidate.selectionId
  ) {
    return null
  }
  return {
    captureSessionId: candidate.captureSessionId,
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    kind: 'selection-removed',
    selectionId: candidate.selectionId
  }
}

function parsePickerStarted(candidate: UnknownRecord): BrowserElementEvent | null {
  const captureStartedAt = candidate.captureStartedAt ?? candidate.startedAt
  if (
    !boundedString(candidate.captureSessionId, 128) ||
    !candidate.captureSessionId ||
    !validTimestamp(captureStartedAt) ||
    !validPage(record(candidate.page))
  ) {
    return null
  }
  return {
    captureSessionId: candidate.captureSessionId,
    captureStartedAt,
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    kind: 'picker-started',
    page: structuredClone(candidate.page) as BrowserElementSelection['page']
  }
}

function parsePickerEnded(candidate: UnknownRecord): BrowserElementEvent | null {
  if (
    (candidate.captureSessionId !== undefined && !boundedString(candidate.captureSessionId, 128)) ||
    (candidate.captureStartedAt !== undefined && !validTimestamp(candidate.captureStartedAt)) ||
    (candidate.endedAt !== undefined && !validTimestamp(candidate.endedAt)) ||
    (candidate.reason !== undefined && !boundedString(candidate.reason, 500))
  ) {
    return null
  }
  return {
    ...(candidate.captureSessionId ? { captureSessionId: candidate.captureSessionId } : {}),
    ...(candidate.captureStartedAt ? { captureStartedAt: candidate.captureStartedAt } : {}),
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    ...(candidate.endedAt ? { endedAt: candidate.endedAt } : {}),
    kind: 'picker-ended',
    ...(candidate.reason ? { reason: candidate.reason } : {})
  }
}

function parseRecordingStarted(candidate: UnknownRecord): BrowserElementEvent | null {
  if (
    !boundedString(candidate.captureSessionId, 128) ||
    !candidate.captureSessionId ||
    !validTimestamp(candidate.startedAt) ||
    !boundedString(candidate.mimeType, 160) ||
    !candidate.mimeType.startsWith('video/webm')
  ) {
    return null
  }
  return {
    captureSessionId: candidate.captureSessionId,
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    kind: 'recording-started',
    mimeType: candidate.mimeType,
    startedAt: candidate.startedAt
  }
}

function parseRecordingFailed(candidate: UnknownRecord): BrowserElementEvent | null {
  if (
    !boundedString(candidate.captureSessionId, 128) ||
    !candidate.captureSessionId ||
    !boundedString(candidate.reason, 500) ||
    !candidate.reason
  ) {
    return null
  }
  return {
    captureSessionId: candidate.captureSessionId,
    contract: BROWSER_ELEMENT_EVENT_CONTRACT,
    kind: 'recording-failed',
    reason: candidate.reason
  }
}

function parseRecording(candidate: UnknownRecord): BrowserElementEvent | null {
  const recording = record(candidate.recording)
  return validRecording(recording)
    ? {
        contract: BROWSER_ELEMENT_EVENT_CONTRACT,
        kind: 'recording',
        recording: structuredClone(recording)
      }
    : null
}

function parseSelection(candidate: UnknownRecord): BrowserElementEvent | null {
  const selection = browserElementSelection(candidate.selection)
  return selection
    ? { contract: BROWSER_ELEMENT_EVENT_CONTRACT, kind: 'selection', selection }
    : null
}

export function parseBrowserElementEvent(value: unknown): BrowserElementEvent | null {
  const candidate = record(value)
  if (candidate?.contract !== BROWSER_ELEMENT_EVENT_CONTRACT) return null
  if (candidate.kind === 'annotations-updated') return parseAnnotationsUpdated(candidate)
  if (candidate.kind === 'annotate-requested') return parseAnnotateRequested(candidate)
  if (candidate.kind === 'picker-started') return parsePickerStarted(candidate)
  if (candidate.kind === 'picker-ended') return parsePickerEnded(candidate)
  if (candidate.kind === 'recording-started') return parseRecordingStarted(candidate)
  if (candidate.kind === 'recording-failed') return parseRecordingFailed(candidate)
  if (candidate.kind === 'recording') return parseRecording(candidate)
  if (candidate.kind === 'selection-removed') return parseSelectionRemoved(candidate)
  return candidate.kind === 'selection' ? parseSelection(candidate) : null
}

export function parseBrowserElementCommandResult(
  value: unknown
): BrowserElementCommandResult | null {
  const candidate = record(value)
  if (
    candidate?.contract !== BROWSER_ELEMENT_COMMAND_RESULT_CONTRACT ||
    typeof candidate.ok !== 'boolean' ||
    !boundedString(candidate.requestId, 128) ||
    !candidate.requestId ||
    (candidate.reason !== undefined && typeof candidate.reason !== 'string')
  ) {
    return null
  }
  return {
    contract: BROWSER_ELEMENT_COMMAND_RESULT_CONTRACT,
    ok: candidate.ok,
    ...(candidate.reason ? { reason: candidate.reason } : {}),
    requestId: candidate.requestId
  }
}
