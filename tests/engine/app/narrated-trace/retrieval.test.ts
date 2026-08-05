import { describe, expect, test } from 'bun:test'

import type { NarratedTraceQueryResult } from '@/app/narrated-trace/query'
import {
  publishNarratedTraceQueryReceipt,
  narratedTraceLastQuery,
  scrubNarratedTraceQueryReceiptForMicTurns,
  summarizeNarratedTraceRetrieval
} from '@/app/narrated-trace/retrieval'
import type { NarratedTraceScope } from '@/app/narrated-trace/types'

const SCOPE: NarratedTraceScope = {
  documentId: 'document-a',
  documentName: 'Dental Chart',
  pageId: 'page-a',
  pageName: 'Dental Board',
  workspaceId: 'workspace-a'
}

function result(
  status: NarratedTraceQueryResult['status'],
  reason?: NarratedTraceQueryResult['reason']
): NarratedTraceQueryResult {
  return {
    matches:
      status === 'matched'
        ? [
            {
              endedAt: '2026-07-27T12:00:01.000Z',
              events: [
                {
                  anchor: {
                    pageRegion: { height: 20, width: 20, x: 110.5, y: 230.25 }
                  },
                  atMs: 500,
                  id: 'event-a',
                  kind: 'selection',
                  label: 'Selected Rectangle'
                }
              ],
              matchedBy: ['selection'],
              score: 24,
              scope: SCOPE,
              sessionId: 'session-a',
              startedAt: '2026-07-27T12:00:00.000Z',
              title: 'Selected Rectangle'
            }
          ]
        : [],
    ...(reason ? { reason } : {}),
    scanned: { indexCandidates: 1, sessions: 1 },
    status
  }
}

describe('Narrated Trace retrieval readback', () => {
  test('publishes one volatile exact-scope matched receipt with its anchor', () => {
    publishNarratedTraceQueryReceipt(
      { query: 'rectangle', scope: SCOPE },
      result('matched'),
      '2026-07-27T12:00:02.000Z'
    )

    const receipt = narratedTraceLastQuery.value
    expect(receipt).not.toBeNull()
    if (!receipt) return
    expect(receipt.scope).toEqual(SCOPE)
    expect(summarizeNarratedTraceRetrieval(receipt)).toEqual({
      anchor: { x: 120.5, y: 240.25 },
      candidateCount: 1,
      detail: 'Bounded Trace evidence was found in this exact Board.',
      eventCount: 1,
      eventCountLabel: '1 event',
      eventSummaries: [
        {
          anchor: { x: 120.5, y: 240.25 },
          id: 'event-a',
          kind: 'selection',
          label: 'Selected Rectangle'
        }
      ],
      matchCount: 1,
      matchedBy: ['selection'],
      matchedTitle: 'Selected Rectangle',
      scopeLabel:
        'Workspace workspace-a · Document Dental Chart (document-a) · Board Dental Board (page-a)',
      status: 'matched',
      title: 'Trace matched',
      window: {
        endedAt: '2026-07-27T12:00:01.000Z',
        startedAt: '2026-07-27T12:00:00.000Z'
      }
    })
  })

  test('summarizes one spoken source and at most five inspectable event targets', () => {
    const spokenResult = result('matched')
    const match = spokenResult.matches[0]
    if (!match) throw new Error('Expected matched Trace fixture')
    match.events = Array.from({ length: 7 }, (_, index) => ({
      anchor: {
        pageRegion: { height: 20, width: 20, x: 90 + index, y: 190 + index }
      },
      atMs: 500 + index,
      id: `event-${index}`,
      kind: 'selection' as const,
      label: `Selected target ${index}`,
      target: {
        name: `Target ${index}`,
        path: ['Dental Board', `Target ${index}`],
        stableId: `target-${index}`
      }
    }))
    spokenResult.sourceSpokenTurn = {
      endedAt: '2026-07-27T12:00:04.000Z',
      endedAtEpochMs: 4_000,
      id: 'spoken-a',
      scope: SCOPE,
      sequence: 1,
      startedAt: '2026-07-27T12:00:02.000Z',
      startedAtEpochMs: 2_000,
      text: 'Show me the patient header while I compare these controls'
    }

    publishNarratedTraceQueryReceipt({ latestSpokenTurn: true, scope: SCOPE }, spokenResult)
    const receipt = narratedTraceLastQuery.value
    if (!receipt) throw new Error('Expected published Trace receipt')
    const summary = summarizeNarratedTraceRetrieval(receipt)

    expect(summary.sourceSpokenTurn).toEqual({
      endedAt: '2026-07-27T12:00:04.000Z',
      id: 'spoken-a',
      startedAt: '2026-07-27T12:00:02.000Z',
      text: 'Show me the patient header while I compare these controls'
    })
    expect(summary.window).toEqual({
      endedAt: '2026-07-27T12:00:04.000Z',
      startedAt: '2026-07-27T12:00:02.000Z'
    })
    expect(summary.eventCount).toBe(7)
    expect(summary.eventSummaries).toHaveLength(5)
    expect(summary.eventSummaries[0]).toEqual({
      anchor: { x: 100, y: 200 },
      id: 'event-0',
      kind: 'selection',
      label: 'Selected target 0',
      target: { name: 'Target 0', stableId: 'target-0' }
    })
  })

  test('keeps ambiguous, empty, and error outcomes explicit', () => {
    const cases = [
      {
        expected: 'Trace needs clarification',
        reason: 'ambiguous_matches' as const,
        status: 'ambiguous' as const
      },
      {
        expected: 'No matching Trace',
        reason: 'no_relevant_trace' as const,
        status: 'empty' as const
      },
      {
        expected: 'Trace unavailable',
        reason: 'trace_read_failed' as const,
        status: 'error' as const
      }
    ]

    for (const item of cases) {
      publishNarratedTraceQueryReceipt(
        { query: 'rectangle', scope: SCOPE },
        result(item.status, item.reason)
      )
      const receipt = narratedTraceLastQuery.value
      expect(receipt).not.toBeNull()
      if (!receipt) continue
      const summary = summarizeNarratedTraceRetrieval(receipt)
      expect(summary.status).toBe(item.status)
      expect(summary.title).toBe(item.expected)
      expect(summary.detail).toContain(item.reason)
      expect(summary.eventCount).toBe(0)
      expect(summary.eventCountLabel).toBe('0 events')
      expect(summary.eventSummaries).toEqual([])
    }
  })

  test('scrubs ambiguous spoken-turn candidates and every copied transcript phrase', () => {
    publishNarratedTraceQueryReceipt(
      { spokenText: 'patient header', scope: SCOPE },
      {
        matches: [],
        reason: 'ambiguous_spoken_turn',
        scanned: { indexCandidates: 0, sessions: 0 },
        spokenTurnCandidates: [
          {
            endedAt: '2026-07-27T12:00:01.000Z',
            endedAtEpochMs: 1_000,
            id: 'spoken-a',
            scope: { ...SCOPE, workspaceId: 'workspace-a' },
            sequence: 1,
            startedAt: '2026-07-27T12:00:00.000Z',
            startedAtEpochMs: 0,
            text: 'The patient header feels crowded'
          }
        ],
        status: 'ambiguous'
      }
    )
    expect(JSON.stringify(narratedTraceLastQuery.value)).toContain(
      'The patient header feels crowded'
    )

    expect(scrubNarratedTraceQueryReceiptForMicTurns(['spoken-a'])).toBe(true)
    expect(JSON.stringify(narratedTraceLastQuery.value)).not.toContain(
      'The patient header feels crowded'
    )
  })
})
