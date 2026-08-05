import { parse } from 'culori'

import type { ObjectGraphConnection, SceneGraph } from '@open-pencil/scene-graph'

import type { ObjectGraphPortAnchor } from '@/app/object-graph/projection'
import { resolveObjectGraphConnectionGeometry } from '@/app/object-graph/react-flow'

export type ConnectionVisualProof = {
  connection_id: string
  expected_path: string
  path_visible: boolean
  reasons: string[]
  rendered_path?: string
  source_anchor: ObjectGraphPortAnchor
  status: 'headless_unavailable' | 'missing' | 'rendered'
  target_anchor: ObjectGraphPortAnchor
}

const MAX_PRESENTATION_ATTEMPTS = 3
const PRESENTATION_FRAME_TIMEOUT_MS = 45

function hasPresentationDocument(): boolean {
  const value: unknown = Reflect.get(globalThis, 'document')
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof Reflect.get(value, 'querySelectorAll') === 'function'
  )
}

function nextPresentationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve()
  let frameId: number | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const frame = new Promise<'frame'>((resolve) => {
    frameId = requestAnimationFrame(() => resolve('frame'))
  })
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), PRESENTATION_FRAME_TIMEOUT_MS)
  })
  return Promise.race([frame, timeout]).then((source) => {
    if (source === 'timeout' && frameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameId)
    }
    if (source === 'frame' && timeoutId !== null) clearTimeout(timeoutId)
    return undefined
  })
}

function connectionElement(connectionId: string): Element | null {
  if (!hasPresentationDocument()) return null
  return (
    [...document.querySelectorAll('.react-flow__edge[data-id]')].find(
      (candidate) => candidate.getAttribute('data-id') === connectionId
    ) ?? null
  )
}

function isVisibleElement(element: Element | null): boolean {
  if (!element?.isConnected) return false
  let current: Element | null = element
  while (current) {
    const style = document.defaultView?.getComputedStyle(current)
    if (style) {
      const opacity = Number.parseFloat(style.opacity)
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        (Number.isFinite(opacity) && opacity <= 0)
      ) {
        return false
      }
    }
    current = current.parentElement
  }
  return true
}

function hasVisiblePaint(value: string, paintOpacity: string): boolean {
  const color = parse(value)
  const alpha = color?.alpha ?? 1
  const opacity = Number.parseFloat(paintOpacity)
  return Boolean(color) && alpha > 0 && (!Number.isFinite(opacity) || opacity > 0)
}

function pathHasLength(path: Element): boolean {
  const candidate = path as Element & { getTotalLength?: () => number }
  if (typeof candidate.getTotalLength !== 'function') return false
  try {
    return candidate.getTotalLength() > 0
  } catch {
    return false
  }
}

function visiblePath(path: Element | null): boolean {
  if (!path || !isVisibleElement(path) || path.tagName.toLowerCase() !== 'path') return false
  const style = document.defaultView?.getComputedStyle(path)
  if (!style) return false
  return pathHasLength(path) && hasVisiblePaint(style.stroke, style.strokeOpacity)
    ? Number.parseFloat(style.strokeWidth) > 0
    : false
}

function normalizedGeometry(value: string | null | undefined): string {
  return value?.trim().replace(/[\s,]+/gu, ' ') ?? ''
}

function renderedConnectionProof(
  connection: ObjectGraphConnection,
  expectedPath: string,
  sourceAnchor: ObjectGraphPortAnchor,
  targetAnchor: ObjectGraphPortAnchor
): ConnectionVisualProof | null {
  const edge = connectionElement(connection.id)
  if (!edge) return null
  const path = edge.querySelector('.react-flow__edge-path')
  const renderedPath = path?.getAttribute('d') ?? undefined
  const pathGeometryMatches = normalizedGeometry(renderedPath) === normalizedGeometry(expectedPath)
  const pathVisible = visiblePath(path) && pathGeometryMatches
  const reasons = [
    ...(pathGeometryMatches ? [] : ['path_geometry_mismatch']),
    ...(pathVisible ? [] : ['path_not_visible'])
  ]
  return {
    connection_id: connection.id,
    expected_path: expectedPath,
    path_visible: pathVisible,
    reasons,
    ...(renderedPath ? { rendered_path: renderedPath } : {}),
    source_anchor: sourceAnchor,
    status: reasons.length === 0 ? 'rendered' : 'missing',
    target_anchor: targetAnchor
  }
}

export async function waitForConnectionVisualProof(
  graph: SceneGraph,
  pageId: string,
  connection: ObjectGraphConnection
): Promise<ConnectionVisualProof> {
  const {
    geometry,
    sourceAnchor: source,
    targetAnchor: target
  } = resolveObjectGraphConnectionGeometry(graph, pageId, connection)
  if (!hasPresentationDocument()) {
    return {
      connection_id: connection.id,
      expected_path: geometry.path,
      path_visible: false,
      reasons: ['browser_presentation_unavailable'],
      source_anchor: source,
      status: 'headless_unavailable',
      target_anchor: target
    }
  }

  for (let attempt = 0; attempt < MAX_PRESENTATION_ATTEMPTS; attempt += 1) {
    const proof = renderedConnectionProof(connection, geometry.path, source, target)
    if (proof?.status === 'rendered') return proof
    if (attempt < MAX_PRESENTATION_ATTEMPTS - 1) await nextPresentationFrame()
  }

  return (
    renderedConnectionProof(connection, geometry.path, source, target) ?? {
      connection_id: connection.id,
      expected_path: geometry.path,
      path_visible: false,
      reasons: ['edge_not_mounted'],
      source_anchor: source,
      status: 'missing',
      target_anchor: target
    }
  )
}
