import { canvasPngBlob } from '@/app/media-evidence/raster'
import type { NarratedTraceTarget } from '@/app/narrated-trace'

import type { BrowserElementSelection } from './contracts'
import type { BrowserCaptureSession } from './state'

function compact(value: string, limit: number) {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`
}

export function browserElementLabel(selection: BrowserElementSelection) {
  return (
    compact(selection.element.accessibleName, 160) ||
    compact(selection.element.text, 160) ||
    selection.element.tag
  )
}

export function compactBrowserElementTitle(label: string) {
  const normalized = label.replaceAll(/\s+/g, ' ').trim()
  if (normalized.length <= 38) return normalized

  const fourWordPrefix = normalized.split(' ').slice(0, 4).join(' ')
  if (fourWordPrefix.length <= 38) return `${fourWordPrefix}…`

  const bounded = fourWordPrefix.slice(0, 38)
  const lastWordBoundary = bounded.lastIndexOf(' ')
  return `${(lastWordBoundary >= 16 ? bounded.slice(0, lastWordBoundary) : bounded).trimEnd()}…`
}

export function browserElementTraceTarget(selection: BrowserElementSelection): NarratedTraceTarget {
  const { element, page } = selection
  const captureSessionId = selection.session.captureSessionId ?? 'legacy'
  return {
    elementKind: ['button', 'input', 'select', 'textarea', 'a'].includes(element.tag)
      ? 'control'
      : 'container',
    name: browserElementLabel(selection),
    path: [page.title || page.origin, element.selector || element.tag],
    route: page.url,
    stableId: `browser:${captureSessionId}:${selection.id}`
  }
}

function validAnnotationSequence(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined
}

function annotationReference(sequence: number) {
  return `Annotation #${String(sequence)}`
}

export function browserElementAgentContext(
  selection: BrowserElementSelection,
  fallbackSequence = 1
) {
  const { element, page } = selection
  const sequence = validAnnotationSequence(selection.session.sequence) ?? fallbackSequence
  const bounds = `${String(Math.round(element.bounds.width))}×${String(Math.round(element.bounds.height))} at ${String(Math.round(element.bounds.x))},${String(Math.round(element.bounds.y))}`
  const attributes = Object.entries(element.attributes)
    .slice(0, 12)
    .map(([name, value]) => `${name}=${JSON.stringify(compact(value, 160))}`)
    .join(' ')
  return [
    `Reference: ${annotationReference(sequence)}`,
    'Chrome DOM selection:',
    `Page: ${compact(page.title || page.origin, 300)}`,
    `URL: ${page.url}`,
    `Element: <${element.tag}> ${browserElementLabel(selection)}`,
    ...(element.role ? [`Role: ${element.role}`] : []),
    ...(element.selector ? [`Selector: ${element.selector}`] : []),
    `Viewport bounds at capture: ${bounds}`,
    ...(attributes ? [`Attributes: ${attributes}`] : []),
    ...(element.classes.length ? [`Classes: ${element.classes.join(' ')}`] : []),
    ...(element.text ? [`Visible text: ${compact(element.text, 1_000)}`] : []),
    ...(selection.annotations?.flatMap((annotation, index) =>
      annotation.comment.trim()
        ? [
            `Comment ${String(index + 1)} at ${String(Math.round(annotation.x * 100))}%,${String(Math.round(annotation.y * 100))}%: ${compact(annotation.comment, 1_000)}`
          ]
        : []
    ) ?? []),
    `Captured: ${selection.capturedAt}`
  ].join('\n')
}

