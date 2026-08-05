import { describe, expect, test } from 'bun:test'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  queryNarratedTraceRecords,
  summarizeNarratedTraceSession,
  type NarratedTraceQueryInput,
  type NarratedTraceRecordSummary,
  type NarratedTraceMicTurn,
  type NarratedTraceScope,
  type NarratedTraceSession,
  type NarratedTraceSpatialAnchor
} from '@/app/narrated-trace'

const PRIMARY_SCOPE: NarratedTraceScope = {
  documentId: 'document-a',
  pageId: 'page-a',
  workspaceId: 'workspace-a'
}
const RUNTIME_TAB_BINDING_ID = 'trace-runtime-tab:test'

function traceSession(input: {
  anchor?: NarratedTraceSpatialAnchor
  bounds?: Rect
  id: string
  scope?: NarratedTraceScope
  startedAt?: string
  targetId?: string
  targetPath?: string[]
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
          path: input.targetPath ?? ['Document', 'Page', input.text],
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
    runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
    scope: PRIMARY_SCOPE,
    ...overrides
  }
}

function spokenTurn(
  overrides: Partial<NarratedTraceMicTurn> = {},
  sequence = 1
): NarratedTraceMicTurn {
  const sessionStart = Date.parse('2026-07-20T12:00:00.000Z')
  return {
    endedAt: new Date(sessionStart + 12_500).toISOString(),
    endedAtEpochMs: sessionStart + 12_500,
    endedAtMonotonicMs: 12_500,
    expiresAtEpochMs: Date.now() + 60_000,
    id: `spoken-${sequence}`,
    runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
    scope: PRIMARY_SCOPE as NarratedTraceMicTurn['scope'],
    sequence,
    startedAt: new Date(sessionStart + 11_500).toISOString(),
    startedAtEpochMs: sessionStart + 11_500,
    startedAtMonotonicMs: 11_500,
    text: 'The patient header feels crowded',
    timeOriginEpochMs: sessionStart,
    ...overrides
  }
}

