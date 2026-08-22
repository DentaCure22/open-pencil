const OPENPENCIL_URLS = ['http://localhost:1420/*', 'http://127.0.0.1:1420/*']
const OPENPENCIL_ORIGINS = ['http://localhost:1420/', 'http://127.0.0.1:1420/']
const EVENT_CONTRACT = 'openpencil-browser-element/v1'
const ACTIVE_CAPTURE_SESSION_KEY = 'openpencil-active-capture-session-v1'
const PENDING_EVENTS_KEY = 'openpencil-pending-browser-events-v3'
const RECORDING_SOURCES_KEY = 'openpencil-recording-sources-v1'
const OFFSCREEN_PATH = 'offscreen.html'
const MAX_PENDING_EVENTS = 100
const MAX_RECORDING_BYTES = 11_500_000
let creatingOffscreenDocument = null
let captureSessionMutation = Promise.resolve()

function isWebPage(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))
}

function isOpenPencilPage(url) {
  return typeof url === 'string' && OPENPENCIL_ORIGINS.some((origin) => url.startsWith(origin))
}

async function sessionValue(key, fallback) {
  const result = await chrome.storage.session.get(key)
  return result[key] ?? fallback
}

function serializeCaptureSession(operation) {
  const result = captureSessionMutation.then(operation, operation)
  captureSessionMutation = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function newCaptureSession() {
  return {
    captureSessionId: crypto.randomUUID(),
    captureStartedAt: new Date().toISOString(),
    pages: [],
    sequence: 0,
    tabIds: []
  }
}

async function activeCaptureSession() {
  const session = await sessionValue(ACTIVE_CAPTURE_SESSION_KEY, null)
  if (
    !session ||
    typeof session.captureSessionId !== 'string' ||
    typeof session.captureStartedAt !== 'string'
  ) {
    return null
  }
  return {
    ...session,
    pages: Array.isArray(session.pages) ? session.pages : [],
    sequence: Number.isSafeInteger(session.sequence) ? session.sequence : 0,
    tabIds: Array.isArray(session.tabIds)
      ? session.tabIds.filter((tabId) => Number.isSafeInteger(tabId))
      : []
  }
}

async function storeCaptureSession(session) {
  await chrome.storage.session.set({ [ACTIVE_CAPTURE_SESSION_KEY]: session })
  return session
}

function pageForTab(tab) {
  if (!isWebPage(tab.url)) return null
  const url = new URL(tab.url)
  return {
    origin: url.origin,
    title: typeof tab.title === 'string' ? tab.title.slice(0, 500) : '',
    url: tab.url.slice(0, 4_096)
  }
}

async function armCaptureSession() {
  return serializeCaptureSession(async () => {
    const current = await activeCaptureSession()
    if (current) return current
    return storeCaptureSession(newCaptureSession())
  })
}

async function storePendingEvent(event) {
  if (event.kind === 'recording') return
  const pending = await sessionValue(PENDING_EVENTS_KEY, [])
  const next = [...(Array.isArray(pending) ? pending : []), event].slice(-MAX_PENDING_EVENTS)
  await chrome.storage.session.set({ [PENDING_EVENTS_KEY]: next })
  await chrome.action.setBadgeBackgroundColor({ color: '#6d5efc' })
  await chrome.action.setBadgeText({ text: String(Math.min(next.length, 99)) })
}

async function openPencilTab() {
  const tabs = await chrome.tabs.query({ url: OPENPENCIL_URLS })
  tabs.sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))
  return tabs.find((tab) => typeof tab.id === 'number') ?? null
}

async function sendEventToOpenPencil(event, persistIfMissing = true) {
  const target = await openPencilTab()
  if (!target?.id) {
    if (persistIfMissing) await storePendingEvent(event)
    return false
  }
  try {
    await chrome.tabs.sendMessage(target.id, { event, kind: 'deliver-browser-element' })
    return true
  } catch {
    if (persistIfMissing) await storePendingEvent(event)
    return false
  }
}

