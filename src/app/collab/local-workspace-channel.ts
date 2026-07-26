import * as Y from 'yjs'

import { LOCAL_WORKSPACE_COLLAB_ORIGIN } from '@/app/collab/origins'

type LocalWorkspaceChannelMessage =
  | { type: 'sync-request' }
  | { type: 'update'; update: Uint8Array }

export type LocalWorkspaceChannel = {
  close(): void
}

function isLocalWorkspaceChannelMessage(value: unknown): value is LocalWorkspaceChannelMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false
  const candidate = value as Partial<LocalWorkspaceChannelMessage>
  if (candidate.type === 'sync-request') return true
  return candidate.type === 'update' && candidate.update instanceof Uint8Array
}

export function connectLocalWorkspaceChannel(
  roomId: string,
  ydoc: Y.Doc
): LocalWorkspaceChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel(`openpencil-workspace:${roomId}`)

  function postUpdate(update: Uint8Array) {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
    channel.postMessage({ type: 'update', update: new Uint8Array(update) })
  }

  function handleDocumentUpdate(update: Uint8Array, origin: unknown) {
    if (origin === LOCAL_WORKSPACE_COLLAB_ORIGIN) return
    postUpdate(update)
  }

  function handleChannelMessage(event: MessageEvent<unknown>) {
    if (!isLocalWorkspaceChannelMessage(event.data)) return
    if (event.data.type === 'sync-request') {
      postUpdate(Y.encodeStateAsUpdate(ydoc))
      return
    }
    Y.applyUpdate(ydoc, event.data.update, LOCAL_WORKSPACE_COLLAB_ORIGIN)
  }

  ydoc.on('update', handleDocumentUpdate)
  channel.addEventListener('message', handleChannelMessage)
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel has no targetOrigin overload.
  channel.postMessage({ type: 'sync-request' })

  return {
    close() {
      ydoc.off('update', handleDocumentUpdate)
      channel.removeEventListener('message', handleChannelMessage)
      channel.close()
    }
  }
}
