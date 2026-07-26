import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

export type NarratedTraceStatus = 'idle' | 'recording' | 'paused' | 'review'

export type NarratedTraceEventKind =
  | 'transcript'
  | 'selection'
  | 'edit'
  | 'ink'
  | 'shape'
  | 'screenshot'
  | 'sync'
  | 'viewport'
  | 'navigation'
  | 'tool'
  | 'undo'
  | 'redo'
  | 'note'

export const NARRATED_TRACE_ACTIVITY_KINDS = [
  'ink',
  'screenshot',
  'selection',
  'tool',
  'shape',
  'edit'
] as const

export type NarratedTraceActivityKind = (typeof NARRATED_TRACE_ACTIVITY_KINDS)[number]

export type NarratedTraceViewport = {
  panX: number
  panY: number
  zoom: number
}

/**
 * A durable deictic anchor in page space. `targetRelativePoint` is normalized
 * against the referenced target's bounds at capture time.
 */
export type NarratedTraceSpatialAnchor = {
  pagePoint: Vector
  pageRegion: Rect
  targetRelativePoint?: Vector
  viewport: NarratedTraceViewport
}

export type NarratedTraceScope = {
  documentId: string
  documentName?: string
  pageId: string
  pageName?: string
  workspaceId?: string
}

export type NarratedTraceTarget = {
  bounds?: Rect
  frameId?: string
  name: string
  path: string[]
  route?: string
  stableId: string
}

export type NarratedTraceChange = {
  after?: string
  before?: string
  property: string
}

export type NarratedTracePoint = {
  pressure?: number
  x: number
  y: number
}

export type NarratedTraceInk = {
  bounds: Rect
  color: string
  points: NarratedTracePoint[]
  strokeWidth: number
}

export type NarratedTraceEvidenceAnnotation =
  | ({ kind: 'focus' } & NarratedTraceInk)
  | ({ kind: 'ink' } & NarratedTraceInk)

export type NarratedTraceEvidenceOmission = {
  bounds: Rect
  reason: string
}

export type NarratedTraceEvidence = {
  annotation: NarratedTraceEvidenceAnnotation
  /** New captures bake the annotation into the PNG; legacy evidence is overlaid during review. */
  annotationBaked?: boolean
  cacheKey: string
  capturedAtMs: number
  cropBounds: Rect
  evidenceId: string
  height: number
  mimeType: 'image/png'
  omissions: NarratedTraceEvidenceOmission[]
  source: 'canvas' | 'frame-snapshot'
  targetPath?: string[]
  targetStableId?: string
  width: number
}

export type NarratedTraceEvent = {
  anchor?: NarratedTraceSpatialAnchor
  atMs: number
  changes?: NarratedTraceChange[]
  durationMs?: number
  evidence?: NarratedTraceEvidence
  evidenceStatus?: 'failed' | 'pending' | 'ready'
  groupedEventCount?: number
  groupedTargetCount?: number
  id: string
  kind: NarratedTraceEventKind
  label: string
  ink?: NarratedTraceInk
  target?: NarratedTraceTarget
  text?: string
  viewport?: NarratedTraceViewport
}

export type NarratedTraceEventInput = Omit<NarratedTraceEvent, 'atMs' | 'id'> & {
  atMs?: number
}

export type NarratedTraceAppendOptions = {
  coalesceKey?: string
  coalesceWindowMs?: number
  mergeText?: boolean
}

export type NarratedTraceContextEntry = {
  editedText?: string
  included: boolean
  note?: string
  removed: boolean
  sourceEventId: string
}

export type NarratedTraceRow = {
  context: NarratedTraceContextEntry
  event: NarratedTraceEvent
}

export type NarratedTraceSession = {
  contextDraft: NarratedTraceContextEntry[]
  durationMs: number
  events: NarratedTraceEvent[]
  id: string
  scope?: NarratedTraceScope
  startedAt: string
  title?: string
}
