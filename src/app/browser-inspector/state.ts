import { computed, reactive } from 'vue'

import { noteNarratedTraceEvent } from '@/app/narrated-trace'
import { IS_BROWSER } from '@/constants'

import {
  BROWSER_ELEMENT_COMMAND_CONTRACT,
  parseBrowserElementCommandResult,
  type BrowserCaptureRecording,
  type BrowserElementAnnotation,
  type BrowserElementPickerCommand,
  type BrowserElementSelection
} from './contracts'

export type BrowserInspectorPickerStatus = 'active' | 'idle' | 'requesting'

export type BrowserCaptureSession = {
  endedAt?: string
  id: string
  page: BrowserElementSelection['page']
  pages?: BrowserElementSelection['page'][]
  recordingStatus?: 'recording'
  recordings: BrowserCaptureRecording[]
  selections: BrowserElementSelection[]
  startedAt: string
  title: string
  traceSessionId?: string
}

export const browserInspectorState = reactive<{
  activeSessionId: string | null
  annotationRequest: { selectionId: string; sessionId: string } | null
  error: string | null
  expandedSessionId: string | null
  pickerStatus: BrowserInspectorPickerStatus
  sessions: BrowserCaptureSession[]
}>({
  activeSessionId: null,
  annotationRequest: null,
  error: null,
  expandedSessionId: null,
  pickerStatus: 'idle',
  sessions: []
})

export const browserCaptureSessions = computed(() => browserInspectorState.sessions)
export const activeBrowserCaptureSession = computed(() =>
  browserInspectorState.sessions.find(
    (session) => session.id === browserInspectorState.activeSessionId
  )
)
export const selectedBrowserCaptureSession = computed(() => {
  const sessionId = browserInspectorState.expandedSessionId
  return (
    browserInspectorState.sessions.find((session) => session.id === sessionId) ??
    browserInspectorState.sessions.at(-1)
  )
})
export const selectedBrowserElement = computed(
  () => selectedBrowserCaptureSession.value?.selections.at(-1) ?? null
)

function compactSessionTitle(value: string) {
  const compact = value.replaceAll(/\s+/g, ' ').trim()
  return compact.length <= 28 ? compact : `${compact.slice(0, 27)}…`
}

function sessionPages(session: Pick<BrowserCaptureSession, 'page' | 'pages'>) {
  return session.pages?.length ? session.pages : [session.page]
}

function addSessionPage(session: BrowserCaptureSession, page: BrowserElementSelection['page']) {
  const pages = sessionPages(session)
  if (!pages.some((candidate) => candidate.url === page.url)) pages.push(structuredClone(page))
  session.pages = pages
}

export function browserCaptureSessionTitle(
  pages: BrowserElementSelection['page'][],
  startedAt: string
) {
  const page = pages.at(-1)
  const pageName = compactSessionTitle(
    pages.length > 1
      ? `Chrome · ${String(pages.length)} tabs`
      : page?.title || (page ? new URL(page.url).hostname : '') || 'Chrome'
  )
  const date = new Date(startedAt)
  const time = Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
  return time ? `${pageName} · ${time}` : pageName
}

export function getBrowserCaptureSession(sessionId: string) {
  return browserInspectorState.sessions.find((session) => session.id === sessionId)
}

export function startBrowserCaptureSession(input: {
  captureSessionId: string
  page: BrowserElementSelection['page']
  startedAt: string
}) {
  browserInspectorState.error = null
  browserInspectorState.pickerStatus = 'active'
  browserInspectorState.activeSessionId = input.captureSessionId
  const existing = getBrowserCaptureSession(input.captureSessionId)
  if (existing) {
    existing.endedAt = undefined
    existing.page = structuredClone(input.page)
    addSessionPage(existing, input.page)
    existing.title = browserCaptureSessionTitle(sessionPages(existing), existing.startedAt)
  } else {
    browserInspectorState.sessions.push({
      id: input.captureSessionId,
      page: structuredClone(input.page),
      pages: [structuredClone(input.page)],
      recordings: [],
      selections: [],
      startedAt: input.startedAt,
      title: browserCaptureSessionTitle([input.page], input.startedAt)
    })
  }
  browserInspectorState.expandedSessionId = input.captureSessionId
}

function captureSessionIdentity(selection: BrowserElementSelection) {
  return (
    selection.session.captureSessionId ??
    `legacy-${String(selection.session.tabId)}-${selection.id}`
  )
}