describe('Narrated Trace assistant query', () => {
  test('reads only the exact Trace window linked to the latest scoped spoken turn', async () => {
    const exact = traceSession({
      id: 'exact-spoken-window',
      scope: PRIMARY_SCOPE,
      text: 'Selected patient header'
    })
    exact.events.unshift({
      atMs: 2_000,
      id: 'outside-window',
      kind: 'tool',
      label: 'Activated RECTANGLE'
    })
    exact.contextDraft.unshift({
      included: true,
      removed: false,
      sourceEventId: 'outside-window'
    })
    const otherWorkspace = traceSession({
      id: 'other-workspace',
      scope: { ...PRIMARY_SCOPE, workspaceId: 'workspace-b' },
      text: 'Selected patient header'
    })
    const fixture = queryFixture([exact, otherWorkspace])

    const result = await queryNarratedTraceRecords(
      queryInput({ latestSpokenTurn: true, query: undefined }),
      {
        ...fixture.dependencies,
        spokenTurns: [spokenTurn()]
      }
    )

    expect(result.status).toBe('matched')
    expect(result.sourceSpokenTurn).toMatchObject({
      id: 'spoken-1',
      text: 'The patient header feels crowded'
    })
    expect(result.matches.map((match) => match.sessionId)).toEqual(['exact-spoken-window'])
    expect(result.matches[0]?.matchedBy).toEqual(['spoken-turn-window'])
    expect(result.matches[0]?.events.map((event) => event.id)).toEqual([
      'exact-spoken-window-event'
    ])
    expect(result.taskCursor).toBeUndefined()
  })

  test('reports ambiguous and missing spoken turns without falling back to ranked history', async () => {
    const session = traceSession({
      id: 'spoken-lookup',
      scope: PRIMARY_SCOPE,
      text: 'Patient header'
    })
    const fixture = queryFixture([session])
    const turns = [spokenTurn({ id: 'spoken-first' }, 1), spokenTurn({ id: 'spoken-second' }, 2)]

    const ambiguous = await queryNarratedTraceRecords(
      queryInput({ query: undefined, spokenText: 'patient header' }),
      { ...fixture.dependencies, spokenTurns: turns }
    )
    expect(ambiguous).toMatchObject({
      matches: [],
      reason: 'ambiguous_spoken_turn',
      status: 'ambiguous'
    })
    expect(ambiguous.spokenTurnCandidates?.map((turn) => turn.id)).toEqual([
      'spoken-first',
      'spoken-second'
    ])

    const missing = await queryNarratedTraceRecords(
      queryInput({ query: undefined, spokenTurnId: 'missing' }),
      { ...fixture.dependencies, spokenTurns: turns }
    )
    expect(missing).toMatchObject({
      matches: [],
      reason: 'spoken_turn_not_found',
      status: 'empty'
    })
  })

  test('marks an overlapping current Trace session as unsettled', async () => {
    const current = traceSession({
      id: 'current-spoken-window',
      scope: PRIMARY_SCOPE,
      text: 'Selected patient header'
    })
    const result = await queryNarratedTraceRecords(
      queryInput({ latestSpokenTurn: true, query: undefined }),
      {
        currentSession: current,
        currentSessionSettled: false,
        readSession: async () => null,
        records: [],
        spokenTurns: [spokenTurn()]
      }
    )

    expect(result).toMatchObject({
      reason: 'trace_window_unsettled',
      status: 'ambiguous'
    })
    expect(result.matches[0]?.events[0]?.id).toBe('current-spoken-window-event')
  })

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

  test('queries the newest in-memory activity before its durable save completes', async () => {
    const current = traceSession({
      id: 'current-activity',
      scope: PRIMARY_SCOPE,
      text: 'Selected the fresh placement anchor'
    })
    const reads: string[] = []

    const result = await queryNarratedTraceRecords(
      queryInput({ query: 'fresh placement anchor' }),
      {
        currentSession: current,
        currentSessionSettled: false,
        readSession: async (sessionId) => {
          reads.push(sessionId)
          return null
        },
        records: []
      }
    )

    expect(result.status).toBe('matched')
    expect(result.matches[0]?.sessionId).toBe('current-activity')
    expect(result.matches[0]?.events[0]?.label).toBe('Selected the fresh placement anchor')
    expect(reads).toEqual([])
  })

  test('fails closed when legacy history lacks the requested workspace identity', async () => {
    const legacyScope = {
      documentId: PRIMARY_SCOPE.documentId,
      pageId: PRIMARY_SCOPE.pageId
    }
    const fixture = queryFixture([
      traceSession({
        id: 'legacy-workspace-free',
        scope: legacyScope,
        text: 'Patient header spacing'
      })
    ])

    const result = await queryNarratedTraceRecords(queryInput(), fixture.dependencies)

    expect(result).toMatchObject({
      matches: [],
      reason: 'unscoped_history',
      status: 'empty'
    })
    expect(fixture.reads).toEqual([])
  })

  test('admits lexical object evidence without scoring structural scope paths', async () => {
    const namedScope = {
      ...PRIMARY_SCOPE,
      documentName: 'Dental Chart',
      pageName: 'Dental Board'
    }
    const fixture = queryFixture([
      traceSession({
        id: 'current-chart',
        scope: namedScope,
        targetPath: ['Dental Chart', 'Dental Board', 'Dental Chart / Current'],
        text: 'Dental Chart / Current'
      }),
      traceSession({
        id: 'unrelated-circle',
        scope: namedScope,
        targetPath: ['Dental Chart', 'Dental Board', 'Trace Circle'],
        text: 'Trace Circle'
      })
    ])

    const scopeOnly = await queryNarratedTraceRecords(
      queryInput({
        query: 'Dental Board',
        scope: namedScope,
        viewportBounds: { height: 800, width: 1200, x: 0, y: 0 }
      }),
      fixture.dependencies
    )
    expect(scopeOnly).toMatchObject({
      matches: [],
      reason: 'no_relevant_trace',
      status: 'empty'
    })

    const objectName = await queryNarratedTraceRecords(
      queryInput({ query: 'Dental Chart', scope: namedScope }),
      fixture.dependencies
    )
    expect(objectName.status).toBe('matched')
    expect(objectName.matches.map((match) => match.sessionId)).toEqual(['current-chart'])

    const mixed = await queryNarratedTraceRecords(
      queryInput({ query: 'Dental Board Dental Chart', scope: namedScope }),
      fixture.dependencies
    )
    expect(mixed.status).toBe('matched')
    expect(mixed.matches.map((match) => match.sessionId)).toEqual(['current-chart'])
    expect(mixed.matches[0]?.events.map((event) => event.id)).toEqual(['current-chart-event'])

    const actualBoardObject = traceSession({
      id: 'actual-board-object',
      scope: namedScope,
      targetPath: ['Dental Chart', 'Dental Board', 'Dental Board'],
      text: 'Dental Board'
    })
    const actualBoardFixture = queryFixture([actualBoardObject])
    const boardObject = await queryNarratedTraceRecords(
      queryInput({ query: 'Dental Board', scope: namedScope }),
      actualBoardFixture.dependencies
    )
    expect(boardObject.status).toBe('matched')
    expect(boardObject.matches.map((match) => match.sessionId)).toEqual(['actual-board-object'])
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
    expect(initial.taskCursor).toStartWith('trace-task-v3.')

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

    const reboundRuntimeTab = await queryNarratedTraceRecords(
      queryInput({
        cursor: initial.taskCursor,
        runtimeTabBindingId: 'trace-runtime-tab:rebound'
      }),
      fixture.dependencies
    )
    expect(reboundRuntimeTab).toMatchObject({
      status: 'matched'
    })
    expect(reboundRuntimeTab.matches[0]?.sessionId).toBe('resolved')
  })

  test('searches every scoped Board and returns the recorded Board origin', async () => {
    const dentalScope: NarratedTraceScope = {
      documentId: 'dental-document',
      documentName: 'Dental workspace',
      pageId: 'dental-board',
      pageName: 'Treatment planning',
      workspaceId: 'workspace-dental'
    }
    const fixture = queryFixture([
      traceSession({ id: 'unrelated', scope: PRIMARY_SCOPE, text: 'Patient footer spacing' }),
      traceSession({
        id: 'dental-card',
        scope: dentalScope,
        text: 'Implant treatment card'
      })
    ])

    const result = await queryNarratedTraceRecords(
      { query: 'implant treatment card' },
      fixture.dependencies
    )

    expect(result.status).toBe('matched')
    expect(result.matches[0]).toMatchObject({
      scope: dentalScope,
      sessionId: 'dental-card'
    })
    expect(result.taskCursor).toStartWith('trace-task-v3.')
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
