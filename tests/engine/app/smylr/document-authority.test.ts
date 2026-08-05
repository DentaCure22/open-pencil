import { afterEach, expect, test } from 'bun:test'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
import { bindSmylrProductionDocumentWriteGuard } from '@/app/smylr-production/document-state'

const RUNTIME_ID = 'runtime:document-authority-test'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'document')
})

test('keeps Board context aligned with the newest workspace writer binding', async () => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible' }
  })
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const target: AutomationTarget = {
    documentId: 'document-authority-test',
    documentName: 'Authority test',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:document-authority-test'
  }
  const staleRelease = bindSmylrProductionDocumentWriteGuard(store, () => true)
  const currentRelease = bindSmylrProductionDocumentWriteGuard(store, () => true)

  staleRelease()
  const handlers = createAutomationBoardHandlers(RUNTIME_ID)
  const writerContext = (await handlers.context(target)) as {
    capabilities: string[]
    runtime: { write_authority: string }
  }
  expect(writerContext.runtime.write_authority).toBe('writer')
  expect(writerContext.capabilities).toContain('board.change.artifact.create.native_text')

  currentRelease()
  const releasedContext = (await handlers.context(target)) as {
    capabilities: string[]
    runtime: { write_authority: string }
  }
  expect(releasedContext.runtime.write_authority).toBe('viewer')
  expect(releasedContext.capabilities).not.toContain('board.change.artifact.create.native_text')
})
