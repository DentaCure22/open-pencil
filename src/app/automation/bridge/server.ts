/**
 * Browser-side automation runtime.
 *
 * The MCP server is optional. When it is running, this runtime registers the
 * app's exact Board targets and answers direct RPC requests against the live
 * EditorStore. Durable authority remains a separate transport.
 */
import { useIntervalFn } from '@vueuse/core'

import { AUTOMATION_WS_PORT } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/core/random'

import { isUnknownRecord, listAutomationDocuments } from '@/app/automation/bridge/target'
import type { EditorStore } from '@/app/editor/active-store'
import { getTabsSnapshot } from '@/app/tabs'

type AutomationRequestHandler = (
  store: EditorStore,
  command: string,
  args: unknown
) => Promise<unknown>

function isAutomationClientActive(): boolean {
  if (typeof document === 'undefined') return true
  if (document.visibilityState === 'hidden') return false
  return typeof document.hasFocus !== 'function' || document.hasFocus()
}

function runtimeVisibility(): 'hidden' | 'visible' {
  if (typeof document === 'undefined') return 'visible'
  return document.visibilityState === 'hidden' ? 'hidden' : 'visible'
}

let navigationTargetsCacheKey = ''
let navigationTargetsCache: Array<Record<string, string>> = []

function navigationTargetsCacheSignature(): string {
  return getTabsSnapshot()
    .map(
      (tab) =>
        `${tab.id}:${String(tab.store.state.sceneVersion)}:${tab.store.state.currentPageId}:${tab.store.graph.rootId}`
    )
    .join('|')
}

function navigationTargets(getStore: () => EditorStore): Array<Record<string, string>> {
  try {
    const cacheKey = navigationTargetsCacheSignature()
    if (cacheKey && cacheKey === navigationTargetsCacheKey) return navigationTargetsCache
    const targets = listAutomationDocuments(getStore()).flatMap((document) =>
      document.workspace_id
        ? [
            {
              content_document_id: document.content_document_id,
              workspace_id: document.workspace_id
            }
          ]
        : []
    )
    navigationTargetsCacheKey = cacheKey
    navigationTargetsCache = targets
    return targets
  } catch {
    return []
  }
}

function responsePayload(value: unknown): Record<string, unknown> {
  if (isUnknownRecord(value)) return value
  return { result: value }
}

export function connectAutomation(getStore: () => EditorStore, authToken: string | null = null) {
  const runtimeInstanceId = `runtime:${randomHex(16)}`
  let token = authToken ?? randomHex(32)
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let intentionalDisconnect = false
  let requestHandlerPromise: Promise<AutomationRequestHandler> | null = null

  function loadRequestHandler() {
    requestHandlerPromise ??= Promise.all([
      import('@/app/automation/bridge/figma-factory'),
      import('@/app/automation/bridge/handlers')
    ])
      .then(([figmaFactory, handlers]) => {
        return handlers.createAutomationCommandHandlers(
          figmaFactory.makeFigmaFromStore,
          runtimeInstanceId
        ).handleRequest
      })
      .catch((error: unknown) => {
        requestHandlerPromise = null
        throw error
      })
    return requestHandlerPromise
  }

  let lastPresencePayload = ''

  function sendPresence(type: 'presence' | 'register', active = isAutomationClientActive()) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const payload = JSON.stringify({
      active,
      navigation_targets: navigationTargets(getStore),
      runtime_instance_id: runtimeInstanceId,
      token,
      type,
      visibility: runtimeVisibility(),
      write_authority: 'writer'
    })
    if (type === 'presence' && payload === lastPresencePayload) return
    lastPresencePayload = payload
    ws.send(payload)
  }

  const { pause: pausePresence, resume: resumePresence } = useIntervalFn(
    () => sendPresence('presence'),
    2500,
    { immediate: false }
  )

  function handleExplicitInteraction() {
    sendPresence('presence', true)
  }

  function handlePresenceChange() {
    sendPresence('presence')
  }

  function scheduleReconnect() {
    if (intentionalDisconnect || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      connect()
    }, 2000)
  }

  function connect() {
    if (intentionalDisconnect || typeof WebSocket === 'undefined') return
    let next: WebSocket
    try {
      next = new WebSocket(`ws://127.0.0.1:${AUTOMATION_WS_PORT}`)
    } catch {
      scheduleReconnect()
      return
    }
    ws = next

    next.onopen = () => {
      sendPresence('register')
      pausePresence()
      resumePresence()
    }

    next.onmessage = async (event) => {
      if (typeof event.data !== 'string') return
      let message: {
        args?: unknown
        command?: string
        id?: string
        token?: string
        type?: string
      }
      try {
        message = JSON.parse(event.data) as typeof message
      } catch {
        return
      }

      if (message.type === 'register' && message.token) {
        token = message.token
        return
      }
      if (message.type !== 'request' || !message.id || !message.command) return

      try {
        const result =
          message.command === 'list_documents'
            ? {
                ok: true,
                result: {
                  documents: listAutomationDocuments(getStore()),
                  runtime_instance_id: runtimeInstanceId
                }
              }
            : await (
                await loadRequestHandler()
              )(getStore(), message.command, message.args)
        if (next.readyState === WebSocket.OPEN) {
          next.send(
            JSON.stringify({ type: 'response', id: message.id, ...responsePayload(result) })
          )
        }
      } catch (error) {
        if (next.readyState === WebSocket.OPEN) {
          next.send(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              id: message.id,
              ok: false,
              type: 'response'
            })
          )
        }
      }
    }

    next.onclose = () => {
      pausePresence()
      if (ws === next) ws = null
      if (!intentionalDisconnect) scheduleReconnect()
    }

    next.onerror = () => {
      next.close()
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handlePresenceChange)
    window.addEventListener('focus', handlePresenceChange)
    window.addEventListener('blur', handlePresenceChange)
    window.addEventListener('pointerdown', handleExplicitInteraction, true)
  }

  function disconnect() {
    intentionalDisconnect = true
    clearTimeout(reconnectTimer)
    pausePresence()
    reconnectTimer = undefined
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handlePresenceChange)
      window.removeEventListener('focus', handlePresenceChange)
      window.removeEventListener('blur', handlePresenceChange)
      window.removeEventListener('pointerdown', handleExplicitInteraction, true)
    }
    ws?.close()
    ws = null
  }

  connect()
  return { disconnect, runtimeInstanceId, token }
}
