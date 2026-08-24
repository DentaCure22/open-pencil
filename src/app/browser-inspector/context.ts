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

export function browserElementAgentContext(selection: BrowserElementSelection) {
  const { element, page } = selection
  const bounds = `${String(Math.round(element.bounds.width))}×${String(Math.round(element.bounds.height))} at ${String(Math.round(element.bounds.x))},${String(Math.round(element.bounds.y))}`
  const attributes = Object.entries(element.attributes)
    .slice(0, 12)
    .map(([name, value]) => `${name}=${JSON.stringify(compact(value, 160))}`)
    .join(' ')
  return [
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
            `Annotation ${String(index + 1)} at ${String(Math.round(annotation.x * 100))}%,${String(Math.round(annotation.y * 100))}%: ${compact(annotation.comment, 1_000)}`
          ]
        : []
    ) ?? []),
    `Captured: ${selection.capturedAt}`
  ].join('\n')
}

export function browserCaptureSessionAgentContext(session: BrowserCaptureSession) {
  const pages = session.pages?.length ? session.pages : [session.page]
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
    `Captured selections: ${String(session.selections.length)}`,
    `Motion recordings: ${String(session.recordings.length)}`
  ]
  const selections = session.selections.map(
    (selection, index) =>
      `\nSelection ${String(index + 1)} of ${String(session.selections.length)}\n${browserElementAgentContext(selection)}`
  )
  const recordings = session.recordings.map(
    (recording, index) =>
      `Motion recording ${String(index + 1)}: ${String(Math.round(recording.durationMs / 1_000))}s${recording.attachment?.path ? ` · ${recording.attachment.path}` : ' · durable upload pending'}`
  )
  return [...summary, ...selections, ...recordings].join('\n')
}

function snapshotExtension(dataUrl: string) {
  if (dataUrl.startsWith('data:image/png')) return 'png'
  if (dataUrl.startsWith('data:image/webp')) return 'webp'
  return 'jpg'
}

export async function browserElementSnapshotFile(selection: BrowserElementSelection) {
  const response = await fetch(selection.snapshot.dataUrl)
  const blob = await response.blob()
  return new File(
    [blob],
    `chrome-selection-${selection.id}.${snapshotExtension(selection.snapshot.dataUrl)}`,
    { lastModified: Date.parse(selection.capturedAt), type: blob.type }
  )
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