export function browserCaptureSessionAgentContext(session: BrowserCaptureSession) {
  const pages = session.pages?.length ? session.pages : [session.page]
  const selections = session.selections
    .map((selection, index) => ({
      selection,
      sequence: validAnnotationSequence(selection.session.sequence) ?? index + 1
    }))
    .sort((left, right) => left.sequence - right.sequence)
  const summary = [
    `Chrome capture session: ${session.title}`,
    `Session ID: ${session.id}`,
    `Tabs captured: ${String(pages.length)}`,
    ...pages.flatMap((page, index) => [
      `Tab ${String(index + 1)}: ${compact(page.title || page.origin, 300)}`,
      `Tab ${String(index + 1)} URL: ${page.url}`
    ]),
    `Started: ${session.startedAt}`,
    ...(session.endedAt ? [`Ended: ${session.endedAt}`] : []),
    ...(session.traceSessionId ? [`Trace session: ${session.traceSessionId}`] : []),
    ...(session.traceTag ? [`Trace tag: #${session.traceTag}`] : []),
    `Captured selections: ${String(session.selections.length)}`,
    ...(selections.length
      ? [
          `Stable references: ${selections.map(({ sequence }) => annotationReference(sequence)).join(', ')}`,
          'Reference rule: a bare number, “#N”, or “annotation N” means the matching Annotation #N in this capture session.'
        ]
      : []),
    `Motion recordings: ${String(session.recordings.length)}`
  ]
  const selectionContexts = selections.map(
    ({ selection, sequence }) => `\n${browserElementAgentContext(selection, sequence)}`
  )
  const recordings = session.recordings.map(
    (recording, index) =>
      `Motion recording ${String(index + 1)}: ${String(Math.round(recording.durationMs / 1_000))}s${recording.attachment?.path ? ` · ${recording.attachment.path}` : ' · durable upload pending'}`
  )
  return [...summary, ...selectionContexts, ...recordings].join('\n')
}

function snapshotExtension(dataUrl: string) {
  if (dataUrl.startsWith('data:image/png')) return 'png'
  if (dataUrl.startsWith('data:image/webp')) return 'webp'
  return 'jpg'
}

function loadSnapshotImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener('error', () => reject(new Error('Chrome capture image unavailable')), {
      once: true
    })
    image.src = dataUrl
  })
}

function fittedCanvasText(context: CanvasRenderingContext2D, value: string, maximumWidth: number) {
  const suffix = '…'
  let fitted = value.trim()
  while (fitted && context.measureText(`${fitted}${suffix}`).width > maximumWidth) {
    fitted = fitted.slice(0, -1).trimEnd()
  }
  return fitted ? `${fitted}${suffix}` : suffix
}

function wrappedCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  maximumWidth: number,
  maximumLines = 3
) {
  const words = compact(value, 600).split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ''
    const next = current ? `${current} ${word}` : word
    if (!current || context.measureText(next).width <= maximumWidth) {
      current = next
      continue
    }
    lines.push(current)
    current = word
    if (lines.length === maximumLines - 1) {
      const remainder = [current, ...words.slice(index + 1)].join(' ')
      lines.push(
        context.measureText(remainder).width <= maximumWidth
          ? remainder
          : fittedCanvasText(context, remainder, maximumWidth)
      )
      return lines
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, maximumLines)
}

