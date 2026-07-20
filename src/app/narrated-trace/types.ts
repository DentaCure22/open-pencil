import type { Rect } from '@open-pencil/scene-graph/primitives'

export type NarratedTraceStatus = 'idle' | 'recording' | 'paused' | 'review'
export type NarratedTraceViewMode = 'history' | 'timeline'

export type NarratedTraceEventKind =
  | 'transcript'
  | 'selection'
  | 'edit'
  | 'ink'
  | 'shape'
  | 'screenshot'
  | 'viewport'
  | 'navigation'
  | 'tool'
  | 'undo'
  | 'redo'
  | 'note'

export type NarratedTraceViewport = {
  panX: number
  panY: number
  zoom: number
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
  cacheKey: string
  capturedAtMs: number
  cropBounds: Rect
  evidenceId: string
  height: number
  mimeType: 'image/png'
  omissions: NarratedTraceEvidenceOmission[]
  source: 'canvas' | 'live-frame'
  targetPath?: string[]
  targetStableId?: string
  width: number
}

export type NarratedTraceEvent = {
  atMs: number
  changes?: NarratedTraceChange[]
  durationMs?: number
  evidence?: NarratedTraceEvidence
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
  startedAt: string
  title?: string
}
