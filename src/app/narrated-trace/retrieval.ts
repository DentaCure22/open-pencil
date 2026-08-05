import { shallowRef } from 'vue'

import type { Vector } from '@open-pencil/scene-graph'

import type {
  NarratedTraceQueryEvent,
  NarratedTraceQueryInput,
  NarratedTraceQueryResult
} from './query'
import type { NarratedTraceScope } from './types'

const MAX_RETRIEVAL_EVENT_SUMMARIES = 5
const MAX_RETRIEVAL_EVENT_LABEL_LENGTH = 160
const MAX_RETRIEVAL_TRANSCRIPT_LENGTH = 480

export type NarratedTraceQueryReceipt = {
  completedAt: string
  query?: string
  result: NarratedTraceQueryResult
  scope?: NarratedTraceScope
}

export type NarratedTraceRetrievalEventSummary = {
  anchor?: Vector
  id: string
  kind: NarratedTraceQueryEvent['kind']
  label: string
  target?: {
    name: string
    stableId: string
  }
}

export type NarratedTraceRetrievalSpokenTurnSummary = {
  endedAt: string
  id: string
  startedAt: string
  text: string
}

export type NarratedTraceRetrievalWindow = {
  endedAt: string
  startedAt: string
}

export type NarratedTraceRetrievalSummary = {
  anchor?: Vector
  candidateCount: number
  detail: string
  eventCount: number
  eventCountLabel: string
  eventSummaries: NarratedTraceRetrievalEventSummary[]
  matchCount: number
  matchedBy: string[]
  matchedTitle?: string
  scopeLabel: string
  sourceSpokenTurn?: NarratedTraceRetrievalSpokenTurnSummary
  status: NarratedTraceQueryResult['status']
  title: string
  window?: NarratedTraceRetrievalWindow
}

export const narratedTraceLastQuery = shallowRef<NarratedTraceQueryReceipt | null>(null)

function receiptSpokenTurnIds(receipt: NarratedTraceQueryReceipt): Set<string> {
  return new Set(
    [
      receipt.result.sourceSpokenTurn?.id,
      ...(receipt.result.spokenTurnCandidates?.map((turn) => turn.id) ?? [])
    ].filter((id): id is string => typeof id === 'string')
  )
}

export function scrubNarratedTraceQueryReceiptForMicTurns(turnIds?: readonly string[]) {
  const receipt = narratedTraceLastQuery.value
  if (!receipt) return false
  const receiptTurnIds = receiptSpokenTurnIds(receipt)
  if (receiptTurnIds.size === 0) return false
  if (turnIds && !turnIds.some((turnId) => receiptTurnIds.has(turnId))) return false
  narratedTraceLastQuery.value = null
  return true
}

function statusCopy(result: NarratedTraceQueryResult) {
  switch (result.status) {
    case 'matched':
      return {
        detail: 'Bounded Trace evidence was found in this exact Board.',
        title: 'Trace matched'
      }
    case 'ambiguous':
      return {
        detail: `More context is required${result.reason ? ` · ${result.reason}` : ''}.`,
        title: 'Trace needs clarification'
      }
    case 'empty':
      return {
        detail: `No bounded Trace evidence matched${result.reason ? ` · ${result.reason}` : ''}.`,
        title: 'No matching Trace'
      }
    case 'error':
      return {
        detail: `Trace retrieval failed${result.reason ? ` · ${result.reason}` : ''}.`,
        title: 'Trace unavailable'
      }
  }
}

function scopeLabel(scope: NarratedTraceScope) {
  return [
    scope.workspaceId ? `Workspace ${scope.workspaceId}` : undefined,
    `Document ${scope.documentName ? `${scope.documentName} (${scope.documentId})` : scope.documentId}`,
    `Board ${scope.pageName ? `${scope.pageName} (${scope.pageId})` : scope.pageId}`
  ]
    .filter((part): part is string => typeof part === 'string')
    .join(' · ')
}

