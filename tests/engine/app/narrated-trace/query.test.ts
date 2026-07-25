import { describe, expect, test } from 'bun:test'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  queryNarratedTraceRecords,
  summarizeNarratedTraceSession,
  type NarratedTraceQueryInput,
  type NarratedTraceRecordSummary,
  type NarratedTraceScope,
  type NarratedTraceSession,
  type NarratedTraceSpatialAnchor
} from '@/app/narrated-trace'

const PRIMARY_SCOPE: NarratedTraceScope = {
  documentId: 'document-a',
  pageId: 'page-a',
  workspaceId: 'workspace-a'
}

function traceSession(input: {
  anchor?: NarratedTraceSpatialAnchor
  bounds?: Rect
  id: string
  scope?: NarratedTraceScope
  startedAt?: string
  targetId?: string
  text: string
}): NarratedTraceSession {
  return {
    contextDraft: [{ included: true, removed: false, sourceEventId: `${input.id}-event` }],
    durationMs: 30_000,
    events: [
      {
        anchor: input.anchor,
        atMs: 12_000,
        id: `${input.id}-event`,
        kind: 'edit',
        label: input.text,
        target: {
          bounds: input.bounds,
          name: input.text,
          path: ['Document', 'Page', input.text],
          stableId: input.targetId ?? `${input.id}-target`
        }
      }
    ],
    id: input.id,
    scope: input.scope,
    startedAt: input.startedAt ?? '2026-07-20T12:00:00.000Z',
    title: input.text
  }
}

function queryFixture(sessions: NarratedTraceSession[]) {
  const records = sessions.map((session) =>
    summarizeNarratedTraceSession(session, undefined, session.startedAt)
  )
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const reads: string[] = []
  return {
    dependencies: {
      readSession: async (sessionId: string) => {
        reads.push(sessionId)
        return byId.get(sessionId) ?? null
      },
      records
    },
    reads
  }
}

function queryInput(overrides: Partial<NarratedTraceQueryInput> = {}): NarratedTraceQueryInput {
  return {
    query: 'patient header',
    scope: PRIMARY_SCOPE,
    ...overrides
  }
}