export function acceptBrowserElementSelection(selection: BrowserElementSelection) {
  const captureSessionId = captureSessionIdentity(selection)
  let session = getBrowserCaptureSession(captureSessionId)
  if (!session) {
    const startedAt = selection.session.captureStartedAt ?? selection.capturedAt
    startBrowserCaptureSession({ captureSessionId, page: selection.page, startedAt })
    session = getBrowserCaptureSession(captureSessionId)
  }
  if (!session) return null

  const normalized: BrowserElementSelection = {
    ...structuredClone(selection),
    annotations: selection.annotations ?? [],
    session: {
      ...selection.session,
      captureSessionId,
      captureStartedAt: selection.session.captureStartedAt ?? session.startedAt,
      sequence: selection.session.sequence ?? session.selections.length + 1
    }
  }
  const existingIndex = session.selections.findIndex((candidate) => candidate.id === normalized.id)
  if (existingIndex === -1) session.selections.push(normalized)
  else session.selections.splice(existingIndex, 1, normalized)
  session.page = structuredClone(selection.page)
  addSessionPage(session, selection.page)
  session.title = browserCaptureSessionTitle(sessionPages(session), session.startedAt)
  browserInspectorState.error = null
  browserInspectorState.pickerStatus = 'active'
  browserInspectorState.activeSessionId = captureSessionId
  browserInspectorState.expandedSessionId = captureSessionId
  return { selection: normalized, session }
}

export function selectBrowserCaptureSession(sessionId: string | null) {
  browserInspectorState.expandedSessionId =
    browserInspectorState.expandedSessionId === sessionId ? null : sessionId
}

export function requestBrowserElementAnnotation(sessionId: string, selectionId: string) {
  if (!getBrowserCaptureSession(sessionId)?.selections.some((item) => item.id === selectionId)) {
    return
  }
  browserInspectorState.expandedSessionId = sessionId
  browserInspectorState.annotationRequest = { selectionId, sessionId }
}

export function clearBrowserElementAnnotationRequest() {
  browserInspectorState.annotationRequest = null
}

export function removeBrowserCaptureSession(sessionId: string) {
  const index = browserInspectorState.sessions.findIndex((session) => session.id === sessionId)
  if (index === -1) return
  browserInspectorState.sessions.splice(index, 1)
  if (browserInspectorState.expandedSessionId === sessionId) {
    browserInspectorState.expandedSessionId = browserInspectorState.sessions.at(-1)?.id ?? null
  }
  if (browserInspectorState.activeSessionId === sessionId) {
    browserInspectorState.activeSessionId = null
  }
  browserInspectorState.error = null
}

export function removeBrowserElementSelection(sessionId: string, selectionId: string) {
  const session = getBrowserCaptureSession(sessionId)
  if (!session) return
  const index = session.selections.findIndex((selection) => selection.id === selectionId)
  if (index !== -1) session.selections.splice(index, 1)
}

export function removeBrowserCaptureRecording(sessionId: string, recordingId: string) {
  const session = getBrowserCaptureSession(sessionId)
  if (!session) return
  const index = session.recordings.findIndex((recording) => recording.id === recordingId)
  if (index !== -1) session.recordings.splice(index, 1)
}

export function updateBrowserElementAnnotations(
  sessionId: string,
  selectionId: string,
  annotations: BrowserElementAnnotation[]
) {
  const selection = getBrowserCaptureSession(sessionId)?.selections.find(
    (candidate) => candidate.id === selectionId
  )
  if (!selection) return
  selection.annotations = structuredClone(annotations)
  if (selection.traceEventId) {
    noteNarratedTraceEvent(
      selection.traceEventId,
      annotations
        .map((annotation, index) =>
          annotation.comment.trim()
            ? `${String(index + 1)}. ${annotation.comment.trim()} (${String(Math.round(annotation.x * 100))}%, ${String(Math.round(annotation.y * 100))}%)`
            : ''
        )
        .filter(Boolean)
        .join('\n')
    )
  }
}

export function linkBrowserCaptureSelectionToTrace(
  sessionId: string,
  selectionId: string,
  traceSessionId: string,
  traceEventId: string
) {
  const session = getBrowserCaptureSession(sessionId)
  const selection = session?.selections.find((candidate) => candidate.id === selectionId)
  if (!session || !selection) return
  session.traceSessionId = traceSessionId
  selection.traceEventId = traceEventId
}

