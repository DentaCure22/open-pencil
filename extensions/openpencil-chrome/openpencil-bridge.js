;(() => {
  const BRIDGE_KEY = '__openpencilChromeElementBridge'
  const EVENT_CONTRACT = 'openpencil-browser-element/v1'
  const COMMAND_CONTRACT = 'openpencil-browser-element-command/v1'
  const RESULT_CONTRACT = 'openpencil-browser-element-command-result/v1'
  const COMMAND_PAYLOAD_ATTRIBUTE = 'data-openpencil-browser-element-command'
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

  function receivePageCommand() {
    const payload = document.documentElement.getAttribute(COMMAND_PAYLOAD_ATTRIBUTE)
    if (!payload) return
    document.documentElement.removeAttribute(COMMAND_PAYLOAD_ATTRIBUTE)
    let data
    try {
      data = JSON.parse(payload)
    } catch {
      return
    }
    if (
      !current() ||
      data?.contract !== COMMAND_CONTRACT ||
      ![
        'activate-picker',
        'relay-live-surface-input',
        'start-live-surface-capture',
        'stop-live-surface-capture'
      ].includes(data.command?.kind) ||
      typeof data.requestId !== 'string'
    ) {
      return
    }
    const commandKind = data.command.kind
    const runtimeKinds = {
      'relay-live-surface-input': 'relay-browser-live-surface-input',
      'start-live-surface-capture': 'start-browser-live-surface-capture',
      'stop-live-surface-capture': 'stop-browser-live-surface-capture'
    }
    const message =
      commandKind === 'activate-picker'
        ? { kind: 'activate-browser-element-picker' }
        : {
            command: data.command,
            kind: runtimeKinds[commandKind]
          }
    void chrome.runtime
      .sendMessage(message)
      .then((result) => {
        if (!current()) return undefined
        window.postMessage(
          {
            contract: RESULT_CONTRACT,
            ok: Boolean(result?.ok),
            ...(typeof result?.reason === 'string' ? { reason: result.reason } : {}),
            requestId: data.requestId
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
            requestId: data.requestId
          },
          window.location.origin
        )
        return undefined
      })
  }

  chrome.runtime.onMessage.addListener(receiveExtensionMessage)
  const commandObserver = new MutationObserver(receivePageCommand)
  commandObserver.observe(document.documentElement, {
    attributeFilter: [COMMAND_PAYLOAD_ATTRIBUTE],
    attributes: true
  })
  receivePageCommand()
  globalThis[BRIDGE_KEY] = {
    dispose() {
      commandObserver.disconnect()
      try {
        chrome.runtime.onMessage.removeListener(receiveExtensionMessage)
      } catch (error) {
        rethrowUnlessContextInvalidated(error)
      }
    }
  }
  void chrome.runtime.sendMessage({ kind: 'openpencil-ready' }).catch(() => undefined)
})()