async function flushPendingEvents() {
  const pending = await sessionValue(PENDING_EVENTS_KEY, [])
  if (!Array.isArray(pending) || pending.length === 0) return true
  let deliveredCount = 0
  for (const event of pending) {
    if (!(await sendEventToOpenPencil(event, false))) break
    deliveredCount += 1
  }
  const remaining = pending.slice(deliveredCount)
  if (remaining.length) await chrome.storage.session.set({ [PENDING_EVENTS_KEY]: remaining })
  else await chrome.storage.session.remove(PENDING_EVENTS_KEY)
  await chrome.action.setBadgeText({
    text: remaining.length ? String(Math.min(remaining.length, 99)) : ''
  })
  return remaining.length === 0
}

async function captureVisibleSource(sender) {
  const tab = sender.tab
  if (!tab?.id || !tab.active || typeof tab.windowId !== 'number') {
    return { ok: false, reason: 'source-tab-not-visible' }
  }
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    return { dataUrl, ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'capture-failed' }
  }
}

async function joinCaptureSession(tabId, captureSessionId, page) {
  return serializeCaptureSession(async () => {
    const session = await activeCaptureSession()
    if (!session || session.captureSessionId !== captureSessionId) return null
    if (!session.tabIds.includes(tabId)) session.tabIds.push(tabId)
    if (page && !session.pages.some((candidate) => candidate.url === page.url)) {
      session.pages.push(structuredClone(page))
    }
    return storeCaptureSession(session)
  })
}

async function reserveCaptureSequence(message) {
  if (typeof message.captureSessionId !== 'string') {
    return { ok: false, reason: 'capture-session-required' }
  }
  return serializeCaptureSession(async () => {
    const session = await activeCaptureSession()
    if (!session || session.captureSessionId !== message.captureSessionId) {
      return { ok: false, reason: 'capture-session-ended' }
    }
    session.sequence += 1
    await storeCaptureSession(session)
    return { ok: true, sequence: session.sequence }
  })
}

async function receivePickerStarted(sender, message) {
  if (!sender.tab?.id || typeof message.captureSessionId !== 'string') return false
  const session = await joinCaptureSession(sender.tab.id, message.captureSessionId, message.page)
  if (!session) return false
  return sendEventToOpenPencil({
    captureSessionId: message.captureSessionId,
    captureStartedAt: message.captureStartedAt,
    contract: EVENT_CONTRACT,
    kind: 'picker-started',
    ...(message.page ? { page: structuredClone(message.page) } : {})
  })
}

async function receiveSelection(sender, message) {
  if (!sender.tab?.id || !message?.selection?.id) return false
  const selection = structuredClone(message.selection)
  selection.session = {
    ...selection.session,
    ...(sender.documentId ? { documentId: sender.documentId } : {}),
    frameId: sender.frameId ?? 0,
    tabId: sender.tab.id
  }
  const session = await joinCaptureSession(
    sender.tab.id,
    selection.session.captureSessionId,
    selection.page
  )
  if (!session) return false
  await chrome.action.setBadgeBackgroundColor({ color: '#6d5efc' })
  await chrome.action.setBadgeText({
    tabId: sender.tab.id,
    text: String(Math.min(Number(selection.session.sequence) || 1, 99))
  })
  return sendEventToOpenPencil({ contract: EVENT_CONTRACT, kind: 'selection', selection })
}

