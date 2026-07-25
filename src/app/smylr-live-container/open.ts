import type { Editor, EditorState } from '@open-pencil/core/editor'

import { applyImportedDocument } from '@/app/document/io/imported-document'

import { parseSmylrLiveContainerClipboardText } from './clipboard-packet'
import { sampleSmylrLiveContainerDocument } from './sample'
import { smylrLiveContainerToSceneGraph } from './to-scene-graph'
import type { SmylrLiveContainerDocument } from './types'

export type SmylrLiveContainerEditorState = EditorState & {
  documentName: string
  loading: boolean
  smylrLiveContainer: SmylrLiveContainerDocument | null
}

type SmylrLiveContainerOpenOptions = {
  editor: Editor
  fitCurrentPageToViewport: () => Promise<void>
  state: SmylrLiveContainerEditorState
}

export function createSmylrLiveContainerOpenActions({
  editor,
  fitCurrentPageToViewport,
  state
}: SmylrLiveContainerOpenOptions) {
  async function openSmylrLiveContainerDocument(document: SmylrLiveContainerDocument) {
    state.loading = true

    try {
      const graph = smylrLiveContainerToSceneGraph(document)

      await applyImportedDocument(editor, graph)
      state.documentName = document.title
      state.smylrLiveContainer = document
      await fitCurrentPageToViewport()
      editor.requestRender()
    } finally {
      state.loading = false
    }
  }

  function getSmylrLiveContainerDocument() {
    return state.smylrLiveContainer
  }

  async function readClipboardText() {
    if (!navigator.clipboard?.readText) {
      throw new Error('Clipboard read is not available in this browser.')
    }

    return navigator.clipboard.readText()
  }

  async function openSmylrLiveContainerClipboardDocument(
    readText: () => Promise<string> = readClipboardText
  ) {
    const text = await readText()
    const document = parseSmylrLiveContainerClipboardText(text)

    if (!document) {
      throw new Error('Clipboard does not contain a Smylr live container packet.')
    }

    await openSmylrLiveContainerDocument(document)
  }

  async function openSampleSmylrLiveContainerDocument() {
    await openSmylrLiveContainerDocument(sampleSmylrLiveContainerDocument)
  }

  return {
    getSmylrLiveContainerDocument,
    openSmylrLiveContainerClipboardDocument,
    openSampleSmylrLiveContainerDocument,
    openSmylrLiveContainerDocument
  }
}
