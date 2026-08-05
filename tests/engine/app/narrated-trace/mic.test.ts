import { afterEach, describe, expect, test } from 'bun:test'

import {
  clearNarratedTraceMicTurns,
  narratedTraceHistory,
  narratedTraceLastQuery,
  narratedTraceMicTurns,
  pruneNarratedTraceMicTurns,
  publishNarratedTraceQueryReceipt,
  queryNarratedTraceRecords,
  removeNarratedTraceMicTurn,
  resolveNarratedTraceMicTurn,
  type NarratedTraceMicScope,
  type NarratedTraceMicTurn
} from '@/app/narrated-trace'

const SCOPE: NarratedTraceMicScope = {
  documentId: 'document-a',
  pageId: 'page-a',
  workspaceId: 'workspace-a'
}
const RUNTIME_TAB_BINDING_ID = 'trace-runtime-tab:test'
const VOLATILE_CANARY = 'violet glacier semaphore seven should vanish'

const DURABLE_NON_VOICE_SUMMARY = {
  durationMs: 1_000,
  eventCount: 1,
  evidenceCount: 0,
  id: 'durable-selection-history',
  scope: SCOPE,
  searchTerms: ['dental', 'chart'],
  startedAt: '2026-07-20T11:59:00.000Z',
  title: 'Selected Dental Chart',
  updatedAt: '2026-07-20T12:00:00.000Z'
}

function turn(
  id: string,
  sequence: number,
  overrides: Partial<NarratedTraceMicTurn> = {}
): NarratedTraceMicTurn {
  return {
    endedAt: '2026-07-20T12:00:03.000Z',
    endedAtEpochMs: 3_000,
    endedAtMonotonicMs: 3_000,
    expiresAtEpochMs: 20_000,
    id,
    runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
    scope: SCOPE,
    sequence,
    startedAt: '2026-07-20T12:00:01.000Z',
    startedAtEpochMs: 1_000,
    startedAtMonotonicMs: 1_000,
    text: 'The patient header feels crowded',
    timeOriginEpochMs: 0,
    ...overrides
  }
}

function publishSpokenReceipt(source: NarratedTraceMicTurn) {
  publishNarratedTraceQueryReceipt(
    { latestSpokenTurn: true, scope: SCOPE },
    {
      matches: [],
      reason: 'no_trace_in_spoken_window',
      scanned: { indexCandidates: 1, sessions: 1 },
      sourceSpokenTurn: {
        endedAt: source.endedAt,
        endedAtEpochMs: source.endedAtEpochMs,
        id: source.id,
        scope: source.scope,
        sequence: source.sequence,
        startedAt: source.startedAt,
        startedAtEpochMs: source.startedAtEpochMs,
        text: source.text
      },
      status: 'empty'
    }
  )
}

afterEach(() => {
  narratedTraceMicTurns.value = []
  narratedTraceHistory.value = []
  narratedTraceLastQuery.value = null
})

