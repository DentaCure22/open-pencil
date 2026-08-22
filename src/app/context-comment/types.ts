import type { Rect } from '@open-pencil/scene-graph/primitives'

import type {
  NarratedTraceEvidence,
  NarratedTraceScope,
  NarratedTraceTarget
} from '@/app/narrated-trace'

export type ContextCommentTargetKind = 'board' | 'live-container' | 'selection'

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
  capture: NarratedTraceEvidence | null
  id: string
  target: ContextCommentTarget
  text: string
}

export type ContextCommentDispatchReceipt = {
  targetThreadId: string
}
