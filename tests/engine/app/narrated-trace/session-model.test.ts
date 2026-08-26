import { describe, expect, test } from 'bun:test'

import { normalizeTraceSessionTag } from '@open-pencil/core/rpc'

import { buildNarratedContextMarkdown } from '@/app/narrated-trace/context'
import type { NarratedTraceSession } from '@/app/narrated-trace/types'

describe('Narrated Trace canonical session model', () => {
  test('normalizes a spoken session handle deterministically', () => {
    expect(normalizeTraceSessionTag('  #Patient Flow / Review  ')).toBe('patient-flow-review')
  })

  test('hands agents the tag, source episodes, and numbered Chrome annotations', () => {
    const session: NarratedTraceSession = {
      contextDraft: [{ included: true, removed: false, sourceEventId: 'event-1' }],
      durationMs: 2_000,
      episodes: [
        {
          endedAtMs: 2_000,
          id: 'chrome:capture-1',
          kind: 'chrome',
          label: 'Patient chart',
          sourceSessionId: 'capture-1',
          startedAtMs: 0
        }
      ],
      events: [
        {
          atMs: 500,
          id: 'event-1',
          kind: 'selection',
          label: 'Selected patient header from Chrome',
          origin: {
            episodeId: 'chrome:capture-1',
            kind: 'chrome',
            reference: 'Annotation #1',
            sequence: 1,
            sourceSessionId: 'capture-1'
          }
        }
      ],
      id: 'trace-1',
      startedAt: '2026-08-24T12:00:00.000Z',
      tag: 'patient-flow',
      title: 'Inspect Chrome · Patient chart'
    }

    const markdown = buildNarratedContextMarkdown(session)
    expect(markdown).toContain('Session tag: #patient-flow')
    expect(markdown).toContain('chrome — Patient chart')
    expect(markdown).toContain('Annotation #1 — Selected patient header from Chrome')
  })
})