describe('Narrated Trace volatile mic turns', () => {
  test('resolves the latest non-expired turn only inside the exact scope', () => {
    const resolution = resolveNarratedTraceMicTurn(
      {
        latest: true,
        runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
        scope: SCOPE
      },
      [
        turn('older', 1),
        turn('other-workspace', 3, {
          scope: { ...SCOPE, workspaceId: 'workspace-b' }
        }),
        turn('latest', 2)
      ],
      10_000
    )

    expect(resolution).toMatchObject({
      status: 'matched',
      turn: { id: 'latest' }
    })
  })

  test('does not resolve expired turns or wildcard workspace scope', () => {
    expect(
      resolveNarratedTraceMicTurn(
        {
          latest: true,
          runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
          scope: SCOPE
        },
        [turn('expired', 1, { expiresAtEpochMs: 9_000 })],
        10_000
      )
    ).toMatchObject({
      reason: 'spoken_turn_not_found',
      status: 'empty'
    })

    expect(
      resolveNarratedTraceMicTurn(
        {
          latest: true,
          runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
          scope: { documentId: 'document-a', pageId: 'page-a' }
        },
        [turn('latest', 1)],
        10_000
      )
    ).toMatchObject({
      reason: 'spoken_turn_scope_unavailable',
      status: 'error'
    })
  })

  test('keeps quoted-text ambiguity inspectable', () => {
    const resolution = resolveNarratedTraceMicTurn(
      {
        runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
        scope: SCOPE,
        text: 'patient header'
      },
      [turn('first', 1), turn('second', 2)],
      10_000
    )

    expect(resolution).toMatchObject({
      reason: 'ambiguous_spoken_turn',
      status: 'ambiguous'
    })
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates.map((candidate) => candidate.id)).toEqual(['first', 'second'])
    }
  })

  test('fails closed when the runtime-tab binding changes within the same stable scope', () => {
    const resolution = resolveNarratedTraceMicTurn(
      {
        latest: true,
        runtimeTabBindingId: 'trace-runtime-tab:rebound',
        scope: SCOPE
      },
      [turn('stale-runtime-turn', 1)],
      10_000
    )

    expect(resolution).toMatchObject({
      reason: 'spoken_turn_not_found',
      status: 'empty'
    })
  })

  test('Clear removes the transcript-bearing last-query receipt', () => {
    const spoken = turn('clear-me', 1)
    narratedTraceMicTurns.value = [spoken]
    publishSpokenReceipt(spoken)
    expect(JSON.stringify(narratedTraceLastQuery.value)).toContain(
      'The patient header feels crowded'
    )

    clearNarratedTraceMicTurns()

    expect(narratedTraceMicTurns.value).toEqual([])
    expect(narratedTraceLastQuery.value).toBeNull()
    expect(JSON.stringify(narratedTraceLastQuery.value)).not.toContain(
      'The patient header feels crowded'
    )
  })

  test('deletes only one volatile turn and closes its receipt and continuation lookup', async () => {
    const deleted = turn('delete-me', 1, { text: VOLATILE_CANARY })
    const retained = turn('retain-me', 2, { text: 'Keep this separate spoken turn' })
    narratedTraceHistory.value = [DURABLE_NON_VOICE_SUMMARY]
    narratedTraceMicTurns.value = [deleted, retained]
    publishSpokenReceipt(deleted)

    removeNarratedTraceMicTurn(deleted.id)

    expect(narratedTraceMicTurns.value).toEqual([retained])
    expect(narratedTraceLastQuery.value).toBeNull()
    expect(JSON.stringify(narratedTraceMicTurns.value)).not.toContain(VOLATILE_CANARY)
    expect(narratedTraceHistory.value).toEqual([DURABLE_NON_VOICE_SUMMARY])
    expect(JSON.stringify(narratedTraceHistory.value)).not.toContain(VOLATILE_CANARY)

    const staleLookup = await queryNarratedTraceRecords(
      {
        runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
        scope: SCOPE,
        spokenTurnId: deleted.id
      },
      {
        readSession: async () => null,
        records: narratedTraceHistory.value,
        spokenTurns: narratedTraceMicTurns.value
      }
    )
    expect(staleLookup).toMatchObject({
      matches: [],
      reason: 'spoken_turn_not_found',
      status: 'empty'
    })
    expect(staleLookup.taskCursor).toBeUndefined()
    expect(JSON.stringify(staleLookup)).not.toContain(VOLATILE_CANARY)
  })

  test('retention expiry closes the source, receipt, and continuation lookup', async () => {
    const expired = turn('expire-me', 1, {
      expiresAtEpochMs: 9_000,
      text: VOLATILE_CANARY
    })
    const retained = turn('retain-me', 2, { expiresAtEpochMs: 20_000 })
    narratedTraceHistory.value = [DURABLE_NON_VOICE_SUMMARY]
    narratedTraceMicTurns.value = [expired, retained]
    publishSpokenReceipt(expired)
    expect(JSON.stringify(narratedTraceLastQuery.value)).toContain(VOLATILE_CANARY)

    pruneNarratedTraceMicTurns(10_000)

    expect(narratedTraceMicTurns.value.map((item) => item.id)).toEqual(['retain-me'])
    expect(narratedTraceLastQuery.value).toBeNull()
    expect(JSON.stringify(narratedTraceLastQuery.value)).not.toContain(VOLATILE_CANARY)
    expect(narratedTraceHistory.value).toEqual([DURABLE_NON_VOICE_SUMMARY])
    expect(JSON.stringify(narratedTraceHistory.value)).not.toContain(VOLATILE_CANARY)

    const staleLookup = await queryNarratedTraceRecords(
      {
        runtimeTabBindingId: RUNTIME_TAB_BINDING_ID,
        scope: SCOPE,
        spokenTurnId: expired.id
      },
      {
        readSession: async () => null,
        records: narratedTraceHistory.value,
        spokenTurns: narratedTraceMicTurns.value
      }
    )
    expect(staleLookup).toMatchObject({
      matches: [],
      reason: 'spoken_turn_not_found',
      status: 'empty'
    })
    expect(staleLookup.taskCursor).toBeUndefined()
    expect(JSON.stringify(staleLookup)).not.toContain(VOLATILE_CANARY)
  })
})
