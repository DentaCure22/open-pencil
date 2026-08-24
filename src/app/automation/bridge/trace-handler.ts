import type { AutomationTarget } from '@/app/automation/bridge/target'
import { getNarratedTraceGesture, queryNarratedTraceHistory } from '@/app/narrated-trace'

import { pageOwnedAncestorId } from './board-tools/neighborhood'
import { nodeBounds } from './board-tools/readback'

type UnknownRecord = { [key: string]: unknown }

const MAX_AGENT_TRACE_CANDIDATES = 16

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function compactRecord(value: unknown, fields: readonly string[]): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(
    fields.flatMap((field) => (value[field] === undefined ? [] : [[field, value[field]]]))
  )
}

function traceMatchesTarget(target: AutomationTarget, gesture: UnknownRecord): boolean {
  const origin = isRecord(gesture.boardOrigin) ? gesture.boardOrigin : null
  if (!origin) return false
  return (
    origin.contentDocumentId === target.contentDocumentId &&
    origin.pageId === target.pageId &&
    (origin.documentId === undefined || origin.documentId === target.documentId) &&
    (origin.runtimeInstanceId === undefined ||
      origin.runtimeInstanceId === target.runtimeInstanceId) &&
    (origin.workspaceId === undefined || origin.workspaceId === target.workspaceId)
  )
}

function compactCandidate(candidate: UnknownRecord): UnknownRecord | null {
  const stableId = readString(candidate.stableId)
  if (!stableId) return null
  return {
    ...(isRecord(candidate.bounds) ? { bounds: structuredClone(candidate.bounds) } : {}),
    ...(readString(candidate.name) ? { name: readString(candidate.name) } : {}),
    ...(readString(candidate.nodeType) ? { nodeType: readString(candidate.nodeType) } : {}),
    ...(readString(candidate.relation) ? { relation: readString(candidate.relation) } : {}),
    stableId
  }
}

function compactTraceCandidates(target: AutomationTarget, gesture: UnknownRecord) {
  const candidates = isRecord(gesture.candidates) ? gesture.candidates : {}
  const rawItems = Array.isArray(candidates.items) ? candidates.items.filter(isRecord) : []
  const sameTarget = traceMatchesTarget(target, gesture)
  if (sameTarget) {
    const seen = new Set<string>()
    // Precise hits inside a container (Code Object internals, nested leaves) ride along under
    // their owner as recordedInternalIds instead of being collapsed away.
    const internalIdsByOwner = new Map<string, string[]>()
    for (const candidate of rawItems) {
      const stableId = readString(candidate.stableId)
      const ownerId = stableId ? pageOwnedAncestorId(target, stableId) : null
      if (stableId && ownerId && stableId !== ownerId) {
        internalIdsByOwner.set(ownerId, [...(internalIdsByOwner.get(ownerId) ?? []), stableId])
      }
    }
    const items = rawItems.flatMap((candidate) => {
      const stableId = readString(candidate.stableId)
      const ownerId = stableId ? pageOwnedAncestorId(target, stableId) : null
      if (!ownerId || seen.has(ownerId)) return []
      const owner = target.store.graph.getNode(ownerId)
      if (!owner) return []
      seen.add(ownerId)
      const recordedInternalIds = internalIdsByOwner.get(ownerId)
      return [
        {
          bounds: nodeBounds(target, owner),
          name: owner.name,
          nodeType: owner.type,
          ...(recordedInternalIds?.length ? { recordedInternalIds } : {}),
          relation: readString(candidate.relation) ?? 'intersecting',
          stableId: owner.id
        }
      ]
    })
    const primaryTargetId = readString(candidates.primaryTargetId)
    const primaryOwnerId = primaryTargetId
      ? (pageOwnedAncestorId(target, primaryTargetId) ?? undefined)
      : undefined
    return {
      items: items.slice(0, MAX_AGENT_TRACE_CANDIDATES),
      primaryTargetId: primaryOwnerId,
      sourceCount: finiteNumber(candidates.count) ?? rawItems.length,
      truncated: items.length > MAX_AGENT_TRACE_CANDIDATES || candidates.truncated === true
    }
  }

  const depths = rawItems.flatMap((candidate) => {
    const depth = finiteNumber(candidate.depth)
    return depth === undefined ? [] : [depth]
  })
  const shallowest = depths.length > 0 ? Math.min(...depths) : undefined
  const preferred =
    shallowest === undefined
      ? rawItems
      : rawItems.filter((candidate) => finiteNumber(candidate.depth) === shallowest)
  const compact = preferred.flatMap((candidate) => {
    const projected = compactCandidate(candidate)
    return projected ? [projected] : []
  })
  return {
    items: compact.slice(0, MAX_AGENT_TRACE_CANDIDATES),
    primaryTargetId: readString(candidates.primaryTargetId),
    sourceCount: finiteNumber(candidates.count) ?? rawItems.length,
    truncated: compact.length > MAX_AGENT_TRACE_CANDIDATES || candidates.truncated === true
  }
}

