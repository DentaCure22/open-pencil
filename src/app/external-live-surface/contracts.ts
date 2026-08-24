import type { BrowserElementSelection } from '@/app/browser-inspector/contracts'
import { IS_BROWSER } from '@/constants'

export const EXTERNAL_LIVE_SURFACE_SCHEMA_VERSION = 1 as const
export const BROWSER_LIVE_SURFACE_INPUT_CONTRACT = 'openpencil-browser-live-surface-input/v1'

export type ExternalLiveSurfaceWindow = {
  devicePixelRatio: number
  innerHeight: number
  innerWidth: number
  outerHeight: number
  outerWidth: number
  screenX: number
  screenY: number
}

export type ExternalLiveSurfaceSource = {
  captureSessionId: string
  element: BrowserElementSelection['element']
  frameId: number
  kind: 'chrome-element'
  page: BrowserElementSelection['page']
  schemaVersion: typeof EXTERNAL_LIVE_SURFACE_SCHEMA_VERSION
  selectionId: string
  tabId: number
  window?: ExternalLiveSurfaceWindow
}

export type ExternalLiveSurfacePreview = BrowserElementSelection['snapshot']

export type BrowserLiveSurfaceInput =
  | {
      button: number
      buttons: number
      kind: 'pointer'
      phase: 'down' | 'move' | 'up'
      xRatio: number
      yRatio: number
    }
  | {
      altKey: boolean
      ctrlKey: boolean
      deltaX: number
      deltaY: number
      kind: 'wheel'
      metaKey: boolean
      shiftKey: boolean
      xRatio: number
      yRatio: number
    }
  | {
      altKey: boolean
      code: string
      ctrlKey: boolean
      key: string
      kind: 'key'
      metaKey: boolean
      phase: 'down' | 'up'
      shiftKey: boolean
    }
  | { kind: 'text'; text: string }

export type BrowserLiveSurfaceInputCommand = {
  command: {
    input: BrowserLiveSurfaceInput
    kind: 'relay-live-surface-input'
    source: ExternalLiveSurfaceSource
  }
  contract: 'openpencil-browser-element-command/v1'
  requestId: string
}

type UnknownRecord = Record<string, unknown>

function objectRecord(value: unknown): UnknownRecord | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return undefined
  }
  return value as UnknownRecord
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && globalThis.Number.isFinite(value)
}

function boundedString(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string') return false
  return value.length > 0 && value.length <= maximum
}

function validWindow(value: unknown): value is ExternalLiveSurfaceWindow {
  const candidate = objectRecord(value)
  return Boolean(
    candidate &&
    finite(candidate.screenX) &&
    finite(candidate.screenY) &&
    finite(candidate.outerWidth) &&
    candidate.outerWidth > 0 &&
    finite(candidate.outerHeight) &&
    candidate.outerHeight > 0 &&
    finite(candidate.innerWidth) &&
    candidate.innerWidth > 0 &&
    finite(candidate.innerHeight) &&
    candidate.innerHeight > 0 &&
    finite(candidate.devicePixelRatio) &&
    candidate.devicePixelRatio > 0
  )
}

function validPage(value: unknown): value is BrowserElementSelection['page'] {
  const candidate = objectRecord(value)
  return Boolean(
    candidate &&
    boundedString(candidate.origin, 512) &&
    boundedString(candidate.title, 500) &&
    boundedString(candidate.url, 4_096)
  )
}

function validElement(value: unknown): value is BrowserElementSelection['element'] {
  const candidate = objectRecord(value)
  const bounds = objectRecord(candidate?.bounds)
  return Boolean(
    candidate &&
    bounds &&
    boundedString(candidate.selector, 1_024) &&
    boundedString(candidate.tag, 80) &&
    typeof candidate.accessibleName === 'string' &&
    typeof candidate.role === 'string' &&
    typeof candidate.text === 'string' &&
    Array.isArray(candidate.classes) &&
    objectRecord(candidate.attributes) &&
    finite(bounds.x) &&
    finite(bounds.y) &&
    finite(bounds.width) &&
    bounds.width > 0 &&
    finite(bounds.height) &&
    bounds.height > 0
  )
}

export function parseExternalLiveSurfaceSource(value: unknown): ExternalLiveSurfaceSource | null {
  const candidate = objectRecord(value)
  if (
    !candidate ||
    candidate.schemaVersion !== EXTERNAL_LIVE_SURFACE_SCHEMA_VERSION ||
    candidate.kind !== 'chrome-element' ||
    !boundedString(candidate.captureSessionId, 128) ||
    !boundedString(candidate.selectionId, 128) ||
    !Number.isSafeInteger(candidate.tabId) ||
    !Number.isSafeInteger(candidate.frameId) ||
    !validPage(candidate.page) ||
    !validElement(candidate.element) ||
    (candidate.window !== undefined && !validWindow(candidate.window))
  ) {
    return null
  }
  return structuredClone(value) as ExternalLiveSurfaceSource
}

export function parseExternalLiveSurfacePreview(value: unknown): ExternalLiveSurfacePreview | null {
  const candidate = objectRecord(value)
  if (
    !candidate ||
    !boundedString(candidate.dataUrl, 2_000_000) ||
    !candidate.dataUrl.startsWith('data:image/') ||
    !finite(candidate.width) ||
    candidate.width <= 0 ||
    !finite(candidate.height) ||
    candidate.height <= 0
  ) {
    return null
  }
  return structuredClone(value) as ExternalLiveSurfacePreview
}

export function externalLiveSurfaceSourceFromSelection(
  selection: BrowserElementSelection
): ExternalLiveSurfaceSource {
  return {
    captureSessionId:
      selection.session.captureSessionId ??
      `legacy-${String(selection.session.tabId)}-${selection.id}`,
    element: {
      ...selection.element,
      attributes: { ...selection.element.attributes },
      bounds: { ...selection.element.bounds },
      classes: [...selection.element.classes]
    },
    frameId: selection.session.frameId,
    kind: 'chrome-element',
    page: { ...selection.page },
    schemaVersion: EXTERNAL_LIVE_SURFACE_SCHEMA_VERSION,
    selectionId: selection.id,
    tabId: selection.session.tabId,
    ...(selection.sourceWindow ? { window: { ...selection.sourceWindow } } : {})
  }
}

export function externalLiveSurfaceCaptureGeometry(source: ExternalLiveSurfaceSource) {
  const sourceWindow = source.window
  if (!sourceWindow) return null
  const sideInset = Math.max(0, (sourceWindow.outerWidth - sourceWindow.innerWidth) / 2)
  const topInset = Math.max(0, sourceWindow.outerHeight - sourceWindow.innerHeight - sideInset)
  return {
    region: {
      height: source.element.bounds.height,
      width: source.element.bounds.width,
      x: sideInset + source.element.bounds.x,
      y: topInset + source.element.bounds.y
    },
    sourceWindow: {
      height: sourceWindow.outerHeight,
      width: sourceWindow.outerWidth,
      x: sourceWindow.screenX,
      y: sourceWindow.screenY
    }
  }
}

export function postBrowserLiveSurfaceInput(
  source: ExternalLiveSurfaceSource,
  input: BrowserLiveSurfaceInput
) {
  if (!IS_BROWSER) return false
  const command: BrowserLiveSurfaceInputCommand = {
    command: {
      input,
      kind: 'relay-live-surface-input',
      source: structuredClone(source)
    },
    contract: 'openpencil-browser-element-command/v1',
    requestId: crypto.randomUUID()
  }
  document.documentElement.setAttribute(
    'data-openpencil-browser-element-command',
    JSON.stringify(command)
  )
  return true
}
