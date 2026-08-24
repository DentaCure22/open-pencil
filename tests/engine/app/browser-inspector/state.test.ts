import { beforeEach, describe, expect, test } from 'bun:test'

import type { BrowserElementSelection } from '@/app/browser-inspector/contracts'
import {
  acceptBrowserElementSelection,
  browserInspectorState,
  removeBrowserCaptureSession,
  setBrowserCaptureSessionExpanded,
  selectBrowserCaptureSession,
  startBrowserCaptureSession,
  updateBrowserElementAnnotations
} from '@/app/browser-inspector/state'

const page = {
  origin: 'https://example.com',
  title: 'Patient editor',
  url: 'https://example.com/patients/1'
}

function selection(id: string, sequence: number): BrowserElementSelection {
  return {
    capturedAt: `2026-08-22T12:00:0${String(sequence)}.000Z`,
    element: {
      accessibleName: `Patient control ${String(sequence)}`,
      attributes: {},
      bounds: { height: 40, width: 80, x: 20, y: 30 },
      classes: [],
      role: 'button',
      selector: `[data-patient-control="${String(sequence)}"]`,
      tag: 'button',
      text: ''
    },
    id,
    page,
    session: {
      captureSessionId: 'capture-session-1',
      captureStartedAt: '2026-08-22T12:00:00.000Z',
      frameId: 0,
      sequence,
      tabId: 12
    },
    snapshot: { dataUrl: 'data:image/png;base64,YQ==', height: 360, width: 640 }
  }
}

beforeEach(() => {
  browserInspectorState.activeSessionId = null
  browserInspectorState.annotationRequest = null
  browserInspectorState.error = null
  browserInspectorState.expandedSessionId = null
  browserInspectorState.pickerStatus = 'idle'
  browserInspectorState.sessions.splice(0)
})

describe('Chrome capture sessions', () => {
  test('groups multiple element captures under one expandable session', () => {
    startBrowserCaptureSession({
      captureSessionId: 'capture-session-1',
      page,
      startedAt: '2026-08-22T12:00:00.000Z'
    })
    acceptBrowserElementSelection(selection('selection-1', 1))
    acceptBrowserElementSelection(selection('selection-2', 2))

    expect(browserInspectorState.sessions).toHaveLength(1)
    expect(browserInspectorState.sessions[0]?.selections.map((item) => item.id)).toEqual([
      'selection-1',
      'selection-2'
    ])
    expect(browserInspectorState.expandedSessionId).toBeNull()
    selectBrowserCaptureSession('capture-session-1')
    expect(browserInspectorState.expandedSessionId).toBe('capture-session-1')
    selectBrowserCaptureSession('capture-session-1')
    expect(browserInspectorState.expandedSessionId).toBeNull()
  })

  test('keeps optional annotations on a selection and removes only sidebar state', () => {
    acceptBrowserElementSelection(selection('selection-1', 1))
    updateBrowserElementAnnotations('capture-session-1', 'selection-1', [
      { comment: 'Keep this filter visible', id: 'annotation-1', x: 0.75, y: 0.25 }
    ])
    expect(browserInspectorState.sessions[0]?.selections[0]?.annotations).toEqual([
      { comment: 'Keep this filter visible', id: 'annotation-1', x: 0.75, y: 0.25 }
    ])

    removeBrowserCaptureSession('capture-session-1')
    expect(browserInspectorState.sessions).toHaveLength(0)
  })

  test('keeps one capture session while selections cross Chrome tabs', () => {
    const secondPage = {
      origin: 'https://second.example',
      title: 'Appointments',
      url: 'https://second.example/appointments'
    }
    acceptBrowserElementSelection(selection('selection-1', 1))
    acceptBrowserElementSelection({
      ...selection('selection-2', 2),
      page: secondPage,
      session: { ...selection('selection-2', 2).session, tabId: 27 }
    })

    const [session] = browserInspectorState.sessions
    expect(browserInspectorState.sessions).toHaveLength(1)
    expect(session?.pages?.map((candidate) => candidate.url)).toEqual([page.url, secondPage.url])
    expect(session?.title).toContain('2 tabs')
    expect(session?.selections.map((candidate) => candidate.session.tabId)).toEqual([12, 27])
  })

  test('keeps new capture sessions collapsed until the parent is opened', () => {
    startBrowserCaptureSession({
      captureSessionId: 'capture-session-collapsed',
      page,
      startedAt: '2026-08-22T12:00:00.000Z'
    })

    expect(browserInspectorState.expandedSessionId).toBeNull()

    setBrowserCaptureSessionExpanded('capture-session-collapsed')
    expect(browserInspectorState.expandedSessionId).toBe('capture-session-collapsed')

    setBrowserCaptureSessionExpanded(null)
    expect(browserInspectorState.expandedSessionId).toBeNull()
  })
})
