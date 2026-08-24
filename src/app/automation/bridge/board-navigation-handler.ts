import type { AutomationTarget } from '@/app/automation/bridge/target'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { getActiveTabId, switchTab } from '@/app/tabs'

type BoardNavigationDependencies = {
  activeDocumentId: () => string
  activateDocument: (documentId: string) => void
  viewportInsets: typeof editorViewportInsets
}

const defaultDependencies: BoardNavigationDependencies = {
  activeDocumentId: getActiveTabId,
  activateDocument: switchTab,
  viewportInsets: editorViewportInsets
}

export function createAutomationBoardOpenHandler(
  dependencies: BoardNavigationDependencies = defaultDependencies
) {
  return async function handleBoardOpen(
    target: AutomationTarget
  ): Promise<Record<string, unknown>> {
    dependencies.activateDocument(target.documentId)
    if (dependencies.activeDocumentId() !== target.documentId) {
      throw new Error(`Document tab "${target.documentId}" could not be activated.`)
    }

    await target.store.switchPage(target.pageId, {
      fitOnFirstVisit: true,
      viewportInsets: dependencies.viewportInsets()
    })
    if (target.store.state.currentPageId !== target.pageId) {
      throw new Error(`Board page "${target.pageId}" could not be opened.`)
    }

    return {
      action: 'opened',
      active: true,
      board_revision: target.store.state.sceneVersion,
      content_document_id: target.contentDocumentId,
      document_id: target.documentId,
      page_id: target.pageId,
      page_name: target.pageName,
      runtime_instance_id: target.runtimeInstanceId,
      status: 'completed',
      workspace_id: target.workspaceId
    }
  }
}
