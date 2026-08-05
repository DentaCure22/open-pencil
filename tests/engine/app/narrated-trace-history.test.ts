import { describe, expect, test } from 'bun:test'

import {
  buildNarratedTraceActivityFeed,
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
      gestureCount: 0,
      id: 'trace-one',
      searchTerms: ['make', 'the', 'patient', 'header', 'easier', 'to', 'scan', 'focused'],
      startedAt: '2026-07-12T18:00:00.000Z',
      title: 'Make the patient header easier to scan',
      updatedAt: '2026-07-12T19:00:00.000Z'
    })
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

  test('indexes new page-space anchors ahead of legacy target bounds', () => {
    const anchored = session({
      events: [
        {
          anchor: {
            pagePoint: { x: 150, y: 180 },
            pageRegion: { height: 80, width: 100, x: 100, y: 140 },
            viewport: { panX: 24, panY: -12, zoom: 1.5 }
          },
          atMs: 5000,
          id: 'focus',
          kind: 'screenshot',
          label: 'Focused placement area',
          target: {
            bounds: { height: 40, width: 40, x: 1200, y: 1200 },
            name: 'Card',
            path: ['Page', 'Card'],
            stableId: 'card'
          }
        }
      ]
    })

    const summary = summarizeNarratedTraceSession(anchored, undefined, '2026-07-12T19:00:00.000Z')

    expect(summary.bounds).toEqual({ height: 80, width: 100, x: 100, y: 140 })
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
    const current = summarizeNarratedTraceSession(session(), undefined, '2026-07-12T19:00:00.000Z')
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

  test('builds one bounded newest-first activity feed without duplicating sessions', () => {
    const older = session({
      id: 'older',
      startedAt: '2026-07-12T17:00:00.000Z'
    })
    const newer = session({
      id: 'newer',
      scope: {
        documentId: 'document-a',
        pageId: 'page-a',
        workspaceId: 'workspace-a'
      },
      startedAt: '2026-07-12T19:00:00.000Z'
    })

    const feed = buildNarratedTraceActivityFeed(
      [
        { session: older, title: 'Older' },
        { session: newer, title: 'Newer' }
      ],
      3
    )

    expect(feed).toHaveLength(3)
    expect(feed.map((item) => item.sessionId)).toEqual(['newer', 'newer', 'older'])
    expect(feed[0]?.scope).toEqual(newer.scope)
    expect(new Set(feed.map((item) => `${item.sessionId}:${item.event.id}`)).size).toBe(3)
  })
})