describe('Narrated Trace assistant query', () => {
  test('requires exact document and page scope plus the requested time window', async () => {
    const exact = traceSession({
      id: 'exact',
      scope: PRIMARY_SCOPE,
      startedAt: '2026-07-20T12:00:00.000Z',
      text: 'Patient header spacing'
    })
    const otherPage = traceSession({
      id: 'other-page',
      scope: { ...PRIMARY_SCOPE, pageId: 'page-b' },
      text: 'Patient header spacing'
    })
    const otherDocument = traceSession({
      id: 'other-document',
      scope: { ...PRIMARY_SCOPE, documentId: 'document-b' },
      text: 'Patient header spacing'
    })
    const outOfWindow = traceSession({
      id: 'out-of-window',
      scope: PRIMARY_SCOPE,
      startedAt: '2026-07-01T12:00:00.000Z',
      text: 'Patient header spacing'
    })
    const fixture = queryFixture([exact, otherPage, otherDocument, outOfWindow])

    const result = await queryNarratedTraceRecords(
      queryInput({
        since: '2026-07-20T00:00:00.000Z',
        until: '2026-07-21T00:00:00.000Z'
      }),
      fixture.dependencies
    )

    expect(result.status).toBe('matched')
    expect(result.matches.map((match) => match.sessionId)).toEqual(['exact'])
    expect(fixture.reads).toEqual(['exact'])
  })

  test('ranks selection and traced-region matches while bounding reads and results', async () => {
    const selected = traceSession({
      bounds: { height: 100, width: 160, x: 100, y: 100 },
      id: 'selected',
      scope: PRIMARY_SCOPE,
      targetId: 'patient-header',
      text: 'Patient header alignment'
    })
    const sessions = [
      selected,
      ...Array.from({ length: 30 }, (_, index) =>
        traceSession({
          bounds: { height: 50, width: 50, x: 1000 + index * 100, y: 1000 },
          id: `candidate-${index}`,
          scope: PRIMARY_SCOPE,
          startedAt: new Date(Date.parse('2026-07-20T10:00:00.000Z') + index * 1000).toISOString(),
          text: 'Patient header review'
        })
      )
    ]
    const fixture = queryFixture(sessions)

    const result = await queryNarratedTraceRecords(
      queryInput({
        limit: 3,
        selectionIds: ['patient-header'],
        tracedRegion: { height: 140, width: 200, x: 80, y: 80 }
      }),
      fixture.dependencies
    )

    expect(result.status).toBe('matched')
    expect(result.matches).toHaveLength(3)
    expect(result.matches[0]?.sessionId).toBe('selected')
    expect(result.matches[0]?.matchedBy).toContain('selection')
    expect(result.matches[0]?.matchedBy).toContain('traced-region')
    expect(result.scanned.sessions).toBeLessThanOrEqual(12)
    expect(fixture.reads).toHaveLength(result.scanned.sessions)
  })

  test('uses an opaque task cursor to keep follow-ups on the resolved trace', async () => {
    const fixture = queryFixture([
      traceSession({
        id: 'resolved',
        scope: PRIMARY_SCOPE,
        targetId: 'patient-header',
        text: 'Patient header spacing'
      })
    ])
    const initial = await queryNarratedTraceRecords(queryInput(), fixture.dependencies)

    expect(initial.status).toBe('matched')
    expect(initial.taskCursor).toStartWith('trace-task-v1.')

    const followup = await queryNarratedTraceRecords(
      queryInput({
        cursor: initial.taskCursor,
        query: 'make it wider'
      }),
      fixture.dependencies
    )

    expect(followup.status).toBe('matched')
    expect(followup.matches[0]?.sessionId).toBe('resolved')
    expect(followup.matches[0]?.matchedBy).toContain('cursor')

    const wrongPage = await queryNarratedTraceRecords(
      queryInput({
        cursor: initial.taskCursor,
        scope: { ...PRIMARY_SCOPE, pageId: 'page-b' }
      }),
      fixture.dependencies
    )
    expect(wrongPage).toMatchObject({
      matches: [],
      reason: 'cursor_scope_mismatch',
      status: 'empty'
    })

    const wrongWorkspace = await queryNarratedTraceRecords(
      queryInput({
        cursor: initial.taskCursor,
        scope: { ...PRIMARY_SCOPE, workspaceId: 'workspace-b' }
      }),
      fixture.dependencies
    )
    expect(wrongWorkspace).toMatchObject({
      matches: [],
      reason: 'cursor_scope_mismatch',
      status: 'empty'
    })
  })

  test('returns durable page anchors and uses them for region ranking and cursor follow-ups', async () => {
    const anchor: NarratedTraceSpatialAnchor = {
      pagePoint: { x: 150, y: 180 },
      pageRegion: { height: 80, width: 100, x: 100, y: 140 },
      targetRelativePoint: { x: 0.5, y: 0.4 },
      viewport: { panX: 24, panY: -12, zoom: 1.5 }
    }
    const fixture = queryFixture([
      traceSession({
        anchor,
        bounds: { height: 40, width: 40, x: 1200, y: 1200 },
        id: 'anchored',
        scope: PRIMARY_SCOPE,
        text: 'Focused placement area'
      }),
      traceSession({
        bounds: { height: 40, width: 40, x: 1000, y: 1000 },
        id: 'legacy',
        scope: PRIMARY_SCOPE,
        text: 'Legacy placement area'
      })
    ])

    const initial = await queryNarratedTraceRecords(
      queryInput({
        query: undefined,
        tracedRegion: { height: 20, width: 20, x: 140, y: 170 }
      }),
      fixture.dependencies
    )

    expect(initial.status).toBe('matched')
    expect(initial.matches[0]?.matchedBy).toContain('traced-region')
    expect(initial.matches[0]?.events[0]?.anchor).toEqual(anchor)

    const followup = await queryNarratedTraceRecords(
      queryInput({
        cursor: initial.taskCursor,
        query: 'place it here'
      }),
      fixture.dependencies
    )
    expect(followup.status).toBe('matched')
    expect(followup.matches[0]?.events[0]?.anchor).toEqual(anchor)
  })

  test('keeps legacy events queryable without inventing coordinates', async () => {
    const fixture = queryFixture([
      traceSession({
        id: 'legacy-coordinate-free',
        scope: PRIMARY_SCOPE,
        text: 'Patient header spacing'
      })
    ])

    const result = await queryNarratedTraceRecords(queryInput(), fixture.dependencies)

    expect(result.status).toBe('matched')
    expect(result.matches[0]?.events[0]?.anchor).toBeUndefined()
  })

  test('reports unscoped, empty, and ambiguous history without inventing a match', async () => {
    const unscopedFixture = queryFixture([
      traceSession({ id: 'legacy', text: 'Patient header spacing' })
    ])
    const unscoped = await queryNarratedTraceRecords(queryInput(), unscopedFixture.dependencies)
    expect(unscoped).toMatchObject({
      matches: [],
      reason: 'unscoped_history',
      status: 'empty'
    })

    const noMatchFixture = queryFixture([
      traceSession({ id: 'footer', scope: PRIMARY_SCOPE, text: 'Footer color review' })
    ])
    const noMatch = await queryNarratedTraceRecords(queryInput(), noMatchFixture.dependencies)
    expect(noMatch).toMatchObject({
      matches: [],
      reason: 'no_relevant_trace',
      status: 'empty'
    })

    const ambiguousSessions = [
      traceSession({ id: 'first', scope: PRIMARY_SCOPE, text: 'Patient header review' }),
      traceSession({ id: 'second', scope: PRIMARY_SCOPE, text: 'Patient header review' })
    ]
    const ambiguousFixture = queryFixture(ambiguousSessions)
    const ambiguous = await queryNarratedTraceRecords(queryInput(), ambiguousFixture.dependencies)
    expect(ambiguous.status).toBe('ambiguous')
    expect(ambiguous.reason).toBe('ambiguous_matches')
    expect(ambiguous.matches).toHaveLength(2)
    expect(ambiguous.taskCursor).toBeUndefined()
  })

  test('accepts precomputed summaries without reading more than the bounded shortlist', async () => {
    const records: NarratedTraceRecordSummary[] = Array.from({ length: 2000 }, (_, index) => ({
      durationMs: 1000,
      eventCount: 1,
      evidenceCount: 0,
      id: `unrelated-${index}`,
      scope: { documentId: 'another-document', pageId: 'another-page' },
      searchTerms: ['patient', 'header'],
      startedAt: '2026-07-20T12:00:00.000Z',
      title: 'Patient header',
      updatedAt: '2026-07-20T12:00:00.000Z'
    }))
    const result = await queryNarratedTraceRecords(queryInput(), {
      readSession: async () => {
        throw new Error('Out-of-scope sessions must not be read')
      },
      records
    })

    expect(result.status).toBe('empty')
    expect(result.scanned).toEqual({ indexCandidates: 0, sessions: 0 })
  })
})
