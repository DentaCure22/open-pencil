import { describe, expect, test } from 'bun:test'

import {
  browserCaptureAttachmentAgentContext,
  browserCaptureAttachmentPreview,
  browserCaptureAttachmentSummary,
  createBrowserCaptureAttachment,
  resolveBrowserCaptureAttachments
} from '@/app/browser-inspector/attachment'
import type { BrowserElementSelection } from '@/app/browser-inspector/contracts'
import type { BrowserCaptureSession } from '@/app/browser-inspector/state'

const selection: BrowserElementSelection = {
  capturedAt: '2026-08-22T12:00:01.000Z',
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
  id: 'selection-1',
  page: {
    origin: 'https://example.com',
    title: 'Patient editor',
    url: 'https://example.com/patients/1'
  },
  session: {
    captureSessionId: 'session-1',
    captureStartedAt: '2026-08-22T12:00:00.000Z',
    frameId: 0,
    sequence: 1,
    tabId: 12
  },
  snapshot: { dataUrl: 'data:image/png;base64,aGVsbG8=', height: 180, width: 320 }
}

const session: BrowserCaptureSession = {
  id: 'session-1',
  page: selection.page,
  recordings: [],
  selections: [selection],
  startedAt: '2026-08-22T12:00:00.000Z',
  title: 'Patient editor · 12:00 PM',
  traceSessionId: 'trace-1'
}

describe('browser capture chat attachment', () => {
  test('stays one compact composer chip backed by Trace context and bounded evidence', async () => {
    const attachment = createBrowserCaptureAttachment(session)
    expect(attachment).not.toBeNull()
    if (!attachment) return

    expect(browserCaptureAttachmentSummary(attachment)).toEqual({
      captureCount: 1,
      recordingCount: 0,
      title: session.title,
      traceLinked: true
    })
    expect(browserCaptureAttachmentPreview(attachment)).toEqual({
      height: selection.snapshot.height,
      imageUrl: selection.snapshot.dataUrl,
      title: session.title,
      width: selection.snapshot.width
    })
    expect(browserCaptureAttachmentAgentContext(attachment)).toContain('Trace session: trace-1')

    const resolved = await resolveBrowserCaptureAttachments([attachment])
    expect(resolved.contextPrompt).toContain('[aria-label="Save patient"]')
    expect(resolved.attachments).toHaveLength(1)
    expect(resolved.attachments[0]?.type).toBe('image/png')
  })

  test('a child drag limits context to that capture', () => {
    const attachment = createBrowserCaptureAttachment(session, selection.id)
    expect(attachment).not.toBeNull()
    if (!attachment) return
    expect(browserCaptureAttachmentSummary(attachment)?.captureCount).toBe(1)
    expect(browserCaptureAttachmentAgentContext(attachment)).toContain('Captured selections: 1')
  })

  test('a recording child resolves to its bounded video evidence', async () => {
    const recordingSession: BrowserCaptureSession = {
      ...session,
      recordings: [
        {
          captureSessionId: session.id,
          dataUrl: 'data:video/webm;base64,aGVsbG8=',
          durationMs: 2_000,
          endedAt: '2026-08-22T12:00:04.000Z',
          id: 'recording-1',
          mimeType: 'video/webm',
          startedAt: '2026-08-22T12:00:02.000Z'
        }
      ]
    }
    const attachment = createBrowserCaptureAttachment(recordingSession, undefined, 'recording-1')
    expect(attachment).not.toBeNull()
    if (!attachment) return
    expect(browserCaptureAttachmentSummary(attachment)?.recordingCount).toBe(1)
    expect(browserCaptureAttachmentPreview(attachment)).toBeNull()
    const resolved = await resolveBrowserCaptureAttachments([attachment])
    expect(resolved.attachments).toHaveLength(1)
    expect(resolved.attachments[0]?.type).toBe('video/webm')
  })
})
