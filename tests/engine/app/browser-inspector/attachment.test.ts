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
    const annotatedSession = {
      ...session,
      selections: [
        {
          ...selection,
          annotations: [
            { comment: 'Keep this action visible', id: 'annotation-1', x: 0.75, y: 0.25 }
          ]
        }
      ]
    }
    const attachment = createBrowserCaptureAttachment(annotatedSession)
    expect(attachment).not.toBeNull()
    if (!attachment) return

    expect(browserCaptureAttachmentSummary(attachment)).toEqual({
      annotationCount: 1,
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
    expect(resolved.contextPrompt).toContain('Stable references: Annotation #1')
    expect(resolved.contextPrompt).toContain('Reference: Annotation #1')
    expect(resolved.contextPrompt).toContain('[aria-label="Save patient"]')
    expect(resolved.contextPrompt).toContain('Comment 1 at 75%,25%: Keep this action visible')
    expect(resolved.attachments).toHaveLength(1)
    expect(resolved.attachments[0]?.type).toBe('image/png')
  })

  test('uses the available file budget and keeps annotated captures in evidence', async () => {
    const selections = Array.from({ length: 4 }, (_, index) => ({
      ...selection,
      ...(index === 3
        ? {
            annotations: [
              {
                comment: 'This later capture must stay visible',
                id: 'annotation-later',
                x: 0.4,
                y: 0.6
              }
            ]
          }
        : {}),
      id: `selection-${String(index + 1)}`,
      session: { ...selection.session, sequence: index + 1 }
    }))
    const attachment = createBrowserCaptureAttachment({ ...session, selections })
    expect(attachment).not.toBeNull()
    if (!attachment) return

    const resolved = await resolveBrowserCaptureAttachments([attachment])
    expect(resolved.attachments).toHaveLength(4)
    expect(resolved.attachments.map((file) => file.name)).toContain(
      'chrome-selection-selection-4.png'
    )
    expect(resolved.contextPrompt).toContain('This later capture must stay visible')

    const limited = await resolveBrowserCaptureAttachments([attachment], 3)
    expect(limited.attachments).toHaveLength(3)
    expect(limited.attachments.map((file) => file.name)).toContain(
      'chrome-selection-selection-4.png'
    )
  })

  test('a child drag limits context to that capture', () => {
    const seventhSelection = {
      ...selection,
      session: { ...selection.session, sequence: 7 }
    }
    const attachment = createBrowserCaptureAttachment(
      { ...session, selections: [seventhSelection] },
      selection.id
    )
    expect(attachment).not.toBeNull()
    if (!attachment) return
    expect(browserCaptureAttachmentSummary(attachment)?.captureCount).toBe(1)
    const context = browserCaptureAttachmentAgentContext(attachment)
    expect(context).toContain('Captured selections: 1')
    expect(context).toContain('Stable references: Annotation #7')
    expect(context).toContain('Reference: Annotation #7')
    expect(context).not.toContain('Selection 1 of 1')
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
