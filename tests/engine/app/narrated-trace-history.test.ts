import { describe, expect, test } from 'bun:test'

import {
  sortNarratedTraceRecords,
  summarizeNarratedTraceSession,
  upsertNarratedTraceRecordSummary
} from '@/app/narrated-trace/history'
import type { NarratedTraceRecordSummary } from '@/app/narrated-trace/history'
import type { NarratedTraceSession } from '@/app/narrated-trace/types'

function session(overrides: Partial<NarratedTraceSession> = {}): NarratedTraceSession {
  return {
    contextDraft: [],
    durationMs: 42_000,
    events: [
      {
        atMs: 1000,
        id: 'transcript',
        kind: 'transcript',
        label: 'Make the patient header easier to scan',
        text: 'Make the patient header easier to scan'
      },
      {
        atMs: 5000,
        evidence: {
          annotation: {
            bounds: { height: 30, width: 40, x: 20, y: 20 },
            color: '#8b5cf6',
            kind: 'focus',
            points: [
              { x: 20, y: 20 },
              { x: 60, y: 50 }
            ],
            strokeWidth: 20
          },
          cacheKey: 'narrated-trace/evidence/trace-one/focus-one',
          capturedAtMs: 5000,
          cropBounds: { height: 80, width: 100, x: 0, y: 0 },
          evidenceId: 'focus-one',
          height: 80,
          mimeType: 'image/png',
          omissions: [],
          source: 'canvas',
          width: 100
        },
        id: 'focus',
        kind: 'screenshot',
        label: 'Focused patient header'
      }
    ],
    id: 'trace-one',
    startedAt: '2026-07-12T18:00:00.000Z',
    ...overrides
  }
}

describe('Narrated Trace history', () => {
  test('summarizes a completed session without embedding evidence data', () => {
    const summary = summarizeNarratedTraceSession(session(), undefined, '2026-07-12T19:00:00.000Z')

    expect(summary).toEqual({
      durationMs: 42_000,
      eventCount: 2,
      evidenceCount: 1,
      id: 'trace-one',
      startedAt: '2026-07-12T18:00:00.000Z',
      title: 'Make the patient header easier to scan',
      updatedAt: '2026-07-12T19:00:00.000Z'
    })
    expect(JSON.stringify(summary)).not.toContain('cacheKey')
    expect(JSON.stringify(summary)).not.toContain('data:image')
  })

  test('preserves a custom title when a record is saved again', () => {
    const summary = summarizeNarratedTraceSession(
      session(),
      'Header cleanup review',
      '2026-07-12T19:00:00.000Z'
    )

    expect(summary.title).toBe('Header cleanup review')
  })

  test('upserts one record and keeps newest sessions first', () => {
    const older: NarratedTraceRecordSummary = {
      durationMs: 10_000,
      eventCount: 1,
      evidenceCount: 0,
      id: 'older',
      startedAt: '2026-07-11T18:00:00.000Z',
      title: 'Older session',
      updatedAt: '2026-07-11T18:10:00.000Z'
    }
    const current = summarizeNarratedTraceSession(
      session(),
      undefined,
      '2026-07-12T19:00:00.000Z'
    )
    const updated = { ...current, durationMs: 60_000 }

    const records = upsertNarratedTraceRecordSummary([older, current], updated)

    expect(records.map((record) => record.id)).toEqual(['trace-one', 'older'])
    expect(records.filter((record) => record.id === 'trace-one')).toHaveLength(1)
    expect(records[0]?.durationMs).toBe(60_000)
  })

  test('sorts independently of index write order', () => {
    const records = sortNarratedTraceRecords([
      {
        durationMs: 0,
        eventCount: 0,
        evidenceCount: 0,
        id: 'first',
        startedAt: '2026-07-10T10:00:00.000Z',
        title: 'First',
        updatedAt: '2026-07-10T10:00:00.000Z'
      },
      {
        durationMs: 0,
        eventCount: 0,
        evidenceCount: 0,
        id: 'second',
        startedAt: '2026-07-12T10:00:00.000Z',
        title: 'Second',
        updatedAt: '2026-07-12T10:00:00.000Z'
      }
    ])

    expect(records.map((record) => record.id)).toEqual(['second', 'first'])
  })
})
