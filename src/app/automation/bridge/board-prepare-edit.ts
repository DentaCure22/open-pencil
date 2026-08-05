import { boardBuildTracedConnections } from '@open-pencil/core/rpc'
import type { ObjectGraphConnection, Rect, SceneNode } from '@open-pencil/scene-graph'

import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import { codeObjectRegionHints } from '@/app/code-object/inspector'
import { codeObjectDocument } from '@/app/code-object/model'
import { isNarratedTraceCanvasInkNode } from '@/app/narrated-trace/canvas-ink'

import { pageOwnedAncestorId } from './board-tools/neighborhood'

const MAX_PREPARED_CANDIDATES = 25

type CodeObjectReadHandler = (target: AutomationTarget, args: unknown) => Promise<unknown>

type BoardPrepareEditReader = {
  context: (target: AutomationTarget) => Promise<unknown>
  read: (target: AutomationTarget, args: unknown) => Promise<unknown>
}

type BoardPrepareEditOptions = {
  board: BoardPrepareEditReader
  codeObjectRead: CodeObjectReadHandler
}

function requiredString(args: UnknownRecord, field: string) {
  const value = args[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`board_prepare_edit requires ${field}.`)
  }
  return value.trim()
}

function optionalString(args: UnknownRecord, field: string) {
  const value = args[field]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function traceRegion(args: UnknownRecord): Rect {
  const value = args.region
  if (!isUnknownRecord(value)) throw new Error('board_prepare_edit requires a page-space region.')
  const numberField = (field: keyof Rect) => {
    const item = value[field]
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new TypeError(`board_prepare_edit region.${field} must be finite.`)
    }
    return item
  }
  const region = {
    height: numberField('height'),
    width: numberField('width'),
    x: numberField('x'),
    y: numberField('y')
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new Error('board_prepare_edit region width and height must be positive.')
  }
  return region
}

function requestedCandidateIds(args: UnknownRecord, primaryTargetId?: string) {
  const values = Array.isArray(args.candidate_object_ids) ? args.candidate_object_ids : []
  const ids = values.flatMap((value) =>
    typeof value === 'string' && value.trim() ? [value.trim()] : []
  )
  const ordered = [...(primaryTargetId ? [primaryTargetId] : []), ...ids]
  return [...new Set(ordered)].slice(0, MAX_PREPARED_CANDIDATES)
}

function currentCandidates(target: AutomationTarget, ids: string[]) {
  return ids.flatMap((id) => {
    const node = target.store.graph.getNode(id)
    if (
      !node ||
      node.type === 'CANVAS' ||
      isNarratedTraceCanvasInkNode(node) ||
      !target.store.graph.isDescendant(node.id, target.pageId)
    ) {
      return []
    }
    return [node]
  })
}

function pageOwnedCandidates(target: AutomationTarget, candidates: SceneNode[]): SceneNode[] {
  const ownerIds = new Set<string>()
  return candidates.flatMap((candidate) => {
    const ownerId = pageOwnedAncestorId(target, candidate.id)
    if (!ownerId || ownerIds.has(ownerId)) return []
    const owner = target.store.graph.getNode(ownerId)
    if (!owner) return []
    ownerIds.add(ownerId)
    return [owner]
  })
}

function connectionSummary(connection: ObjectGraphConnection) {
  return {
    connection_id: connection.id,
    kind: connection.kind,
    source_id: connection.sourceNodeId,
    source_port: connection.sourcePortId ?? connection.sourcePort,
    target_id: connection.targetNodeId,
    target_port: connection.targetPortId ?? connection.targetPort
  }
}

function codeObjectOwner(target: AutomationTarget, node: SceneNode | undefined) {
  let current = node
  while (current && current.type !== 'CANVAS') {
    if (codeObjectDocument(current)) return current
    current = current.parentId ? target.store.graph.getNode(current.parentId) : undefined
  }
  return undefined
}

