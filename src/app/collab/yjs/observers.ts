import type * as Y from 'yjs'

import { YJS_STRUCTURE_REPAIR_ORIGIN } from '@/app/collab/origins'
import type { EditorStore } from '@/app/editor/active-store'

type YjsObserverOptions = {
  store: EditorStore
  ynodes: Y.Map<Y.Map<unknown>>
  yimages: Y.Map<Uint8Array>
  getSuppressYjsEvents: () => boolean
  setSuppressGraphSync: (value: boolean) => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
}

function logObserverError(context: string, error: unknown) {
  console.error(`[Collab] ${context}:`, error)
}

export function registerYjsObservers({
  store,
  ynodes,
  yimages,
  getSuppressYjsEvents,
  setSuppressGraphSync,
  applyYjsToGraph
}: YjsObserverOptions) {
  ynodes.observeDeep((events, transaction) => {
    if (getSuppressYjsEvents() || transaction.origin === YJS_STRUCTURE_REPAIR_ORIGIN) return
    setSuppressGraphSync(true)
    try {
      applyYjsToGraph(events)
    } catch (error) {
      logObserverError('Failed to apply remote graph changes', error)
    } finally {
      setSuppressGraphSync(false)
    }
  })

  yimages.observe((event) => {
    if (getSuppressYjsEvents()) return
    try {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const data = yimages.get(key)
          if (data) store.graph.images.set(key, new Uint8Array(data))
        } else {
          store.graph.images.delete(key)
        }
      }
      store.requestRender()
    } catch (error) {
      logObserverError('Failed to apply remote image changes', error)
    }
  })
}
