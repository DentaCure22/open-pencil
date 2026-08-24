import { useEventListener } from '@vueuse/core'

import { isTauri } from '@/app/tauri/env'

let errorHandlersInitialized = false

export function isBenignResizeObserverError(message: string): boolean {
  return (
    message === 'ResizeObserver loop limit exceeded' ||
    message === 'ResizeObserver loop completed with undelivered notifications.'
  )
}

// Floating notifications are intentionally disabled. Keep the facade while
// callers migrate important feedback into the surface that owns the action.
function discardNotification(message: string) {
  void message
}

const info = discardNotification
const warning = discardNotification
const error = discardNotification

function setupGlobalErrorHandler() {
  if (errorHandlersInitialized) return
  errorHandlersInitialized = true

  useEventListener(window, 'error', (e) => {
    if (isBenignResizeObserverError(e.message)) {
      e.preventDefault()
      return
    }
    error(e.message || 'An unexpected error occurred')
  })
  useEventListener(window, 'unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
    error(msg || 'An unexpected error occurred')
  })
}

export const toast = {
  info,
  warning,
  error,
  setupGlobalErrorHandler
}

export async function openExternalLink(url: string) {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank')
  }
}
export function initials(name: string): string {
  return (
    name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  )
}
export function decodeTauriStderr(raw: Uint8Array | number[] | string): string {
  if (typeof raw === 'string') return raw
  return new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
}
