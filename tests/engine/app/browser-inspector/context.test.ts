import { describe, expect, test } from 'bun:test'

import {
  browserCaptureSessionAgentContext,
  browserElementAgentContext,
  browserElementTraceTarget
} from '@/app/browser-inspector/context'
import {
  parseBrowserElementCommandResult,
  parseBrowserElementEvent,
  type BrowserElementSelection
} from '@/app/browser-inspector/contracts'

const selection: BrowserElementSelection = {
  capturedAt: '2026-08-22T12:00:00.000Z',
  element: {
    accessibleName: 'Save patient',
    attributes: { 'aria-label': 'Save patient' },
    bounds: { height: 40, width: 80, x: 20, y: 30 },
    classes: ['primary'],
    role: 'button',
    selector: '[aria-label="Save patient"]',
    tag: 'button',
    text: 'Save'
  },
  id: 'capture-context',
  page: {
    origin: 'https://example.com',
    title: 'Patient editor',
    url: 'https://example.com/patients/1'
  },
  session: {
    captureSessionId: 'chrome-session-1',
    captureStartedAt: '2026-08-22T11:59:00.000Z',
    frameId: 0,
    sequence: 1,
    tabId: 12
  },
  snapshot: { dataUrl: 'data:image/jpeg;base64,YQ==', height: 40, width: 80 }
}

describe('Chrome element context', () => {
  test('stays selection context for Trace and the agent', () => {
    expect(browserElementAgentContext(selection)).toContain('Chrome DOM selection:')
    expect(browserElementAgentContext(selection)).toContain('[aria-label="Save patient"]')
    expect(browserElementTraceTarget(selection)).toEqual({
      elementKind: 'control',
      name: 'Save patient',
      path: ['Patient editor', '[aria-label="Save patient"]'],
      route: 'https://example.com/patients/1',
      stableId: 'browser:chrome-session-1:capture-context'
    })
    expect(
      browserCaptureSessionAgentContext({
        id: 'chrome-session-1',
        page: selection.page,
        recordings: [],
        selections: [selection],
        startedAt: '2026-08-22T11:59:00.000Z',
        title: 'Patient editor · 6:59 AM',
        traceSessionId: 'trace-1'
      })
    ).toContain('Trace session: trace-1')
  })

  test('accepts only bounded selection and correlated command events', () => {
    expect(
      parseBrowserElementEvent({
        contract: 'openpencil-browser-element/v1',
        kind: 'selection',
        selection
      })
    ).toEqual({
      contract: 'openpencil-browser-element/v1',
      kind: 'selection',
      selection
    })
    expect(
      parseBrowserElementEvent({
        contract: 'openpencil-browser-element/v1',
        kind: 'selection',
        selection: { ...selection, page: { ...selection.page, url: 'file:///private/data' } }
      })
    ).toBeNull()
    expect(
      parseBrowserElementEvent({
        captureSessionId: 'chrome-session-1',
        captureStartedAt: '2026-08-22T11:59:00.000Z',
        contract: 'openpencil-browser-element/v1',
        kind: 'picker-started',
        page: selection.page
      })
    ).toEqual({
      captureSessionId: 'chrome-session-1',
      captureStartedAt: '2026-08-22T11:59:00.000Z',
      contract: 'openpencil-browser-element/v1',
      kind: 'picker-started',
      page: selection.page
    })
    expect(
      parseBrowserElementEvent({
        captureSessionId: 'chrome-session-1',
        captureStartedAt: '2026-08-22T11:59:00.000Z',
        contract: 'openpencil-browser-element/v1',
        kind: 'annotate-requested',
        selectionId: 'capture-context',
        sequence: 1
      })
    ).toEqual({
      captureSessionId: 'chrome-session-1',
      captureStartedAt: '2026-08-22T11:59:00.000Z',
      contract: 'openpencil-browser-element/v1',
      kind: 'annotate-requested',
      selectionId: 'capture-context',
      sequence: 1
    })
    expect(
      parseBrowserElementEvent({
        captureSessionId: 'chrome-session-1',
        contract: 'openpencil-browser-element/v1',
        kind: 'recording-failed',
        reason: 'recording-unavailable'
      })
    ).toEqual({
      captureSessionId: 'chrome-session-1',
      contract: 'openpencil-browser-element/v1',
      kind: 'recording-failed',
      reason: 'recording-unavailable'
    })
    expect(
      parseBrowserElementCommandResult({
        contract: 'openpencil-browser-element-command-result/v1',
        ok: true,
        requestId: 'request-1'
      })
    ).toEqual({
      contract: 'openpencil-browser-element-command-result/v1',
      ok: true,
      requestId: 'request-1'
    })
  })
})
