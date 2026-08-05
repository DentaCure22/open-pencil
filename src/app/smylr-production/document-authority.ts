import type { EditorStore } from '@/app/editor/session'

type SmylrProductionDocumentWriteGuard = () => boolean

const documentWriteGuards = new WeakMap<EditorStore, SmylrProductionDocumentWriteGuard>()
const denySmylrProductionDocumentWrite = () => false

export function setSmylrProductionDocumentWriteGuard(
  store: EditorStore,
  writeGuard: SmylrProductionDocumentWriteGuard | null
) {
  if (writeGuard) documentWriteGuards.set(store, writeGuard)
  else documentWriteGuards.delete(store)
}

export function bindSmylrProductionDocumentWriteGuard(
  store: EditorStore,
  writeGuard: SmylrProductionDocumentWriteGuard
): () => void {
  documentWriteGuards.set(store, writeGuard)
  return () => {
    if (documentWriteGuards.get(store) === writeGuard) {
      documentWriteGuards.set(store, denySmylrProductionDocumentWrite)
    }
  }
}

export function canWriteSmylrProductionDocument(store: EditorStore): boolean {
  return documentWriteGuards.get(store)?.() ?? true
}
