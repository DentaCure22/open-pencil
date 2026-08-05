import type { EditorStore } from '@/app/editor/session'
import {
  isSmylrProductionDocumentGraph,
  saveSmylrProductionDocument
} from '@/app/smylr-production/document-state'
import { OPENPENCIL_WORKSPACE_DOCUMENT_NAME } from '@/app/workspace-document/identity'

export type DocumentPersistenceReadiness = {
  durable: boolean
  kind: 'browser-file-handle' | 'none' | 'smylr-production-cache' | 'tauri-file'
  ready: boolean
  reason: 'document-has-no-durable-save-target' | null
  requiredAction: 'save-document-as-or-open-production-backed-workspace' | null
  targetLabel: string | null
}

export function getDocumentPersistenceReadiness(store: EditorStore): DocumentPersistenceReadiness {
  if (isSmylrProductionDocumentGraph(store.graph)) {
    return {
      durable: true,
      kind: 'smylr-production-cache',
      ready: true,
      reason: null,
      requiredAction: null,
      targetLabel: `${OPENPENCIL_WORKSPACE_DOCUMENT_NAME} cache`
    }
  }

  const source = store.getWritableDocumentSource()
  if (source) {
    return {
      durable: true,
      kind: source.kind,
      ready: true,
      reason: null,
      requiredAction: null,
      targetLabel: source.label
    }
  }

  return {
    durable: false,
    kind: 'none',
    ready: false,
    reason: 'document-has-no-durable-save-target',
    requiredAction: 'save-document-as-or-open-production-backed-workspace',
    targetLabel: null
  }
}

export async function persistOpenPencilDocument(store: EditorStore): Promise<boolean> {
  const readiness = getDocumentPersistenceReadiness(store)
  if (readiness.kind === 'smylr-production-cache') {
    return saveSmylrProductionDocument(store)
  }
  if (readiness.kind === 'browser-file-handle' || readiness.kind === 'tauri-file') {
    return store.persistWritableDocumentSource()
  }
  return false
}
