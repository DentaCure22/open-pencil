import { IS_BROWSER } from '@/constants'

import { parseBrowserElementEvent } from './contracts'
import { commitBrowserCaptureRecording, commitBrowserElementSelection } from './selection'
import {
  failBrowserCaptureRecording,
  finishBrowserElementPicker,
  requestBrowserElementAnnotation,
  startBrowserCaptureRecording,
  startBrowserCaptureSession
} from './state'

let releaseBridge: (() => void) | null = null
const noBrowserBridge = () => undefined

export function installBrowserElementBridge() {
  if (releaseBridge || !IS_BROWSER) return releaseBridge ?? noBrowserBridge

  const receive = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const message = parseBrowserElementEvent(event.data)
    if (!message) return
    if (message.kind === 'annotate-requested') {
      requestBrowserElementAnnotation(message.captureSessionId, message.selectionId)
      return
    }
    if (message.kind === 'picker-started') {
      startBrowserCaptureSession({
        captureSessionId: message.captureSessionId,
        page: message.page,
        startedAt: message.captureStartedAt
      })
      return
    }
    if (message.kind === 'picker-ended') {
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
    commitBrowserElementSelection(message.selection)
  }

  window.addEventListener('message', receive)
  releaseBridge = () => {
    window.removeEventListener('message', receive)
    releaseBridge = null
  }
  return releaseBridge
}
