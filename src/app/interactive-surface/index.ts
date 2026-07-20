import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  applyEvidenceBriefEvent,
  evidenceBriefStateForBoard,
  parseEvidenceBriefEvent
} from '@/app/evidence-brief'
import {
  applyFlowStudioEvent,
  flowStudioStateForBoard,
  parseFlowStudioEvent
} from '@/app/flow-studio'
import { htmlBoardDocument, isHtmlBoardFrame } from '@/app/html-board/workspace'
import {
  applyInteractiveProgramEvent,
  interactiveProgramStateForBoard,
  parseInteractiveProgramEvent
} from '@/app/interactive-program'
import {
  applyRecordExplorerEvent,
  parseRecordExplorerEvent,
  recordExplorerStateForBoard
} from '@/app/record-explorer'
import {
  applySequentialPresentationEvent,
  parseSequentialPresentationEvent,
  sequentialPresentationStateForBoard
} from '@/app/sequential-presentation'
import {
  applySpatialMapEvent,
  parseSpatialMapEvent,
  spatialMapStateForBoard
} from '@/app/spatial-map'
import {
  applyWeeklyDecisionEvent,
  parseWeeklyDecisionEvent,
  weeklyDecisionStateForBoard
} from '@/app/weekly-decision'

export {
  resolveInteractiveSurfacePresentation,
  type InteractiveSurfaceComparisonBasis,
  type InteractiveSurfacePresentationResolution,
  type InteractiveSurfacePresentationRole
} from './presentation'

export type InteractiveSurfaceKind =
  | 'evidence-brief-surface'
  | 'flow-studio-surface'
  | 'interactive-program-surface'
  | 'record-explorer-surface'
  | 'sequential-presentation-surface'
  | 'spatial-map-surface'
  | 'weekly-decision-surface'

function eventIdFor(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'invalid-event'
  const eventId = (payload as { eventId?: unknown }).eventId
  return typeof eventId === 'string' && eventId.length > 0 ? eventId.slice(0, 120) : 'invalid-event'
}

export function interactiveSurfaceKind(board: SceneNode): InteractiveSurfaceKind | null {
  if (!isHtmlBoardFrame(board)) return null
  const kind = htmlBoardDocument(board).artifact?.kind
  if (
    kind === 'evidence-brief-surface' ||
    kind === 'flow-studio-surface' ||
    kind === 'interactive-program-surface' ||
    kind === 'record-explorer-surface' ||
    kind === 'sequential-presentation-surface' ||
    kind === 'spatial-map-surface' ||
    kind === 'weekly-decision-surface'
  ) {
    return kind
  }
  return null
}

export function interactiveSurfaceStateForBoard(store: EditorStore, board: SceneNode) {
  const kind = interactiveSurfaceKind(board)
  if (kind === 'evidence-brief-surface') return evidenceBriefStateForBoard(store, board)
  if (kind === 'flow-studio-surface') return flowStudioStateForBoard(store, board)
  if (kind === 'interactive-program-surface') return interactiveProgramStateForBoard(store, board)
  if (kind === 'record-explorer-surface') return recordExplorerStateForBoard(store, board)
  if (kind === 'sequential-presentation-surface') {
    return sequentialPresentationStateForBoard(store, board)
  }
  if (kind === 'spatial-map-surface') return spatialMapStateForBoard(store, board)
  if (kind === 'weekly-decision-surface') return weeklyDecisionStateForBoard(store, board)
  return null
}

export async function applyInteractiveSurfaceEvent(
  store: EditorStore,
  board: SceneNode,
  payload: unknown
) {
  const kind = interactiveSurfaceKind(board)
  if (kind === 'evidence-brief-surface') {
    const request = parseEvidenceBriefEvent(payload)
    return request
      ? applyEvidenceBriefEvent(store, request)
      : {
          error: 'Invalid evidence brief event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  if (kind === 'flow-studio-surface') {
    const request = parseFlowStudioEvent(payload)
    return request
      ? applyFlowStudioEvent(store, request)
      : {
          error: 'Invalid flow studio event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  if (kind === 'interactive-program-surface') {
    const request = parseInteractiveProgramEvent(payload)
    return request
      ? applyInteractiveProgramEvent(store, request)
      : {
          error: 'Invalid interactive program event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  if (kind === 'record-explorer-surface') {
    const request = parseRecordExplorerEvent(payload)
    return request
      ? applyRecordExplorerEvent(store, request)
      : {
          error: 'Invalid record explorer event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  if (kind === 'sequential-presentation-surface') {
    const request = parseSequentialPresentationEvent(payload)
    return request
      ? applySequentialPresentationEvent(store, request)
      : {
          error: 'Invalid sequential presentation event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  if (kind === 'spatial-map-surface') {
    const request = parseSpatialMapEvent(payload)
    return request
      ? applySpatialMapEvent(store, request)
      : {
          error: 'Invalid spatial map event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  if (kind === 'weekly-decision-surface') {
    const request = parseWeeklyDecisionEvent(payload)
    return request
      ? applyWeeklyDecisionEvent(store, request)
      : {
          error: 'Invalid weekly decision event',
          eventId: eventIdFor(payload),
          status: 'rejected' as const
        }
  }
  return {
    error: 'Unsupported interactive surface',
    eventId: eventIdFor(payload),
    status: 'rejected' as const
  }
}
