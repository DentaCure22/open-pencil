import { IS_BROWSER } from '@/constants'

import {
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
  type SmylrOpenPencilInspectorCommand
} from './protocol'

export type LiveInspectorCommand = Omit<SmylrOpenPencilInspectorCommand, 'kind'>

export type LiveInspectorDirectCommandDispatcher = (command: LiveInspectorCommand) => boolean

type LiveInspectorDirectCommandTarget = {
  dispatch: LiveInspectorDirectCommandDispatcher
  frameId: string
}

type LiveInspectorWindowCommandTarget = {
  origin: string
  target: Window
}

export function createLiveInspectorCommandChannel(activeFrameId: () => string | null) {
  let directTarget: LiveInspectorDirectCommandTarget | null = null
  let windowTarget: LiveInspectorWindowCommandTarget | null = null

  function setWindowTarget(target: Window | null, targetOrigin?: string | null) {
    if (!target || !targetOrigin || targetOrigin === '*') {
      windowTarget = null
      return
    }

    try {
      const normalizedOrigin = new URL(targetOrigin).origin
      windowTarget =
        normalizedOrigin === targetOrigin && normalizedOrigin !== 'null'
          ? { origin: normalizedOrigin, target }
          : null
    } catch {
      windowTarget = null
    }
  }

  function setDirectTarget(frameId: string, dispatch: LiveInspectorDirectCommandDispatcher | null) {
    if (!dispatch) {
      if (directTarget?.frameId === frameId) directTarget = null
      return
    }
    directTarget = { dispatch, frameId }
  }

  function mountedWindowTarget(): LiveInspectorWindowCommandTarget | null {
    if (!IS_BROWSER) return null
    const frame = document.querySelector<HTMLIFrameElement>(
      '[data-test-id="smylr-trusted-web-app-frame"]'
    )
    // A flow canvas can keep its pooled runtime active beside the current-page
    // iframe. Only let the mounted current-page iframe override the registered
    // command target when it actually owns the active inspector document.
    const activeId = activeFrameId()
    if (frame && activeId && frame.dataset.liveFrameId !== activeId) return null

    const target = frame?.contentWindow ?? null
    const source = frame?.getAttribute('src')
    const parentHref = window.location.href
    if (!target || !source || !parentHref) return null

    try {
      const origin = new URL(source, parentHref).origin
      return origin === 'null' ? null : { origin, target }
    } catch {
      return null
    }
  }

  function post(command: LiveInspectorCommand) {
    if (directTarget?.frameId === activeFrameId()) {
      try {
        return directTarget.dispatch(command)
      } catch {
        return false
      }
    }

    const mountedTarget = mountedWindowTarget()
    if (mountedTarget) windowTarget = mountedTarget
    const target = mountedTarget ?? windowTarget
    if (!target) return false

    try {
      const data = {
        ...command,
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
      }
      // The production Smylr iframe is deliberately same-origin. Dispatching in
      // that window avoids browser/proxy cases where postMessage is silently
      // dropped, while the iframe's normal source + origin validation still runs.
      if (IS_BROWSER && target.origin === window.location.origin) {
        const directCommand = (
          target.target as Window & {
            __smylrOpenPencilCommand?: (command: typeof data) => void
          }
        ).__smylrOpenPencilCommand
        if (directCommand) directCommand(data)
        else target.target.postMessage(data, target.origin)
      } else {
        target.target.postMessage(data, target.origin)
      }
      return true
    } catch {
      return false
    }
  }

  return {
    clearWindowTarget: () => {
      windowTarget = null
    },
    post,
    setDirectTarget,
    setWindowTarget
  }
}