async function annotatedSnapshotBlob(selection: BrowserElementSelection): Promise<Blob | null> {
  const annotations = selection.annotations ?? []
  if (!annotations.length || typeof document === 'undefined' || typeof Image === 'undefined') {
    return null
  }
  const image = await loadSnapshotImage(selection.snapshot.dataUrl)
  const width = Math.max(1, Math.round(selection.snapshot.width))
  const imageHeight = Math.max(1, Math.round(selection.snapshot.height))
  const fontSize = Math.max(13, Math.min(18, Math.round(width / 46)))
  const lineHeight = fontSize + 5
  const legendMarkerRadius = Math.max(9, Math.round(fontSize * 0.68))
  const legendPadding = Math.max(12, Math.round(fontSize * 0.85))
  const textStart = legendPadding + legendMarkerRadius * 2 + 10
  const maximumTextWidth = Math.max(40, width - textStart - legendPadding)
  const comments = annotations
    .map((annotation, index) => ({ annotation, index }))
    .filter(({ annotation }) => annotation.comment.trim())
  const visibleComments = comments.slice(0, 12)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = imageHeight
  const measuringContext = canvas.getContext('2d')
  if (!measuringContext) return null
  measuringContext.font = `500 ${String(fontSize)}px system-ui, sans-serif`
  const commentRows = visibleComments.map(({ annotation, index }) => {
    const lines = wrappedCanvasText(measuringContext, annotation.comment, maximumTextWidth)
    return {
      height: Math.max(legendMarkerRadius * 2, lines.length * lineHeight) + legendPadding,
      index,
      lines
    }
  })
  const omittedComments = Math.max(0, comments.length - visibleComments.length)
  const omittedHeight = omittedComments ? lineHeight + legendPadding : 0
  const legendHeight = commentRows.length
    ? legendPadding + commentRows.reduce((total, row) => total + row.height, 0) + omittedHeight
    : 0
  canvas.height = imageHeight + legendHeight
  const renderContext = canvas.getContext('2d')
  if (!renderContext) return null
  renderContext.drawImage(image, 0, 0, width, imageHeight)

  const markerRadius = Math.max(11, Math.min(22, Math.round(Math.min(width, imageHeight) * 0.05)))
  renderContext.font = `700 ${String(Math.max(11, Math.round(markerRadius * 0.85)))}px system-ui, sans-serif`
  renderContext.textAlign = 'center'
  renderContext.textBaseline = 'middle'
  for (const [index, annotation] of annotations.entries()) {
    const x = Math.min(width - markerRadius - 2, Math.max(markerRadius + 2, annotation.x * width))
    const y = Math.min(
      imageHeight - markerRadius - 2,
      Math.max(markerRadius + 2, annotation.y * imageHeight)
    )
    renderContext.beginPath()
    renderContext.arc(x, y, markerRadius, 0, Math.PI * 2)
    renderContext.fillStyle = '#2563eb'
    renderContext.fill()
    renderContext.lineWidth = Math.max(2, Math.round(markerRadius * 0.14))
    renderContext.strokeStyle = '#ffffff'
    renderContext.stroke()
    renderContext.fillStyle = '#ffffff'
    renderContext.fillText(String(index + 1), x, y + 0.5)
  }

  if (legendHeight) {
    renderContext.fillStyle = '#f8fafc'
    renderContext.fillRect(0, imageHeight, width, legendHeight)
    renderContext.fillStyle = '#cbd5e1'
    renderContext.fillRect(0, imageHeight, width, 1)
    let rowTop = imageHeight + legendPadding
    for (const row of commentRows) {
      const markerX = legendPadding + legendMarkerRadius
      const markerY = rowTop + legendMarkerRadius
      renderContext.beginPath()
      renderContext.arc(markerX, markerY, legendMarkerRadius, 0, Math.PI * 2)
      renderContext.fillStyle = '#2563eb'
      renderContext.fill()
      renderContext.font = `700 ${String(Math.max(10, fontSize - 2))}px system-ui, sans-serif`
      renderContext.fillStyle = '#ffffff'
      renderContext.textAlign = 'center'
      renderContext.textBaseline = 'middle'
      renderContext.fillText(String(row.index + 1), markerX, markerY + 0.5)
      renderContext.font = `500 ${String(fontSize)}px system-ui, sans-serif`
      renderContext.fillStyle = '#0f172a'
      renderContext.textAlign = 'left'
      renderContext.textBaseline = 'alphabetic'
      for (const [lineIndex, line] of row.lines.entries()) {
        renderContext.fillText(line, textStart, rowTop + fontSize + lineIndex * lineHeight)
      }
      rowTop += row.height
    }
    if (omittedComments) {
      renderContext.font = `500 ${String(fontSize - 1)}px system-ui, sans-serif`
      renderContext.fillStyle = '#475569'
      renderContext.fillText(
        `${String(omittedComments)} more note${omittedComments === 1 ? '' : 's'} in session context`,
        legendPadding,
        rowTop + fontSize
      )
    }
  }
  return canvasPngBlob(canvas)
}

export async function browserElementSnapshotFile(selection: BrowserElementSelection) {
  const response = await fetch(selection.snapshot.dataUrl)
  const sourceBlob = await response.blob()
  const annotatedBlob = await annotatedSnapshotBlob(selection).catch(() => null)
  const blob = annotatedBlob ?? sourceBlob
  const extension = annotatedBlob ? 'png' : snapshotExtension(selection.snapshot.dataUrl)
  const suffix = annotatedBlob ? '-annotated' : ''
  return new File([blob], `chrome-selection-${selection.id}${suffix}.${extension}`, {
    lastModified: Date.parse(selection.capturedAt),
    type: blob.type
  })
}

export async function browserCaptureSessionSnapshotFiles(session: BrowserCaptureSession) {
  const files = await Promise.all(
    session.selections.map((selection) => browserElementSnapshotFile(selection).catch(() => null))
  )
  return files.filter((file): file is File => file !== null)
}

export async function browserCaptureRecordingFile(
  recording: BrowserCaptureSession['recordings'][number]
) {
  const response = await fetch(recording.dataUrl)
  const blob = await response.blob()
  return new File([blob], `chrome-motion-${recording.id}.webm`, {
    lastModified: Date.parse(recording.endedAt),
    type: recording.mimeType
  })
}
