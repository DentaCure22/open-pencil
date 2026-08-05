import { defineCommand } from 'citty'

import { rpcEnvelopeExact } from '#cli/app-client'
import { bold, entity, fmtList, printError } from '#cli/format'

type TraceCliArgs = {
  'gesture-id'?: string
  'include-image'?: boolean
  'latest-gesture'?: boolean
  'latest-spoken-turn'?: boolean
  'spoken-text'?: string
  'spoken-turn-id'?: string
  'task-cursor'?: string
  json?: boolean
  limit?: string
  query?: string
  raw?: boolean
  since?: string
  until?: string
}

type TraceGestureResult = {
  gesture?: {
    candidates: { count: number; primaryTargetId?: string }
    capturedAt: string
    evidence?: { evidenceId: string }
    gestureId: string
    scope: { documentName?: string; documentId: string; pageName?: string; pageId: string }
  }
  reason?: string
  scanned: { sessions: number }
  status: 'empty' | 'error' | 'matched'
}

type TraceQueryEvent = {
  kind: string
  label: string
}

type TraceQueryMatch = {
  endedAt: string
  events: TraceQueryEvent[]
  matchedBy: string[]
  score: number
  scope: {
    documentId: string
    documentName?: string
    pageId: string
    pageName?: string
    workspaceId?: string
  }
  sessionId: string
  startedAt: string
  title: string
}

type TraceQueryResult = {
  matches: TraceQueryMatch[]
  reason?: string
  scanned: {
    indexCandidates: number
    sessions: number
  }
  sourceSpokenTurn?: {
    id: string
    text: string
  }
  status: 'ambiguous' | 'empty' | 'error' | 'matched'
  taskCursor?: string
}

function readLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new Error('--limit must be an integer from 1 to 5.')
  }
  return limit
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim()
  return result || undefined
}

function validateTraceSelectors(args: TraceCliArgs) {
  const query = trimmed(args.query)
  const cursor = trimmed(args['task-cursor'])
  const spokenText = trimmed(args['spoken-text'])
  const spokenTurnId = trimmed(args['spoken-turn-id'])
  const latestSpokenTurn = args['latest-spoken-turn'] === true
  const gestureId = trimmed(args['gesture-id'])
  const latestGesture = args['latest-gesture'] === true
  const selectorCount = [
    query,
    cursor,
    gestureId,
    latestGesture,
    latestSpokenTurn,
    spokenText,
    spokenTurnId
  ].filter(Boolean).length
  if (selectorCount !== 1) {
    throw new Error(
      'Choose exactly one of --latest-gesture, --gesture-id, --query, --task-cursor, --latest-spoken-turn, --spoken-text, or --spoken-turn-id.'
    )
  }
  if ((latestSpokenTurn || spokenText || spokenTurnId) && (args.since || args.until)) {
    throw new Error('Spoken-turn retrieval cannot be combined with --since or --until.')
  }
  if ((gestureId || latestGesture) && (args.since || args.until || args.limit)) {
    throw new Error('Gesture retrieval cannot be combined with --since, --until, or --limit.')
  }
  return {
    cursor,
    gestureId,
    latestGesture,
    latestSpokenTurn,
    query,
    spokenText,
    spokenTurnId
  }
}

export function traceRpcArgs(args: TraceCliArgs): Record<string, unknown> {
  const selector = validateTraceSelectors(args)

  if (selector.gestureId || selector.latestGesture) {
    return {
      gesture_id: selector.gestureId,
      include_image: args['include-image'] === true,
      latest: selector.latestGesture || undefined,
      ...(args.raw === true ? { raw: true } : {})
    }
  }

  return {
    latest_spoken_turn: selector.latestSpokenTurn || undefined,
    limit: readLimit(args.limit),
    query: selector.query,
    since: trimmed(args.since),
    spoken_text: selector.spokenText,
    spoken_turn_id: selector.spokenTurnId,
    task_cursor: selector.cursor,
    until: trimmed(args.until)
  }
}

