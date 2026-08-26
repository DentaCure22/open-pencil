import { IS_BROWSER } from '@/constants'

import { parseBrowserElementEvent } from './contracts'
import {
  beginBrowserCaptureTrace,
  commitBrowserCaptureRecording,
  commitBrowserElementSelection,
  finishBrowserCaptureTrace
} from './selection'
import {
  failBrowserCaptureRecording,
  finishBrowserElementPicker,
  browserInspectorState,
  removeBrowserElementSelection,
  requestBrowserElementAnnotation,
  startBrowserCaptureRecording,
  startBrowserCaptureSession,
  updateBrowserElementAnnotations
} from './state'

let releaseBridge: (() => void) | null = null
const noBrowserBridge = () => undefined

export function installBrowserElementBridge() {
  if (releaseBridge || !IS_BROWSER) return releaseBridge ?? noBrowserBridge

  const receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const message = parseBrowserElementEvent(event.data)
    if (!message) return
    if (message.kind === 'annotations-updated') {
      updateBrowserElementAnnotations(
        message.captureSessionId,
        message.selectionId,
        message.annotations
      )
      return
    }
    if (message.kind === 'annotate-requested') {
      requestBrowserElementAnnotation(message.captureSessionId, message.selectionId)
      return
    }
    if (message.kind === 'picker-started') {
      const trace = beginBrowserCaptureTrace({
        captureSessionId: message.captureSessionId,
        page: message.page
      })
      startBrowserCaptureSession({
        captureSessionId: message.captureSessionId,
        page: message.page,
        startedAt: message.captureStartedAt,
        ...(trace
          ? {
              traceEpisodeId: trace.episodeId,
              traceSessionId: trace.traceSessionId,
              ...(trace.traceTag ? { traceTag: trace.traceTag } : {})
            }
          : {})
      })
      return
    }
    if (message.kind === 'picker-ended') {
      const captureSessionId = message.captureSessionId ?? browserInspectorState.activeSessionId
      if (captureSessionId) finishBrowserCaptureTrace(captureSessionId)
      finishBrowserElementPicker(message.reason, message.captureSessionId, message.endedAt)
      return
    }
    if (message.kind === 'recording-started') {
      startBrowserCaptureRecording(message.captureSessionId)
      return
    }
    if (message.kind === 'recording-failed') {
      failBrowserCaptureRecording(message.captureSessionId, message.reason)
      return
    }
    if (message.kind === 'recording') {
      commitBrowserCaptureRecording(message.recording)
      return
    }
    if (message.kind === 'selection-removed') {
      removeBrowserElementSelection(message.captureSessionId, message.selectionId)
      return
    }
    commitBrowserElementSelection(message.selection)
  }

  window.addEventListener('message', receive)
  releaseBridge = () => {
    window.removeEventListener('message', receive)
    releaseBridge = null
  }
  return releaseBridge
}
