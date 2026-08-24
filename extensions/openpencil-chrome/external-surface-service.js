async function sourceTarget(source) {
  if (
    source?.kind !== 'chrome-element' ||
    !Number.isSafeInteger(source.tabId) ||
    !Number.isSafeInteger(source.frameId) ||
    typeof source.page?.origin !== 'string' ||
    typeof source.element?.selector !== 'string'
  ) {
    return null
  }
  const tab = await chrome.tabs.get(source.tabId).catch(() => null)
  if (!tab?.id || !isWebPage(tab.url) || new URL(tab.url).origin !== source.page.origin) {
    return null
  }
  return { frameId: source.frameId, tabId: tab.id }
}

async function sendThroughRelay(target, message) {
  const messageTarget = { frameId: target.frameId }
  try {
    return await chrome.tabs.sendMessage(target.tabId, message, messageTarget)
  } catch {
    await chrome.scripting.executeScript({
      files: ['external-surface-relay.js'],
      target: { frameIds: [target.frameId], tabId: target.tabId }
    })
    return chrome.tabs.sendMessage(target.tabId, message, messageTarget)
  }
}

export async function measureBrowserLiveSurface(source) {
  const target = await sourceTarget(source)
  if (!target) return { ok: false, reason: 'source-page-unavailable' }
  return sendThroughRelay(target, {
    contract: 'openpencil-browser-live-surface-measure/v1',
    kind: 'browser-live-surface-measure',
    source
  })
}

export async function relayBrowserLiveSurfaceInput(message) {
  const command = message?.command
  const source = command?.source
  if (command?.kind !== 'relay-live-surface-input') {
    return { ok: false, reason: 'invalid-live-surface-command' }
  }
  const target = await sourceTarget(source)
  if (!target) return { ok: false, reason: 'source-page-unavailable' }
  const relayMessage = {
    contract: 'openpencil-browser-live-surface-input/v1',
    input: command.input,
    kind: 'browser-live-surface-input',
    source
  }
  return sendThroughRelay(target, relayMessage)
}

function isWebPage(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))
}
