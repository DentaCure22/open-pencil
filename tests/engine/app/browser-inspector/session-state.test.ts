import { afterEach, describe, expect, test } from 'bun:test'

import {
  browserInspectorState,
  removeBrowserElementSelection,
  type BrowserCaptureSession
} from '@/app/browser-inspector/state'
import { narratedTraceSession, narratedTraceStatus } from '@/app/narrated-trace'

function captureSession(): BrowserCaptureSession {
  const page = {
    origin: 'https://example.com',
    title: 'Patient chart',
    url: 'https://example.com/'
  }
  return {
    id: 'capture-1',
    page,
    recordings: [],
    selections: [
      {
        annotations: [{ comment: 'Change this', id: 'annotation-1', x: 10, y: 20 }],
        capturedAt: '2026-08-24T12:00:01.000Z',
        element: {
          accessibleName: 'Patient header',
          attributes: {},
          bounds: { height: 40, width: 200, x: 10, y: 20 },
          classes: [],
          role: 'heading',
          selector: '#patient-header',
          tag: 'h1',
          text: 'Patient header'
        },
        id: 'selection-1',
        page,
        session: {
          captureSessionId: 'capture-1',
          captureStartedAt: '2026-08-24T12:00:00.000Z',
          frameId: 0,
          sequence: 1,
          tabId: 1
        },
        snapshot: { dataUrl: 'data:image/png;base64,AQ==', height: 40, width: 200 },
        traceEventId: 'event-1'
      }
    ],
    startedAt: '2026-08-24T12:00:00.000Z',
    title: 'Patient chart'
  }
}

afterEach(() => {
  browserInspectorState.activeSessionId = null
  browserInspectorState.annotationRequest = null
  browserInspectorState.error = null
  browserInspectorState.expandedSessionId = null
  browserInspectorState.pickerStatus = 'idle'
  browserInspectorState.sessions = []
  narratedTraceSession.value = null
  narratedTraceStatus.value = 'idle'
})

describe('Inspect Chrome session projection', () => {
  test('deleting an annotation selection excludes its canonical Trace event', () => {
    browserInspectorState.sessions = [captureSession()]
    browserInspectorState.annotationRequest = {
      selectionId: 'selection-1',
      sessionId: 'capture-1'
    }
    narratedTraceSession.value = {
      contextDraft: [{ included: true, removed: false, sourceEventId: 'event-1' }],
      durationMs: 1_000,
      events: [
        {
          atMs: 1_000,
          id: 'event-1',
          kind: 'selection',
          label: 'Selected patient header from Chrome'
        }
      ],
      id: 'trace-1',
      startedAt: '2026-08-24T12:00:00.000Z'
    }

    removeBrowserElementSelection('capture-1', 'selection-1')

    expect(browserInspectorState.sessions[0]?.selections).toEqual([])
    expect(browserInspectorState.annotationRequest).toBeNull()
    expect(narratedTraceSession.value?.contextDraft).toEqual([
      { included: true, removed: true, sourceEventId: 'event-1' }
    ])
  })
})