async function receivePickerEnded(sender, message) {
  const recordingSources = await sessionValue(RECORDING_SOURCES_KEY, {})
  if (typeof recordingSources?.[message.captureSessionId] === 'number') {
    await stopMotionRecording(message).catch(() => undefined)
  }
  const session = await serializeCaptureSession(async () => {
    const current = await activeCaptureSession()
    if (!current || current.captureSessionId !== message.captureSessionId) return null
    await chrome.storage.session.remove(ACTIVE_CAPTURE_SESSION_KEY)
    return current
  })
  const tabIds = session?.tabIds ?? (sender.tab?.id ? [sender.tab.id] : [])
  await Promise.all(
    tabIds.map(async (tabId) => {
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined)
      if (tabId !== sender.tab?.id) {
        await chrome.tabs
          .sendMessage(tabId, {
            captureSessionId: message.captureSessionId,
            kind: 'browser-element-picker-stop-session'
          })
          .catch(() => undefined)
      }
    })
  )
  return sendEventToOpenPencil({
    captureSessionId: message.captureSessionId,
    captureStartedAt: message.captureStartedAt,
    contract: EVENT_CONTRACT,
    endedAt: message.endedAt,
    kind: 'picker-ended',
    ...(typeof message.reason === 'string' ? { reason: message.reason } : {})
  })
}

async function receiveAnnotateRequested(message) {
  if (typeof message.captureSessionId !== 'string' || typeof message.selectionId !== 'string') {
    return false
  }
  return sendEventToOpenPencil({
    captureSessionId: message.captureSessionId,
    captureStartedAt: message.captureStartedAt,
    contract: EVENT_CONTRACT,
    kind: 'annotate-requested',
    selectionId: message.selectionId,
    sequence: message.sequence
  })
}

async function hasOffscreenDocument() {
  if (typeof chrome.runtime.getContexts === 'function') {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    })
    return contexts.length > 0
  }
  if (typeof chrome.offscreen.hasDocument === 'function') return chrome.offscreen.hasDocument()
  return false
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        justification: 'Record an explicitly requested Chrome capture session.',
        reasons: ['USER_MEDIA'],
        url: OFFSCREEN_PATH
      })
      .finally(() => {
        creatingOffscreenDocument = null
      })
  }
  await creatingOffscreenDocument
}

async function rememberRecordingSource(captureSessionId, tabId) {
  const sources = await sessionValue(RECORDING_SOURCES_KEY, {})
  await chrome.storage.session.set({
    [RECORDING_SOURCES_KEY]: { ...sources, [captureSessionId]: tabId }
  })
}

async function notifyRecordingStopped(captureSessionId) {
  const sources = await sessionValue(RECORDING_SOURCES_KEY, {})
  const tabId = sources?.[captureSessionId]
  if (typeof tabId === 'number') {
    await chrome.tabs
      .sendMessage(tabId, { captureSessionId, kind: 'browser-motion-recording-ended' })
      .catch(() => undefined)
  }
  if (sources && typeof sources === 'object') {
    const next = Object.fromEntries(
      Object.entries(sources).filter(([sessionId]) => sessionId !== captureSessionId)
    )
    if (Object.keys(next).length) {
      await chrome.storage.session.set({ [RECORDING_SOURCES_KEY]: next })
    } else {
      await chrome.storage.session.remove(RECORDING_SOURCES_KEY)
    }
  }
}

async function startMotionRecording(sender, message) {
  if (!sender.tab?.id || typeof message.captureSessionId !== 'string') {
    return { ok: false, reason: 'source-tab-required' }
  }
  try {
    await ensureOffscreenDocument()
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: sender.tab.id })
    const result = await chrome.runtime.sendMessage({
      captureSessionId: message.captureSessionId,
      kind: 'start-recording',
      startedAt: new Date().toISOString(),
      streamId,
      target: 'offscreen'
    })
    if (!result?.ok) return result
    await rememberRecordingSource(message.captureSessionId, sender.tab.id)
    await sendEventToOpenPencil({
      captureSessionId: message.captureSessionId,
      contract: EVENT_CONTRACT,
      kind: 'recording-started',
      mimeType: result.mimeType,
      startedAt: result.startedAt
    })
    return result
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'motion-recording-unavailable'
    }
  }
}