function compactSummaryText(value: string, maximum: number) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maximum) return compact
  return `${compact.slice(0, maximum - 1).trimEnd()}…`
}

function summarizeEvent(event: NarratedTraceQueryEvent): NarratedTraceRetrievalEventSummary {
  return {
    ...(event.anchor
      ? { anchor: { x: event.anchor.pagePoint.x, y: event.anchor.pagePoint.y } }
      : {}),
    id: event.id,
    kind: event.kind,
    label: compactSummaryText(event.label, MAX_RETRIEVAL_EVENT_LABEL_LENGTH),
    ...(event.target
      ? {
          target: {
            name: compactSummaryText(event.target.name, MAX_RETRIEVAL_EVENT_LABEL_LENGTH),
            stableId: compactSummaryText(event.target.stableId, MAX_RETRIEVAL_EVENT_LABEL_LENGTH)
          }
        }
      : {})
  }
}

function retrievalWindow(
  result: NarratedTraceQueryResult
): NarratedTraceRetrievalWindow | undefined {
  const sourceSpokenTurn = result.sourceSpokenTurn
  if (sourceSpokenTurn) {
    return { endedAt: sourceSpokenTurn.endedAt, startedAt: sourceSpokenTurn.startedAt }
  }
  const firstMatch = result.matches[0]
  if (!firstMatch) return undefined
  return { endedAt: firstMatch.endedAt, startedAt: firstMatch.startedAt }
}

export function publishNarratedTraceQueryReceipt(
  input: NarratedTraceQueryInput,
  result: NarratedTraceQueryResult,
  completedAt = new Date().toISOString()
) {
  narratedTraceLastQuery.value = {
    completedAt,
    ...(input.query?.trim() ? { query: input.query.trim() } : {}),
    result: structuredClone(result),
    ...((input.scope ?? result.sourceSpokenTurn?.scope ?? result.matches[0]?.scope)
      ? {
          scope: structuredClone(
            input.scope ?? result.sourceSpokenTurn?.scope ?? result.matches[0]?.scope
          )
        }
      : {})
  }
}

export function summarizeNarratedTraceRetrieval(
  receipt: NarratedTraceQueryReceipt
): NarratedTraceRetrievalSummary {
  const events = receipt.result.matches.flatMap((match) => match.events)
  const anchor = events.find((event) => event.anchor)?.anchor?.pagePoint
  const copy = statusCopy(receipt.result)
  const firstMatch = receipt.result.matches[0]
  const sourceSpokenTurn = receipt.result.sourceSpokenTurn
  const window = retrievalWindow(receipt.result)
  return {
    ...(anchor ? { anchor: { x: anchor.x, y: anchor.y } } : {}),
    candidateCount: receipt.result.scanned.indexCandidates,
    detail: copy.detail,
    eventCount: events.length,
    eventCountLabel: `${events.length} ${events.length === 1 ? 'event' : 'events'}`,
    eventSummaries: events.slice(0, MAX_RETRIEVAL_EVENT_SUMMARIES).map(summarizeEvent),
    matchCount: receipt.result.matches.length,
    matchedBy: [...new Set(receipt.result.matches.flatMap((match) => match.matchedBy))],
    matchedTitle: firstMatch?.title,
    scopeLabel: receipt.scope ? scopeLabel(receipt.scope) : 'All Boards',
    ...(sourceSpokenTurn
      ? {
          sourceSpokenTurn: {
            endedAt: sourceSpokenTurn.endedAt,
            id: sourceSpokenTurn.id,
            startedAt: sourceSpokenTurn.startedAt,
            text: compactSummaryText(sourceSpokenTurn.text, MAX_RETRIEVAL_TRANSCRIPT_LENGTH)
          }
        }
      : {}),
    status: receipt.result.status,
    title: copy.title,
    ...(window ? { window } : {})
  }
}