export function traceRpcCommand(args: TraceCliArgs) {
  const selector = validateTraceSelectors(args)
  return selector.gestureId || selector.latestGesture ? 'trace_get_gesture' : 'trace_query'
}

function printTrace(result: TraceQueryResult, json: boolean) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log('')
  console.log(bold('  Trace query'))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: entity('status', result.status),
          details: {
            ...(result.reason ? { reason: result.reason } : {}),
            scanned: `${result.scanned.sessions} sessions / ${result.scanned.indexCandidates} candidates`,
            ...(result.sourceSpokenTurn
              ? { spoken: entity('turn', result.sourceSpokenTurn.text, result.sourceSpokenTurn.id) }
              : {}),
            ...(result.taskCursor ? { cursor: result.taskCursor } : {})
          }
        }
      ],
      { compact: true }
    )
  )

  if (result.matches.length > 0) {
    console.log('')
    console.log(
      fmtList(
        result.matches.map((match) => ({
          header: entity('trace', match.title, match.sessionId),
          details: {
            board: `${match.scope.documentName ?? match.scope.documentId} / ${match.scope.pageName ?? match.scope.pageId}`,
            events: match.events.map((event) => `${event.kind}: ${event.label}`).join(' · '),
            matched: match.matchedBy.join(', '),
            score: match.score,
            window: `${match.startedAt} → ${match.endedAt}`
          }
        }))
      )
    )
  }
  console.log('')
}

function printGesture(result: TraceGestureResult, json: boolean) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const gesture = result.gesture
  console.log('')
  console.log(bold('  Trace gesture'))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: entity('status', result.status),
          details: {
            ...(result.reason ? { reason: result.reason } : {}),
            ...(gesture
              ? {
                  board: `${gesture.scope.documentName ?? gesture.scope.documentId} / ${gesture.scope.pageName ?? gesture.scope.pageId}`,
                  candidates: gesture.candidates.count,
                  captured: gesture.capturedAt,
                  evidence: gesture.evidence?.evidenceId ?? 'unavailable',
                  gesture: gesture.gestureId,
                  primary: gesture.candidates.primaryTargetId ?? 'canvas region'
                }
              : {}),
            scanned: `${result.scanned.sessions} sessions`
          }
        }
      ],
      { compact: true }
    )
  )
  console.log('')
}

export default defineCommand({
  meta: {
    name: 'trace',
    description:
      'Resolve an active gesture episode or query read-only Trace history; every result identifies its source Board'
  },
  args: {
    'latest-gesture': {
      type: 'boolean',
      description: 'Resolve the latest immutable gesture packet without lexical search'
    },
    'gesture-id': { type: 'string', description: 'Resolve one exact immutable gesture packet' },
    'include-image': {
      type: 'boolean',
      description: 'Include the bounded screenshot; omitted by default'
    },
    raw: {
      type: 'boolean',
      description: 'Return the diagnostic packet instead of the compact agent projection'
    },
    query: { type: 'string', description: 'Ranked Trace history query' },
    'task-cursor': { type: 'string', description: 'Continue one prior Trace result' },
    'latest-spoken-turn': {
      type: 'boolean',
      description: 'Read the latest non-expired spoken turn’s exact Trace window'
    },
    'spoken-text': { type: 'string', description: 'Resolve one spoken turn by quoted text' },
    'spoken-turn-id': { type: 'string', description: 'Resolve one exact spoken turn ID' },
    since: { type: 'string', description: 'Inclusive ISO start time for ranked history' },
    until: { type: 'string', description: 'Inclusive ISO end time for ranked history' },
    limit: { type: 'string', description: 'Maximum results from 1 to 5' },
    json: { type: 'boolean', description: 'Output as JSON' }
  },
  async run({ args }) {
    try {
      const command = traceRpcCommand(args)
      if (command === 'trace_get_gesture') {
        const response = await rpcEnvelopeExact<TraceGestureResult>(command, traceRpcArgs(args))
        printGesture(response.result, !!args.json)
        return
      }
      const response = await rpcEnvelopeExact<TraceQueryResult>(command, traceRpcArgs(args))
      printTrace(response.result, !!args.json)
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})
