import { uploadAgentAttachments } from '@/app/agent-chat/client'
import {
  attachNarratedTraceEvidence,
  captureNarratedTraceDisplayEvidence,
  markNarratedTraceEvidenceFailed,
  narratedTraceScopeForStore,
  narratedTraceSession,
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
  const accepted = acceptBrowserElementSelection(incoming)
  if (!accepted) return
  const { selection, session } = accepted
  const store = getActiveStore()
  const target = browserElementTraceTarget(selection)
  const eventId = recordNarratedTraceActivity(narratedTraceScopeForStore(store), {
    evidenceStatus: 'pending',
    kind: 'selection',
    label: `Selected ${target.name} from Chrome`,
    target,
    text: [
      `Chrome capture session ${session.id}`,
      `selection ${String(selection.session.sequence ?? session.selections.length)}`,
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
