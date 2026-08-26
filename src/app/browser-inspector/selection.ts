import { uploadAgentAttachments } from '@/app/agent-chat/attachment-transfer'
import {
  attachNarratedTraceEvidence,
  beginNarratedTraceEpisode,
  beginNarratedTraceSession,
  captureNarratedTraceDisplayEvidence,
  finishNarratedTraceEpisode,
  finishNarratedTraceSession,
  markNarratedTraceEvidenceFailed,
  narratedTraceScopeForStore,
  narratedTraceSession,
  narratedTraceStatus,
  noteNarratedTraceEvent,
  recordNarratedTraceActivity
} from '@/app/narrated-trace'
import { toast } from '@/app/shell/ui'
import { getActiveStore } from '@/app/tabs'

import {
  browserCaptureRecordingFile,
  browserElementLabel,
  browserElementTraceTarget
} from './context'
import type { BrowserCaptureRecording, BrowserElementSelection } from './contracts'
import {
  acceptBrowserCaptureRecording,
  acceptBrowserElementSelection,
  linkBrowserCaptureRecordingToTrace,
  linkBrowserCaptureSelectionToTrace,
  setBrowserCaptureRecordingAttachment,
  setBrowserInspectorError
} from './state'

type BrowserTraceBinding = {
  episodeId: string
  traceSessionId: string
}

const browserTraceBindings = new Map<string, BrowserTraceBinding>()

function chromeEpisodeId(captureSessionId: string) {
  return `chrome:${captureSessionId}`
}

export function beginBrowserCaptureTrace(input: {
  captureSessionId: string
  page: BrowserElementSelection['page']
}) {
  const existing = browserTraceBindings.get(input.captureSessionId)
  if (existing && narratedTraceSession.value?.id === existing.traceSessionId) {
    return { ...existing, traceTag: narratedTraceSession.value.tag }
  }

  const scope = narratedTraceScopeForStore(getActiveStore())
  if (narratedTraceStatus.value === 'recording') finishNarratedTraceSession()
  beginNarratedTraceSession(scope, {
    tagSeed: input.page.title || new URL(input.page.url).hostname,
    title: `Inspect Chrome · ${input.page.title || new URL(input.page.url).hostname}`
  })
  const traceSession = narratedTraceSession.value
  if (!traceSession || narratedTraceStatus.value !== 'recording') return null
  const episodeId = chromeEpisodeId(input.captureSessionId)
  beginNarratedTraceEpisode({
    id: episodeId,
    kind: 'chrome',
    label: input.page.title || input.page.url,
    sourceSessionId: input.captureSessionId
  })
  const binding = { episodeId, traceSessionId: traceSession.id }
  browserTraceBindings.set(input.captureSessionId, binding)
  return { ...binding, traceTag: traceSession.tag }
}

export function finishBrowserCaptureTrace(captureSessionId: string) {
  const binding = browserTraceBindings.get(captureSessionId)
  if (!binding) return
  browserTraceBindings.delete(captureSessionId)
  if (narratedTraceSession.value?.id !== binding.traceSessionId) return
  finishNarratedTraceEpisode(binding.episodeId)
  finishNarratedTraceSession()
}

async function attachSelectionEvidence(
  selection: BrowserElementSelection,
  traceSessionId: string,
  eventId: string
) {
  const target = browserElementTraceTarget(selection)
  const bounds = {
    height: selection.snapshot.height,
    width: selection.snapshot.width,
    x: 0,
    y: 0
  }
  try {
    const evidence = await captureNarratedTraceDisplayEvidence({
      annotation: {
        bounds,
        color: '#7c3aed',
        kind: 'focus',
        points: [],
        strokeWidth: 0
      },
      annotationBaked: true,
      capturedAtMs: Date.parse(selection.capturedAt),
      cropBounds: bounds,
      imageUrl: selection.snapshot.dataUrl,
      maxEdge: 1_024,
      sessionId: traceSessionId,
      source: 'frame-snapshot',
      sourceCropBounds: bounds,
      target
    })
    if (evidence) attachNarratedTraceEvidence(eventId, evidence)
    else markNarratedTraceEvidenceFailed(eventId)
  } catch {
    markNarratedTraceEvidenceFailed(eventId)
  }
}

