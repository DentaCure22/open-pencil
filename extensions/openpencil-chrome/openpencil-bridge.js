;(() => {
  const BRIDGE_KEY = '__openpencilChromeElementBridge'
  const EVENT_CONTRACT = 'openpencil-browser-element/v1'
  const COMMAND_CONTRACT = 'openpencil-browser-element-command/v1'
  const RESULT_CONTRACT = 'openpencil-browser-element-command-result/v1'
  const token = crypto.randomUUID()

  function rethrowUnlessContextInvalidated(error) {
    if (!String(error).includes('Extension context invalidated')) throw error
  }

  try {
    globalThis[BRIDGE_KEY]?.dispose?.()
  } catch (error) {
    rethrowUnlessContextInvalidated(error)
  }
  document.documentElement.setAttribute('data-openpencil-chrome-bridge', token)
  const current = () =>
    document.documentElement.getAttribute('data-openpencil-chrome-bridge') === token

  function receiveExtensionMessage(message, _sender, sendResponse) {
    if (
      !current() ||
      message?.kind !== 'deliver-browser-element' ||
      message.event?.contract !== EVENT_CONTRACT
    ) {
      return false
    }
    window.postMessage(message.event, window.location.origin)
    sendResponse({ ok: true })
    return false
  }

  function receivePageMessage(event) {
    if (
      !current() ||
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.contract !== COMMAND_CONTRACT ||
      event.data.command?.kind !== 'activate-picker' ||
      typeof event.data.requestId !== 'string'
    ) {
      return
    }
    void chrome.runtime
      .sendMessage({ kind: 'activate-browser-element-picker' })
      .then((result) => {
        if (!current()) return undefined
        window.postMessage(
          {
            contract: RESULT_CONTRACT,
            ok: Boolean(result?.ok),
            ...(typeof result?.reason === 'string' ? { reason: result.reason } : {}),
            requestId: event.data.requestId
          },
          window.location.origin
        )
        return undefined
      })
      .catch(() => {
        if (!current()) return undefined
        window.postMessage(
          {
            contract: RESULT_CONTRACT,
            ok: false,
            reason: 'extension-unavailable',
            requestId: event.data.requestId
          },
          window.location.origin
        )
        return undefined
      })
  }

  chrome.runtime.onMessage.addListener(receiveExtensionMessage)
  window.addEventListener('message', receivePageMessage)
  globalThis[BRIDGE_KEY] = {
    dispose() {
      window.removeEventListener('message', receivePageMessage)
      try {
        chrome.runtime.onMessage.removeListener(receiveExtensionMessage)
      } catch (error) {
        rethrowUnlessContextInvalidated(error)
      }
    }
  }
  void chrome.runtime.sendMessage({ kind: 'openpencil-ready' }).catch(() => undefined)
})()
