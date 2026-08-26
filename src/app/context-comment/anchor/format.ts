import { compactContextCommentText } from '@/app/context-comment/text'
import type {
  ContextCommentAnnotationAnchor,
  ContextCommentAnnotationSelector
} from '@/app/context-comment/types'

function formatNumber(value: number) {
  return String(Math.round(value * 10) / 10)
}

function formatPercent(value: number) {
  return `${String(Math.round(value * 1_000) / 10)}%`
}

function formatTime(value: number) {
  const seconds = Math.max(0, Math.round(value))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`
}

function componentLabel(component: string) {
  return component
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function contextCommentAnnotationAnchorLabel(anchor: ContextCommentAnnotationAnchor) {
  const media = anchor.selectors.find((selector) => selector.kind === 'media-fragment')
  if (media?.kind === 'media-fragment') {
    const label = componentLabel(media.mediaKind)
    return media.timeSeconds === undefined ? label : `${label} · ${formatTime(media.timeSeconds)}`
  }
  const document = anchor.selectors.find((selector) => selector.kind === 'document-position')
  if (document?.kind === 'document-position') {
    if (document.page) return `${document.format.toUpperCase()} · page ${String(document.page)}`
    if (document.slide) return `${document.format.toUpperCase()} · slide ${String(document.slide)}`
    return document.format.toUpperCase()
  }
  const live = anchor.selectors.find((selector) => selector.kind === 'live-element')
  if (live?.kind === 'live-element') return `Live · ${live.text || live.role || live.stableId}`
  const dom = anchor.selectors.find((selector) => selector.kind === 'dom-element')
  if (dom?.kind === 'dom-element') return `Code · ${dom.name}`
  const diagram = anchor.selectors.find((selector) => selector.kind === 'diagram-element')
  if (diagram) return 'Diagram'
  const spatial = anchor.selectors.find((selector) => selector.kind === 'spatial-projection')
  if (spatial) return '3D · projected'
  const conversation = anchor.selectors.find((selector) => selector.kind === 'agent-conversation')
  if (conversation) return 'Agent conversation'
  const code = anchor.selectors.find((selector) => selector.kind === 'code-object')
  if (code?.kind === 'code-object') return `Code · ${componentLabel(code.component)}`
  return anchor.source.kind === 'board' ? 'Board' : anchor.source.label
}

type SelectorOf<Kind extends ContextCommentAnnotationSelector['kind']> = Extract<
  ContextCommentAnnotationSelector,
  { kind: Kind }
>

function mediaTimeLine(selector: SelectorOf<'media-fragment'>) {
  if (selector.timeSeconds === undefined) return ''
  let detail = `; t ${formatNumber(selector.timeSeconds)}s`
  if (selector.durationSeconds !== undefined) {
    detail += ` of ${formatNumber(selector.durationSeconds)}s`
  }
  if (selector.paused === true) detail += ' (paused)'
  if (selector.paused === false) detail += ' (playing at capture)'
  return detail
}

function mediaSpatialLine(selector: SelectorOf<'media-fragment'>) {
  if (!selector.spatial) return ''
  return `; xy ${formatPercent(selector.spatial.x)},${formatPercent(selector.spatial.y)} in ${selector.coordinateSpace} space`
}

function mediaSelectorLine(selector: SelectorOf<'media-fragment'>) {
  const file = selector.fileName ? ` "${compactContextCommentText(selector.fileName, 120)}"` : ''
  return `Media: ${selector.mediaKind}${file}${mediaTimeLine(selector)}${mediaSpatialLine(selector)}`
}

function documentSelectorLine(selector: SelectorOf<'document-position'>) {
  let line = `Document: ${selector.format}`
  if (selector.fileName) line += ` "${compactContextCommentText(selector.fileName, 120)}"`
  if (selector.page) line += `; page ${String(selector.page)}`
  if (selector.slide) line += `; slide ${String(selector.slide)}`
  if (selector.revision) line += `; revision ${String(selector.revision)}`
  return line
}

function codeObjectSelectorLine(selector: SelectorOf<'code-object'>) {
  let line = `Code Object: ${selector.component}; frame ${selector.frameId}; definition ${selector.definitionId}`
  if (selector.route) line += `; route ${selector.route}`
  if (selector.stateSummary) line += `; state ${selector.stateSummary}`
  return line
}

function domSelectorLine(selector: SelectorOf<'dom-element'>) {
  let line = `DOM target: ${selector.tagName}`
  if (selector.role) line += ` [role=${selector.role}]`
  line += `; selector ${selector.css || '(host)'}`
  if (selector.text) line += `; text "${compactContextCommentText(selector.text, 120)}"`
  return line
}

function liveSelectorLine(selector: SelectorOf<'live-element'>) {
  let line = `Live target: ${selector.stableId}`
  if (selector.tagName) line += ` <${selector.tagName}>`
  if (selector.role) line += ` [role=${selector.role}]`
  if (selector.text) line += `; text "${compactContextCommentText(selector.text, 120)}"`
  return line
}

function diagramSelectorLine(selector: SelectorOf<'diagram-element'>) {
  let line = `Diagram: ${selector.diagramId}; owner ${selector.ownerId}`
  if (selector.semanticId) line += `; semantic element ${selector.semanticId}`
  if (selector.revision !== undefined) line += `; revision ${String(selector.revision)}`
  return line
}

function spatialSelectorLine(selector: SelectorOf<'spatial-projection'>) {
  let line = `3D source: ${selector.format} "${compactContextCommentText(selector.fileName, 120)}"; projected screen/object point only (no raycast world hit)`
  if (selector.camera) {
    line += `; camera ${selector.camera.position.join(',')} -> ${selector.camera.target.join(',')}`
  }
  return line
}

function selectorLine(selector: ContextCommentAnnotationSelector) {
  switch (selector.kind) {
    case 'board-position':
      return `Board anchor: x ${formatNumber(selector.point.x)}, y ${formatNumber(selector.point.y)}; viewport pan ${formatNumber(selector.viewport.panX)},${formatNumber(selector.viewport.panY)} at ${formatNumber(selector.viewport.zoom)}×`
    case 'node-relative':
      return `Object anchor: x ${formatPercent(selector.normalizedPoint.x)}, y ${formatPercent(selector.normalizedPoint.y)} (local ${formatNumber(selector.localPoint.x)},${formatNumber(selector.localPoint.y)})`
    case 'media-fragment':
      return mediaSelectorLine(selector)
    case 'document-position':
      return documentSelectorLine(selector)
    case 'code-object':
      return codeObjectSelectorLine(selector)
    case 'dom-element':
      return domSelectorLine(selector)
    case 'live-element':
      return liveSelectorLine(selector)
    case 'diagram-element':
      return diagramSelectorLine(selector)
    case 'spatial-projection':
      return spatialSelectorLine(selector)
    case 'agent-conversation':
      return `Agent conversation: ${selector.conversationId}; frame ${selector.frameId}`
    default:
      throw new TypeError('Unknown context comment annotation selector.')
  }
}

export function contextCommentAnnotationAnchorLines(anchor: ContextCommentAnnotationAnchor) {
  const lines = [
    `Source: ${anchor.source.kind} "${compactContextCommentText(anchor.source.label, 120)}" (${anchor.source.id})${anchor.source.nodeType ? ` [${anchor.source.nodeType}]` : ''}`
  ]
  if (anchor.source.route) lines.push(`Route: ${anchor.source.route}`)
  if (anchor.source.path?.length) lines.push(`Path: ${anchor.source.path.join(' / ')}`)
  lines.push(...anchor.selectors.map(selectorLine))
  if (anchor.candidateTargets.length > 0) {
    lines.push(
      `Nearby candidates: ${anchor.candidateTargets.map((candidate) => `${candidate.label} (${candidate.id})`).join(', ')}`
    )
  }
  lines.push(`Captured at: ${new Date(anchor.capturedAtEpochMs).toISOString()}`)
  return lines
}