function compactTraceResult(target: AutomationTarget, value: unknown): unknown {
  if (!isRecord(value) || value.status !== 'matched' || !isRecord(value.gesture)) return value
  const gesture = value.gesture
  const geometry = isRecord(gesture.geometry) ? gesture.geometry : {}
  const pageRegion = isRecord(geometry.pageRegion) ? geometry.pageRegion : null
  const candidates = compactTraceCandidates(target, gesture)
  const evidence = isRecord(gesture.evidence) ? gesture.evidence : null
  const image = evidence && isRecord(evidence.image) ? evidence.image : null
  return {
    ...value,
    gesture: {
      boardOrigin: structuredClone(gesture.boardOrigin),
      candidates: {
        count: candidates.items.length,
        items: candidates.items,
        ...(candidates.primaryTargetId ? { primaryTargetId: candidates.primaryTargetId } : {}),
        source_count: candidates.sourceCount,
        truncated: candidates.truncated
      },
      capturedAt: gesture.capturedAt,
      contract: 'trace-gesture-agent/v1',
      ...(evidence
        ? {
            evidence: {
              ...compactRecord(evidence, [
                'evidenceId',
                'height',
                'mimeType',
                'omissions',
                'targetStableId',
                'width'
              ]),
              ...(image ? { image: structuredClone(image) } : {})
            }
          }
        : {}),
      ...(gesture.evidenceStatus ? { evidenceStatus: gesture.evidenceStatus } : {}),
      geometry: {
        kind: geometry.kind,
        ...(pageRegion ? { pageRegion: structuredClone(pageRegion) } : {})
      },
      gestureId: gesture.gestureId,
      scope: structuredClone(gesture.scope),
      sessionId: gesture.sessionId,
      ...(gesture.target
        ? {
            target: compactRecord(gesture.target, ['bounds', 'name', 'stableId'])
          }
        : {})
    }
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function assertTraceSelector(input: UnknownRecord) {
  const hasLatestSpokenTurn = input.latest_spoken_turn === true
  const hasSpokenText = Boolean(readString(input.spoken_text))
  const hasSpokenTurnId = Boolean(readString(input.spoken_turn_id))
  const selectorCount = [
    Boolean(readString(input.query)),
    Boolean(readString(input.task_cursor)),
    hasLatestSpokenTurn,
    hasSpokenText,
    hasSpokenTurnId
  ].filter(Boolean).length
  if (selectorCount !== 1) {
    throw new Error(
      'Trace queries require exactly one of query, task_cursor, latest_spoken_turn, spoken_turn_id, or spoken_text.'
    )
  }
  if (
    (hasLatestSpokenTurn || hasSpokenText || hasSpokenTurnId) &&
    (readString(input.since) || readString(input.until))
  ) {
    throw new Error('Spoken-turn retrieval cannot be combined with since or until.')
  }
  if (input.turn_context === true && !hasLatestSpokenTurn && !hasSpokenText && !hasSpokenTurnId) {
    throw new Error('turn_context requires a spoken-turn selector.')
  }
}

export async function handleTraceQuery(
  _target: AutomationTarget,
  args: unknown,
  queryTrace: typeof queryNarratedTraceHistory = queryNarratedTraceHistory
): Promise<unknown> {
  const input = isRecord(args) ? args : {}
  assertTraceSelector(input)
  const limit =
    typeof input.limit === 'number' && Number.isInteger(input.limit) ? input.limit : undefined

  return {
    ok: true,
    result: await queryTrace({
      cursor: readString(input.task_cursor),
      latestSpokenTurn: input.latest_spoken_turn === true,
      limit,
      query: readString(input.query),
      since: readString(input.since),
      spokenText: readString(input.spoken_text),
      spokenTurnId: readString(input.spoken_turn_id),
      turnContext: input.turn_context === true,
      until: readString(input.until)
    })
  }
}

export async function handleTraceGesture(
  target: AutomationTarget,
  args: unknown,
  getGesture: typeof getNarratedTraceGesture = getNarratedTraceGesture
): Promise<unknown> {
  const input = isRecord(args) ? args : {}
  const gestureId = readString(input.gesture_id)
  const latest = input.latest === true
  if (Boolean(gestureId) === latest) {
    throw new Error('Trace gesture retrieval requires exactly one of latest true or gesture_id.')
  }
  const result = await getGesture({
    ...(gestureId ? { gestureId } : {}),
    includeImage: input.include_image === true,
    latest
  })
  return {
    ok: true,
    result: input.raw === true ? result : compactTraceResult(target, result)
  }
}
