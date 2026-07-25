import type { Editor, EditorState } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'
import {
  hasReactDocumentSource,
  reactSourceToDesignDocument,
  reactSourceToSceneGraph,
  reconcileDesignDocumentToSceneGraph
} from '@open-pencil/dom-css/browser'

import { yieldToUI } from '@/app/document/io/browser'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import { toast } from '@/app/shell/ui'

type OpenReactDocumentState = EditorState & {
  documentName: string
  loading: boolean
}

type ReactImportOptions = {
  editor: Editor
  state: OpenReactDocumentState
  setDocumentSource: (fileName: string, sourceFormat: string) => void
  fitCurrentPageToViewport: () => Promise<void>
}

export interface ReactTextImportOptions {
  cssText?: string
  documentName?: string
  stateValues?: unknown[]
}

export function createReactImportActions({
  editor,
  state,
  setDocumentSource,
  fitCurrentPageToViewport
}: ReactImportOptions) {
  async function reconcileReactText(source: string, options: ReactTextImportOptions) {
    const page = editor.graph.getNode(state.currentPageId)
    if (!page || !hasReactDocumentSource(page)) return null
    const before = editor.snapshotPage()
    const document = await reactSourceToDesignDocument(source, {
      cssText: options.cssText,
      stateValues: options.stateValues
    })
    const result = reconcileDesignDocumentToSceneGraph(editor.graph, document, {
      parentId: page.id,
      pageName: options.documentName ?? page.name
    })
    computeAllLayouts(editor.graph, page.id)
    const after = editor.snapshotPage()
    editor.pushUndoEntry({
      label: 'Re-import React design',
      forward: () => editor.restorePageFromSnapshot(after),
      inverse: () => editor.restorePageFromSnapshot(before)
    })
    editor.select(result.rootIds)
    return result
  }

  async function importReactText(source: string, options: ReactTextImportOptions = {}) {
    try {
      state.loading = true
      await yieldToUI()
      const pageName = options.documentName ?? 'React Design'
      const reconciled = await reconcileReactText(source, options)
      if (reconciled) {
        state.documentName = pageName
        setDocumentSource(`${pageName}.tsx`, 'tsx')
        await fitCurrentPageToViewport()
        editor.requestRender()
        toast.info(
          `React re-imported · ${reconciled.updated} updated · ${reconciled.preservedOverrides} canvas overrides kept`
        )
        return pageName
      }
      const graph = await reactSourceToSceneGraph(source, {
        cssText: options.cssText,
        pageName,
        stateValues: options.stateValues
      })
      await yieldToUI()
      await applyImportedDocument(editor, graph)
      state.documentName = pageName
      setDocumentSource(`${pageName}.tsx`, 'tsx')
      await fitCurrentPageToViewport()
      editor.requestRender()
      toast.info('React converted to native editable layers')
      return pageName
    } catch (error) {
      console.error('Failed to import React source:', error)
      toast.error(
        `Failed to import React: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    } finally {
      state.loading = false
    }
  }

  return { importReactText }
}
