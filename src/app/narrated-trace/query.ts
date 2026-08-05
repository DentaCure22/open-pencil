import {
  queryTraceRecords,
  type TraceQueryDependencies,
  type TraceQueryEvent,
  type TraceQueryInput,
  type TraceQueryMatch,
  type TraceQueryPublicSpokenTurn,
  type TraceQueryResult
} from '@open-pencil/core/rpc'

import {
  loadNarratedTraceHistory,
  readNarratedTraceRecord,
  summarizeNarratedTraceSession
} from './history'
import { narratedTraceMicTurns } from './mic'
import { publishNarratedTraceQueryReceipt } from './retrieval'
import { narratedTraceSession, narratedTraceStatus } from './state'

export type NarratedTraceQueryInput = TraceQueryInput
export type NarratedTraceQueryEvent = TraceQueryEvent
export type NarratedTraceQueryMatch = TraceQueryMatch
export type NarratedTraceQuerySpokenTurn = TraceQueryPublicSpokenTurn
export type NarratedTraceQueryResult = TraceQueryResult
export type QueryDependencies = TraceQueryDependencies

export const queryNarratedTraceRecords = queryTraceRecords

export async function queryNarratedTraceHistory(
  input: NarratedTraceQueryInput
): Promise<NarratedTraceQueryResult> {
  let result: NarratedTraceQueryResult
  try {
    const persistedRecords = await loadNarratedTraceHistory()
    const currentSession = narratedTraceSession.value
    const records = currentSession
      ? [
          summarizeNarratedTraceSession(
            currentSession,
            persistedRecords.find((record) => record.id === currentSession.id)?.title
          ),
          ...persistedRecords.filter((record) => record.id !== currentSession.id)
        ]
      : persistedRecords
    result = await queryTraceRecords(input, {
      currentSession,
      currentSessionSettled: narratedTraceStatus.value === 'review',
      readSession: readNarratedTraceRecord,
      records,
      spokenTurns: narratedTraceMicTurns.value
    })
  } catch {
    result = {
      matches: [],
      reason: 'trace_read_failed',
      scanned: { indexCandidates: 0, sessions: 0 },
      status: 'error'
    }
  }
  publishNarratedTraceQueryReceipt(input, result)
  return result
}