function resolutionStatus(selected: SceneNode | undefined, candidateCount: number) {
  if (selected) return 'resolved'
  return candidateCount > 1 ? 'ambiguous' : 'none'
}

function clientRegion(target: AutomationTarget, region: Rect): Rect | null {
  if (typeof document === 'undefined') return null
  const area = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
  if (!area) return null
  const bounds = area.getBoundingClientRect()
  const zoom = target.store.state.zoom
  return {
    height: region.height * zoom,
    width: region.width * zoom,
    x: bounds.left + region.x * zoom + target.store.state.panX,
    y: bounds.top + region.y * zoom + target.store.state.panY
  }
}

export function createAutomationBoardPrepareEditHandler(options: BoardPrepareEditOptions) {
  return async function handleBoardPrepareEdit(
    target: AutomationTarget,
    rawArgs: unknown
  ): Promise<unknown> {
    if (!isUnknownRecord(rawArgs))
      throw new Error('board_prepare_edit arguments must be an object.')
    const gestureId = requiredString(rawArgs, 'gesture_id')
    const intent = requiredString(rawArgs, 'intent')
    const region = traceRegion(rawArgs)
    const primaryTargetId = optionalString(rawArgs, 'primary_target_id')
    const requestedIds = requestedCandidateIds(rawArgs, primaryTargetId)
    const rawCandidates = currentCandidates(target, requestedIds)
    const rawCandidateIds = rawCandidates.map((candidate) => candidate.id)
    const candidates = pageOwnedCandidates(target, rawCandidates)
    const currentIds = candidates.map((candidate) => candidate.id)
    const primaryOwnerId = primaryTargetId
      ? pageOwnedAncestorId(target, primaryTargetId)
      : undefined
    const selected =
      (primaryOwnerId ? candidates.find((candidate) => candidate.id === primaryOwnerId) : null) ??
      (candidates.length === 1 ? candidates[0] : undefined)
    const traceConnections = boardBuildTracedConnections(target.store.graph, target.pageId, {
      kind: 'connection.delete_traced',
      object_ids: currentIds,
      orientation: 'any',
      region
    })

    const rawContext: unknown = await options.board.context(target)
    if (!isUnknownRecord(rawContext)) {
      throw new Error('board_prepare_edit Board context is unavailable.')
    }
    const context: UnknownRecord = rawContext
    const contextToken = requiredString(context, 'context_token')
    const boardBuildBase = isUnknownRecord(context.board_build_base)
      ? context.board_build_base
      : null
    const readback =
      currentIds.length > 0
        ? await options.board.read(target, {
            context_token: contextToken,
            limit: MAX_PREPARED_CANDIDATES,
            object_ids: currentIds,
            scope: 'objects'
          })
        : { board_revision: target.store.state.sceneVersion, count: 0, nodes: [], scope: 'objects' }
    const codeOwner = codeObjectOwner(target, selected)
    const codeObject = codeOwner
      ? await options.codeObjectRead(target, { owner_id: codeOwner.id })
      : null
    const visibleRegion = codeOwner ? clientRegion(target, region) : null

    return {
      board_build_base: boardBuildBase,
      code_object:
        codeOwner && isUnknownRecord(codeObject)
          ? {
              ...codeObject,
              region_hints: visibleRegion ? codeObjectRegionHints(codeOwner.id, visibleRegion) : [],
              region_mapping: visibleRegion ? 'live-runtime' : 'unavailable'
            }
          : null,
      contract: 'board-edit-context/v1',
      gesture_id: gestureId,
      intent,
      readback,
      resolution: {
        candidate_object_ids: currentIds,
        missing_object_ids: requestedIds.filter((id) => !rawCandidateIds.includes(id)),
        ...(selected ? { selected_object_id: selected.id } : {}),
        status: resolutionStatus(selected, candidates.length)
      },
      trace_connections: {
        count: traceConnections.length,
        items: traceConnections.map(connectionSummary),
        limit: 32,
        truncated: traceConnections.length === 32
      },
      trace_region: region
    }
  }
}
