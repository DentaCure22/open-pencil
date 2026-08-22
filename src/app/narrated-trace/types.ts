import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

export type NarratedTraceStatus = 'idle' | 'recording' | 'review'

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
  elementKind?: 'component' | 'container' | 'control'
  frameId?: string
  hierarchy?: {
    children: Array<{ label: string; stableId: string }>
    current: { label: string; stableId: string }
    parent?: { label: string; stableId: string }
  }
  name: string
  path: string[]
  route?: string
  source?: {
    componentName?: string
    filePath?: string
    lineNumber?: number
  }
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

export type NarratedTraceGestureRelation = 'contained' | 'contains-region' | 'intersecting'

export type NarratedTraceGestureCandidate = {
  bounds: Rect
  depth: number
  name: string
  nodeType: SceneNode['type']
  objectCoverageRatio: number
  /** Stable top-level object owned directly by the captured page. */
  ownerId?: string
  path: string[]
  regionCoverageRatio: number
  relation: NarratedTraceGestureRelation
  route?: string
  stableId: string
}

export type NarratedTraceGesture = {
  candidateCount: number
  candidates: NarratedTraceGestureCandidate[]
  candidatesTruncated: boolean
  /** Exact runtime tab observed at capture; revalidate before use. */
  documentTabId?: string
  kind: 'focus' | 'ink'
  pagePoints: Vector[]
  primaryTargetId?: string
  /** Exact app runtime observed at capture; revalidate before use. */
  runtimeInstanceId?: string
  screenBounds: Rect
  screenPoints: NarratedTracePoint[]
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
  /** Captures bake the annotation into the PNG. */
  annotationBaked?: boolean
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
  gesture?: NarratedTraceGesture
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