export function commitBrowserElementSelection(incoming: BrowserElementSelection) {
  beginBrowserCaptureTrace({
    captureSessionId:
      incoming.session.captureSessionId ??
      `legacy-${String(incoming.session.tabId)}-${incoming.id}`,
    page: incoming.page
  })
  const accepted = acceptBrowserElementSelection(incoming)
  if (!accepted) return
  const { selection, session } = accepted
  const store = getActiveStore()
  const target = browserElementTraceTarget(selection)
  const sequence = selection.session.sequence ?? session.selections.length
  const episodeId = session.traceEpisodeId ?? chromeEpisodeId(session.id)
  const eventId = recordNarratedTraceActivity(narratedTraceScopeForStore(store), {
    evidenceStatus: 'pending',
    kind: 'selection',
    label: `Selected ${target.name} from Chrome`,
    origin: {
      episodeId,
      kind: 'chrome',
      reference: `Annotation #${String(sequence)}`,
      sequence,
      sourceSessionId: session.id
    },
    target,
    text: [
      `Chrome capture session ${session.id}`,
      `Annotation #${String(sequence)}`,
      `${selection.element.selector} on ${selection.page.url}`
    ].join(' · ')
  })
  const traceSessionId = narratedTraceSession.value?.id
  if (eventId && traceSessionId) {
    linkBrowserCaptureSelectionToTrace(session.id, selection.id, traceSessionId, eventId)
    void attachSelectionEvidence(selection, traceSessionId, eventId)
  }
  toast.info(`${browserElementLabel(selection)} added to ${session.title}`)
}

export function commitBrowserCaptureRecording(recording: BrowserCaptureRecording) {
  acceptBrowserCaptureRecording(recording)
  const store = getActiveStore()
  const eventId = recordNarratedTraceActivity(narratedTraceScopeForStore(store), {
    durationMs: recording.durationMs,
    kind: 'screenshot',
    label: 'Recorded Chrome motion',
    origin: {
      episodeId: chromeEpisodeId(recording.captureSessionId),
      kind: 'chrome',
      sourceSessionId: recording.captureSessionId
    },
    target: {
      elementKind: 'container',
      name: 'Chrome capture session',
      path: ['Chrome', recording.captureSessionId, 'Motion recording'],
      stableId: `browser:${recording.captureSessionId}:recording:${recording.id}`
    },
    text: `Chrome capture session ${recording.captureSessionId} · ${String(Math.round(recording.durationMs / 1_000))}s motion recording`
  })
  const traceSessionId = narratedTraceSession.value?.id
  if (eventId && traceSessionId) {
    linkBrowserCaptureRecordingToTrace(
      recording.captureSessionId,
      recording.id,
      traceSessionId,
      eventId
    )
  }
  void persistBrowserCaptureRecording(recording, eventId, traceSessionId)
}

async function persistBrowserCaptureRecording(
  recording: BrowserCaptureRecording,
  eventId: string | null,
  traceSessionId?: string
) {
  try {
    const file = await browserCaptureRecordingFile(recording)
    const [attachment] = await uploadAgentAttachments([file])
    setBrowserCaptureRecordingAttachment(recording.captureSessionId, recording.id, attachment)
    if (eventId) {
      noteNarratedTraceEvent(
        eventId,
        [
          `Trace session: ${traceSessionId ?? 'unavailable'}`,
          `Motion recording: ${attachment.path}`,
          `${String(Math.round(recording.durationMs / 1_000))}s · ${recording.mimeType}`
        ].join('\n')
      )
    }
  } catch {
    setBrowserInspectorError(
      'Motion was captured, but its durable Trace attachment could not be saved.'
    )
  }
}