async function stopMotionRecording(message) {
  try {
    await ensureOffscreenDocument()
    return chrome.runtime.sendMessage({
      captureSessionId: message.captureSessionId,
      kind: 'stop-recording',
      target: 'offscreen'
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'recording-stop-failed' }
  }
}

async function receiveRecordingComplete(message) {
  if (
    typeof message.captureSessionId !== 'string' ||
    typeof message.dataUrl !== 'string' ||
    !message.dataUrl.startsWith('data:video/webm')
  ) {
    return false
  }
  if (Number(message.byteLength) > MAX_RECORDING_BYTES) {
    return sendEventToOpenPencil({
      captureSessionId: message.captureSessionId,
      contract: EVENT_CONTRACT,
      kind: 'recording-failed',
      reason: 'recording-too-large'
    })
  }
  await notifyRecordingStopped(message.captureSessionId)
  return sendEventToOpenPencil({
    contract: EVENT_CONTRACT,
    kind: 'recording',
    recording: {
      captureSessionId: message.captureSessionId,
      dataUrl: message.dataUrl,
      durationMs: message.durationMs,
      endedAt: message.endedAt,
      id: crypto.randomUUID(),
      mimeType: message.mimeType,
      startedAt: message.startedAt
    }
  })
}

async function receiveRecordingFailed(message) {
  if (typeof message.captureSessionId !== 'string') return false
  await notifyRecordingStopped(message.captureSessionId)
  return sendEventToOpenPencil({
    captureSessionId: message.captureSessionId,
    contract: EVENT_CONTRACT,
    kind: 'recording-failed',
    reason: typeof message.reason === 'string' ? message.reason : 'recording-failed'
  })
}

async function injectPicker(tabId, session) {
  try {
    const tab = await chrome.tabs.get(tabId)
    const page = pageForTab(tab)
    if (!page || isOpenPencilPage(tab.url)) return { ok: false, reason: 'restricted-page' }
    const joined = await joinCaptureSession(tabId, session.captureSessionId, page)
    if (!joined) return { ok: false, reason: 'capture-session-ended' }
    await chrome.scripting.executeScript({
      args: [
        {
          captureSessionId: joined.captureSessionId,
          captureStartedAt: joined.captureStartedAt,
          selectedCount: joined.sequence
        }
      ],
      func: (config) => {
        globalThis.__openpencilPickerSessionConfig = config
      },
      target: { tabId }
    })
    await chrome.scripting.executeScript({ target: { tabId }, files: ['picker.js'] })
    await chrome.action.setBadgeBackgroundColor({ color: '#6d5efc' })
    await chrome.action.setBadgeText({
      tabId,
      text: joined.sequence ? String(Math.min(joined.sequence, 99)) : 'PICK'
    })
    return { captureSessionId: joined.captureSessionId, ok: true }
  } catch {
    return { ok: false, reason: 'source-access-required' }
  }
}

async function pickerIsActive(tabId, captureSessionId) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { kind: 'browser-element-picker-status' })
    return Boolean(result?.active && result.captureSessionId === captureSessionId)
  } catch {
    return false
  }
}

async function armPickerFromOpenPencil() {
  const session = await armCaptureSession()
  return { captureSessionId: session.captureSessionId, ok: true, armed: true }
}

async function activateCaptureOnTab(tabId) {
  const session = await activeCaptureSession()
  if (!session) return { ok: false, reason: 'capture-session-inactive' }
  if (await pickerIsActive(tabId, session.captureSessionId)) {
    await chrome.tabs
      .sendMessage(tabId, {
        captureSessionId: session.captureSessionId,
        kind: 'browser-element-picker-sync-session',
        selectedCount: session.sequence
      })
      .catch(() => undefined)
    await chrome.action.setBadgeText({
      tabId,
      text: session.sequence ? String(Math.min(session.sequence, 99)) : 'PICK'
    })
    return { ok: true, resumed: true }
  }
  return injectPicker(tabId, session)
}

