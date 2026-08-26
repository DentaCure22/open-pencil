import { describe, expect, test } from 'bun:test'

import {
  browserCaptureSessionAgentContext,
  browserElementAgentContext,
  browserElementTraceTarget,
  compactBrowserElementTitle
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
  test('uses a deterministic compact display title without changing short labels', () => {
    expect(compactBrowserElementTitle('Patient search')).toBe('Patient search')
    expect(
      compactBrowserElementTitle(
        '  Home   Explore 1 Notifications Chat Grok History Creator Studio Premium Profile More Post  '
      )
    ).toBe('Home Explore 1 Notifications…')
  })

  test('stays selection context for Trace and the agent', () => {
    const elementContext = browserElementAgentContext(selection)
    expect(elementContext).toContain('Reference: Annotation #1')
    expect(elementContext).toContain('Chrome DOM selection:')
    expect(elementContext).toContain('[aria-label="Save patient"]')
    expect(browserElementTraceTarget(selection)).toEqual({
      elementKind: 'control',
      name: 'Save patient',
      path: ['Patient editor', '[aria-label="Save patient"]'],
      route: 'https://example.com/patients/1',
      stableId: 'browser:chrome-session-1:capture-context'
    })
    const sessionContext = browserCaptureSessionAgentContext({
      id: 'chrome-session-1',
      page: selection.page,
      recordings: [],
      selections: [{ ...selection, session: { ...selection.session, sequence: 7 } }],
      startedAt: '2026-08-22T11:59:00.000Z',
      title: 'Patient editor · 6:59 AM',
      traceSessionId: 'trace-1'
    })
    expect(sessionContext).toContain('Trace session: trace-1')
    expect(sessionContext).toContain('Stable references: Annotation #7')
    expect(sessionContext).toContain('Reference: Annotation #7')
    expect(sessionContext).not.toContain('Selection 1 of 1')
  })

  test('keeps session references in stable numeric order', () => {
    const first = { ...selection, id: 'capture-first' }
    const second = {
      ...selection,
      id: 'capture-second',
      session: { ...selection.session, sequence: 2 }
    }
    const context = browserCaptureSessionAgentContext({
      id: 'chrome-session-1',
      page: selection.page,
      recordings: [],
      selections: [second, first],
      startedAt: '2026-08-22T11:59:00.000Z',
      title: 'Patient editor · 6:59 AM'
    })

    expect(context).toContain('Stable references: Annotation #1, Annotation #2')
    expect(context.indexOf('Reference: Annotation #1')).toBeLessThan(
      context.indexOf('Reference: Annotation #2')
    )
    expect(context).toContain(
      'a bare number, “#N”, or “annotation N” means the matching Annotation #N'
    )
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
        selection: {
          ...selection,
          page: { ...selection.page, url: 'file:///private/data' }
        }
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
        annotations: [
          {
            comment: 'Keep this visible',
            id: 'annotation-1',
            x: 0.25,
            y: 0.75
          }
        ],
        captureSessionId: 'chrome-session-1',
        contract: 'openpencil-browser-element/v1',
        kind: 'annotations-updated',
        selectionId: 'capture-context'
      })
    ).toEqual({
      annotations: [{ comment: 'Keep this visible', id: 'annotation-1', x: 0.25, y: 0.75 }],
      captureSessionId: 'chrome-session-1',
      contract: 'openpencil-browser-element/v1',
      kind: 'annotations-updated',
      selectionId: 'capture-context'
    })
    expect(
      parseBrowserElementEvent({
        annotations: [
          {
            comment: 'Outside the capture',
            id: 'annotation-1',
            x: 1.2,
            y: 0.75
          }
        ],
        captureSessionId: 'chrome-session-1',
        contract: 'openpencil-browser-element/v1',
        kind: 'annotations-updated',
        selectionId: 'capture-context'
      })
    ).toBeNull()
    expect(
      parseBrowserElementEvent({
        captureSessionId: 'chrome-session-1',
        contract: 'openpencil-browser-element/v1',
        kind: 'selection-removed',
        selectionId: 'capture-context'
      })
    ).toEqual({
      captureSessionId: 'chrome-session-1',
      contract: 'openpencil-browser-element/v1',
      kind: 'selection-removed',
      selectionId: 'capture-context'
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
