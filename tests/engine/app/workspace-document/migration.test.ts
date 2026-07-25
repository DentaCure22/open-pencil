import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  applySmylrProductionDocument,
  serializeSmylrProductionDocumentForSync
} from '@/app/smylr-production/document-state'
import { createSmylrProductionWorkspaceGraph } from '@/app/smylr-production/workspace'
import {
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  readOpenPencilWorkspaceIdentity
} from '@/app/workspace-document/identity'

describe('OpenPencil workspace document migration', () => {
  test('adopts the existing production graph without changing its pages or root identity', async () => {
    const legacy = createEditorStore(createSmylrProductionWorkspaceGraph().graph)
    const legacyRootId = legacy.graph.rootId
    const legacyPageIds = legacy.graph.getPages().map((page) => page.id)
    const cached = serializeSmylrProductionDocumentForSync(legacy)
    if (!cached) throw new Error('Expected legacy production document payload')
    const restored = createEditorStore()

    expect(await applySmylrProductionDocument(restored, cached, { applyTombstones: false })).toBe(
      true
    )
    expect(restored.graph.rootId).toBe(legacyRootId)
    expect(restored.graph.getPages().map((page) => page.id)).toEqual(legacyPageIds)
    expect(restored.state.documentName).toBe(OPENPENCIL_WORKSPACE_DOCUMENT_NAME)
    expect(
      readOpenPencilWorkspaceIdentity(restored.graph)?.workspaceId.startsWith('workspace-')
    ).toBe(true)
  })
})