async function injectOpenPencilBridges() {
  const tabs = await chrome.tabs.query({ url: OPENPENCIL_URLS })
  await Promise.all(
    tabs.map((tab) =>
      typeof tab.id === 'number'
        ? chrome.scripting
            .executeScript({ target: { tabId: tab.id }, files: ['openpencil-bridge.js'] })
            .catch(() => undefined)
        : undefined
    )
  )
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !isWebPage(tab.url) || isOpenPencilPage(tab.url)) {
    await chrome.action.setBadgeBackgroundColor({ color: '#a33a3a' })
    await chrome.action.setBadgeText({ text: 'NO' })
    return
  }
  const session = await armCaptureSession()
  await injectPicker(tab.id, session)
})

chrome.runtime.onInstalled.addListener(() => void injectOpenPencilBridges())

async function activateSessionForSelectedTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (isWebPage(tab.url) && !isOpenPencilPage(tab.url)) await activateCaptureOnTab(tabId)
  } catch (error) {
    console.debug('OpenPencil ignored a tab that closed during activation.', error)
  }
}

async function restoreSessionAfterNavigation(tabId, tab) {
  const session = await activeCaptureSession()
  if (
    !session ||
    !isWebPage(tab.url) ||
    isOpenPencilPage(tab.url) ||
    (!tab.active && !session.tabIds.includes(tabId))
  ) {
    return
  }
  await injectPicker(tabId, session)
}

async function forgetClosedCaptureTab(tabId) {
  await serializeCaptureSession(async () => {
    const session = await activeCaptureSession()
    if (!session || !session.tabIds.includes(tabId)) return
    session.tabIds = session.tabIds.filter((candidate) => candidate !== tabId)
    await storeCaptureSession(session)
  })
}

async function openPencilReady() {
  await flushPendingEvents()
  const session = await activeCaptureSession()
  if (session) {
    for (const page of session.pages) {
      await sendEventToOpenPencil({
        captureSessionId: session.captureSessionId,
        captureStartedAt: session.captureStartedAt,
        contract: EVENT_CONTRACT,
        kind: 'picker-started',
        page
      })
    }
  }
  return true
}

chrome.tabs.onActivated.addListener(({ tabId }) => void activateSessionForSelectedTab(tabId))
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete') void restoreSessionAfterNavigation(tabId, tab)
})
chrome.tabs.onRemoved.addListener((tabId) => void forgetClosedCaptureTab(tabId))

const runtimeMessageHandlers = {
  'activate-browser-element-picker': () => armPickerFromOpenPencil(),
  'browser-element-annotate-requested': (message) => receiveAnnotateRequested(message),
  'browser-element-picker-ended': (message, sender) => receivePickerEnded(sender, message),
  'browser-element-picker-started': (message, sender) => receivePickerStarted(sender, message),
  'browser-element-selection': (message, sender) => receiveSelection(sender, message),
  'capture-visible-browser-element': (_message, sender) => captureVisibleSource(sender),
  'openpencil-ready': () => openPencilReady(),
  'reserve-browser-element-sequence': (message) => reserveCaptureSequence(message),
  'recording-complete': (message) => receiveRecordingComplete(message),
  'recording-failed': (message) => receiveRecordingFailed(message),
  'start-browser-motion-recording': (message, sender) => startMotionRecording(sender, message),
  'stop-browser-motion-recording': (message) => stopMotionRecording(message)
}

function respondToRuntimeMessage(promise, sendResponse) {
  promise.then(sendResponse).catch((error) =>
    sendResponse({
      ok: false,
      reason: error instanceof Error ? error.message : 'unknown-error'
    })
  )
  return true
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false
  const handler = runtimeMessageHandlers[message?.kind]
  if (typeof handler !== 'function') return false
  return respondToRuntimeMessage(Promise.resolve(handler(message, sender)), sendResponse)
})
