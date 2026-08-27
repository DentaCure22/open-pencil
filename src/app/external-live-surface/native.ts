import { isTauri } from '@/app/tauri/env'

import { externalLiveSurfaceCaptureGeometry, type ExternalLiveSurfaceSource } from './contracts'

type CaptureEvent =
  | { dataUrl: string; kind: 'frame'; sequence: number; sessionId: string }
  | { kind: 'ended'; sessionId: string }

type BrowserCaptureEvent =
  | {
      contract: string
      dataUrl: string
      kind: 'live-surface-frame'
      sequence: number
      sessionId: string
    }
  | {
      contract: string
      kind: 'live-surface-ended'
      sessionId: string
    }

type BrowserCaptureResult = {
  contract: string
  ok: boolean
  reason?: string
  requestId: string
}

const BROWSER_COMMAND_PAYLOAD_ATTRIBUTE = 'data-openpencil-browser-element-command'

export type ExternalLiveSurfaceCaptureStatus =
  | { kind: 'ended' }
  | { dataUrl: string; kind: 'frame'; sequence: number }

function browserCaptureCommand(
  kind: 'start-live-surface-capture' | 'stop-live-surface-capture',
  sessionId: string,
  source: ExternalLiveSurfaceSource
) {
  const requestId = crypto.randomUUID()
  document.documentElement.setAttribute(
    BROWSER_COMMAND_PAYLOAD_ATTRIBUTE,
    JSON.stringify({
      command: { kind, sessionId, source: structuredClone(source) },
      contract: 'openpencil-browser-element-command/v1',
      requestId
    })
  )
  return requestId
}

async function startBrowserCapture(
  sessionId: string,
  source: ExternalLiveSurfaceSource,
  onStatus: (status: ExternalLiveSurfaceCaptureStatus) => void
) {
  let active = true
  const started = new Promise<boolean>((resolve) => {
    const requestId = browserCaptureCommand('start-live-surface-capture', sessionId, source)
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', receiveResult)
      console.warn('OpenPencil browser live surface timed out waiting for the Chrome extension')
      resolve(false)
    }, 2_500)
    function receiveResult(event: MessageEvent<BrowserCaptureResult>) {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (
        data.contract !== 'openpencil-browser-element-command-result/v1' ||
        data.requestId !== requestId
      )
        return
      window.clearTimeout(timeout)
      window.removeEventListener('message', receiveResult)
      if (!data.ok) {
        console.warn(
          `OpenPencil browser live surface could not start: ${data.reason ?? 'unknown reason'}`
        )
      }
      resolve(data.ok)
    }
    window.addEventListener('message', receiveResult)
  })
  function receiveFrame(event: MessageEvent<BrowserCaptureEvent>) {
    if (
      !active ||
      event.origin !== window.location.origin ||
      event.data.contract !== 'openpencil-browser-element/v1' ||
      event.data.sessionId !== sessionId
    ) {
      return
    }
    if (event.data.kind === 'live-surface-frame') {
      onStatus({ dataUrl: event.data.dataUrl, kind: 'frame', sequence: event.data.sequence })
    } else {
      onStatus({ kind: 'ended' })
    }
  }
  window.addEventListener('message', receiveFrame)
  if (!(await started)) {
    active = false
    window.removeEventListener('message', receiveFrame)
    return null
  }
  return async () => {
    active = false
    window.removeEventListener('message', receiveFrame)
    browserCaptureCommand('stop-live-surface-capture', sessionId, source)
  }
}

export async function startExternalLiveSurfaceCapture(
  frameId: string,
  source: ExternalLiveSurfaceSource,
  onStatus: (status: ExternalLiveSurfaceCaptureStatus) => void
) {
  const geometry = externalLiveSurfaceCaptureGeometry(source)
  if (!isTauri()) {
    return startBrowserCapture(`${frameId}-${crypto.randomUUID()}`, source, onStatus)
  }
  if (!geometry) return null
  const { Channel, invoke } = await import('@tauri-apps/api/core')
  const sessionId = `${frameId}-${crypto.randomUUID()}`
  const channel = new Channel<CaptureEvent>((event) => {
    if (event.sessionId !== sessionId) return
    if (event.kind === 'frame') {
      onStatus({ dataUrl: event.dataUrl, kind: 'frame', sequence: event.sequence })
    } else {
      onStatus({ kind: 'ended' })
    }
  })
  await invoke('start_external_live_surface_capture', {
    onEvent: channel,
    request: {
      framesPerSecond: 30,
      ...geometry,
      sessionId,
      sourceTitle: source.page.title
    }
  })
  return async () => {
    await invoke('stop_external_live_surface_capture', { sessionId }).catch(() => false)
  }
}