export function linkBrowserCaptureRecordingToTrace(
  sessionId: string,
  recordingId: string,
  traceSessionId: string,
  traceEventId: string
) {
  const session = getBrowserCaptureSession(sessionId)
  const recording = session?.recordings.find((candidate) => candidate.id === recordingId)
  if (!session || !recording) return
  session.traceSessionId = traceSessionId
  recording.traceEventId = traceEventId
}

export function setBrowserCaptureRecordingAttachment(
  sessionId: string,
  recordingId: string,
  attachment: NonNullable<BrowserCaptureRecording['attachment']>
) {
  const recording = getBrowserCaptureSession(sessionId)?.recordings.find(
    (candidate) => candidate.id === recordingId
  )
  if (recording) recording.attachment = structuredClone(attachment)
}

export function startBrowserCaptureRecording(captureSessionId: string) {
  const session = getBrowserCaptureSession(captureSessionId)
  if (session) session.recordingStatus = 'recording'
}

export function failBrowserCaptureRecording(captureSessionId: string, reason: string) {
  const session = getBrowserCaptureSession(captureSessionId)
  if (session) session.recordingStatus = undefined
  browserInspectorState.error =
    reason === 'recording-unavailable'
      ? 'Chrome motion recording is unavailable on this page.'
      : 'Chrome motion recording could not be saved.'
}

export function acceptBrowserCaptureRecording(recording: BrowserCaptureRecording) {
  const session = getBrowserCaptureSession(recording.captureSessionId)
  if (!session) return
  session.recordingStatus = undefined
  const existingIndex = session.recordings.findIndex((candidate) => candidate.id === recording.id)
  if (existingIndex === -1) session.recordings.push(structuredClone(recording))
  else session.recordings.splice(existingIndex, 1, structuredClone(recording))
}

export function clearBrowserElementSelection() {
  const session = selectedBrowserCaptureSession.value
  const selection = session?.selections.at(-1)
  if (session && selection) removeBrowserElementSelection(session.id, selection.id)
  browserInspectorState.error = null
}

export function setBrowserInspectorError(message: string | null) {
  browserInspectorState.error = message
}

export function finishBrowserElementPicker(
  reason?: string,
  captureSessionId?: string,
  endedAt = new Date().toISOString()
) {
  const sessionId = captureSessionId ?? browserInspectorState.activeSessionId
  const session = sessionId ? getBrowserCaptureSession(sessionId) : undefined
  if (session) {
    session.endedAt = endedAt
    session.recordingStatus = undefined
  }
  if (!captureSessionId || browserInspectorState.activeSessionId === captureSessionId) {
    browserInspectorState.activeSessionId = null
    browserInspectorState.pickerStatus = 'idle'
  }
  browserInspectorState.error =
    reason && !['cancelled', 'escape', 'finished'].includes(reason)
      ? pickerFailureMessage(reason)
      : null
}

function pickerFailureMessage(reason?: string) {
  if (reason === 'no-source-tab') {
    return 'Chrome selector has no target. Reload the extension and try again.'
  }
  if (reason === 'source-access-required') {
    return 'Chrome cannot inspect this page.'
  }
  if (reason === 'restricted-page') return 'Chrome cannot inspect this page.'
  if (reason === 'extension-unavailable') return 'Reload the OpenPencil Chrome extension.'
  if (reason === 'selection-failed') return 'Chrome could not capture that element.'
  return reason || 'Chrome inspection could not start.'
}

export function requestBrowserElementPicker(timeoutMs = 2_500): Promise<boolean> {
  if (!IS_BROWSER) return Promise.resolve(false)
  const requestId = globalThis.crypto.randomUUID()
  const command: BrowserElementPickerCommand = {
    command: { kind: 'activate-picker' },
    contract: BROWSER_ELEMENT_COMMAND_CONTRACT,
    requestId
  }
  browserInspectorState.error = null
  browserInspectorState.pickerStatus = 'requesting'

  return new Promise((resolve) => {
    const finish = (ok: boolean, reason?: string) => {
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
      browserInspectorState.pickerStatus = ok ? 'active' : 'idle'
      browserInspectorState.error = ok ? null : pickerFailureMessage(reason)
      resolve(ok)
    }
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const result = parseBrowserElementCommandResult(event.data)
      if (!result || result.requestId !== requestId) return
      finish(result.ok, result.reason)
    }
    const timer = window.setTimeout(() => finish(false, 'extension-unavailable'), timeoutMs)
    window.addEventListener('message', receive)
    window.postMessage(command, window.location.origin)
  })
}
