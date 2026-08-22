import type { NodeType } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type {
  NarratedTraceEvidence,
  NarratedTraceScope,
  NarratedTraceTarget,
  NarratedTraceViewport
} from '@/app/narrated-trace'

export type ContextCommentTargetKind = 'board' | 'live-container' | 'selection'

export type ContextCommentFlow = 'comment' | 'screenshot'

export type ContextCommentDestination = {
  action: 'follow-up' | 'steer'
  kind: 'agent-conversation'
  modelScope: string
  threadId: string
}

export type ContextCommentAnnotationSource = {
  bounds?: Rect
  id: string
  kind: 'board' | 'generated-image' | 'scene-node'
  label: string
  nodeType?: NodeType
  path?: string[]
  route?: string
}

export type ContextCommentAnnotationCandidate = {
  id: string
  label: string
  nodeType: NodeType
}

export type ContextCommentAnnotationSelector =
  | {
      kind: 'board-position'
      point: Vector
      region: Rect
      viewport: NarratedTraceViewport
    }
  | {
      bounds: Rect
      kind: 'node-relative'
      localPoint: Vector
      normalizedPoint: Vector
      nodeId: string
    }
  | {
      coordinateSpace: 'media' | 'object'
      durationSeconds?: number
      fileName?: string
      kind: 'media-fragment'
      mediaKind: 'audio' | 'image' | 'video'
      mimeType?: string
      paused?: boolean
      spatial?: Vector
      timeSeconds?: number
    }
  | {
      fileName?: string
      format: string
      kind: 'document-position'
      page?: number
      revision?: number
      slide?: number
    }
  | {
      component: string
      definitionId: string
      frameId: string
      kind: 'code-object'
      route?: string
      schemaVersion: number
      stateSummary?: string
    }
  | {
      boundsNormalized: Rect
      css: string
      frameId: string
      kind: 'dom-element'
      name: string
      role?: string
      tagName: string
      text?: string
    }
  | {
      attrs?: Record<string, string>
      frameId: string
      kind: 'live-element'
      localRect: Rect
      role?: string
      stableId: string
      tagName?: string
      text?: string
    }
  | {
      diagramId: string
      kind: 'diagram-element'
      ownerId: string
      revision?: number
      semanticId?: string
    }
  | {
      camera?: {
        position: [number, number, number]
        target: [number, number, number]
      }
      fileName: string
      format: string
      kind: 'spatial-projection'
      precision: 'projected-only'
    }
  | {
      conversationId: string
      frameId: string
      kind: 'agent-conversation'
    }

export type ContextCommentAnnotationAnchor = {
  candidateTargets: ContextCommentAnnotationCandidate[]
  capturedAtEpochMs: number
  sceneVersion?: number
  scope?: NarratedTraceScope
  selectors: ContextCommentAnnotationSelector[]
  source: ContextCommentAnnotationSource
}

export type ContextCommentMediaPlaybackState = {
  currentTimeSeconds: number
  durationSeconds?: number
  paused: boolean
}

export type ContextCommentImageAnnotation = {
  anchor?: ContextCommentAnnotationAnchor
  comment: string
  id: string
  /** Horizontal position normalized to the captured image. */
  x: number
  /** Vertical position normalized to the captured image. */
  y: number
}

export type ContextCommentCaptureSource = {
  capturedAtEpochMs?: number
  canvasBounds: Rect
  displaySurface: 'board' | 'browser' | 'unknown'
  height: number
  imageUrl: string
  mediaPlayback?: Record<string, ContextCommentMediaPlaybackState>
  source: NarratedTraceEvidence['source']
  viewport: NarratedTraceViewport
  viewportHeight: number
  viewportWidth: number
  width: number
}

export type ContextCommentBoardCapture = {
  boardBounds: Rect
  screenBounds: Rect
  viewport: NarratedTraceViewport
}

export type ContextCommentOwner = {
  componentName?: string
  filePath?: string
  lineNumber?: number
}

export type ContextCommentLiveSelection = {
  attrs?: Record<string, string>
  className?: string
  layout?: Record<string, string>
  localRect: Rect
  ownerPath?: ContextCommentOwner[]
  parentLabel?: string
  parentRect?: Rect
  role?: string
  tagName?: string
  text?: string
  tokenHints?: string[]
}

export type ContextCommentTarget = {
  anchorBounds?: Rect
  bounds?: Rect
  elementKind?: NarratedTraceTarget['elementKind']
  frameId?: string
  hierarchy?: NarratedTraceTarget['hierarchy']
  kind: ContextCommentTargetKind
  label: string
  live?: ContextCommentLiveSelection
  path: string[]
  route?: string
  source?: ContextCommentOwner
  scope: NarratedTraceScope
  stableIds: string[]
}

export type ContextCommentDraft = {
  annotations: ContextCommentImageAnnotation[]
  capture: NarratedTraceEvidence | null
  captureContext: ContextCommentBoardCapture | null
  captureSource: ContextCommentCaptureSource | null
  destination?: ContextCommentDestination
  flow: ContextCommentFlow
  id: string
  target: ContextCommentTarget | null
  text: string
}

export type ContextCommentDispatchReceipt = {
  targetThreadId: string
}
