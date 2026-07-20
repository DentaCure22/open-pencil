import type { Editor, EditorState } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { writeMarkdownDocument } from '@open-pencil/core/io/formats/markdown'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createAutosave } from '@/app/document/autosave'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'
import { IS_TAURI } from '@/constants'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

const SOURCE_WRITABLE_FORMATS = new Set(['fig', 'markdown', 'html', 'jsx', 'tsx'])

export { createDocumentSourceState }

type DocumentSourceOptions = {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getFileHandle: () => FileSystemFileHandle | null
  setFileHandle: (handle: FileSystemFileHandle | null) => void
  getFilePath: () => string | null
  setFilePath: (path: string | null) => void
  getDownloadName: () => string | null
  setDownloadName: (name: string | null) => void
  getSourceFormat: () => string | null
  setSourceFormat: (format: string | null) => void
  getSavedVersion: () => number
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  getRenderer: () => Editor['renderer']
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getSourceFormat,
  setSourceFormat,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer
}: DocumentSourceOptions) {
  function buildFigFile() {
    return exportFigFile(editor.graph, undefined, getRenderer() ?? undefined, state.currentPageId)
  }

  const {
    saveFigFile: saveNativeFigFile,
    saveFigFileAs,
    writeFile
  } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    }
  })

  function getWritableDocumentSource() {
    const filePath = getFilePath()
    if (filePath && IS_TAURI) {
      return { kind: 'tauri-file' as const, label: filePath }
    }
    const fileHandle = getFileHandle()
    if (fileHandle) {
      return { kind: 'browser-file-handle' as const, label: fileHandle.name }
    }
    return null
  }

  function sourceDocumentNode(format: string): SceneNode | null {
    for (const node of editor.graph.getAllNodes()) {
      if (readContentSource(node)?.format === format) return node
    }
    return null
  }

  async function writeCurrentSource(): Promise<void> {
    const format = getSourceFormat()
    if (!format || format === 'fig') {
      await writeFile(await buildFigFile())
      return
    }

    if (format === 'markdown') {
      const document = sourceDocumentNode(format)
      if (!document) throw new Error('Markdown source document is missing')
      const previousPluginData = structuredClone(document.pluginData)
      const result = writeMarkdownDocument(editor.graph)
      try {
        await writeFile(new TextEncoder().encode(result.source))
      } catch (error) {
        editor.graph.updateNode(document.id, { pluginData: previousPluginData })
        throw error
      }
      return
    }

    const document = sourceDocumentNode(format)
    const source = document ? readContentSource(document)?.source : null
    if (source === null || source === undefined) {
      throw new Error(`${format.toUpperCase()} source document is missing`)
    }
    await writeFile(new TextEncoder().encode(source))
  }

  async function saveFigFile() {
    if (getSourceFormat() !== 'fig' && getWritableDocumentSource()) {
      await writeCurrentSource()
      return
    }
    await saveNativeFigFile()
  }

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource: () => Boolean(getWritableDocumentSource()),
    saveCurrentDocument: writeCurrentSource
  })

  async function persistWritableDocumentSource(): Promise<boolean> {
    if (!getWritableDocumentSource()) return false
    try {
      await writeCurrentSource()
      return true
    } catch (error) {
      console.warn('[Document IO] durable source save failed', error)
      return false
    }
  }

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    const hasWritableFormat = SOURCE_WRITABLE_FORMATS.has(sourceFormat)
    setSourceFormat(sourceFormat)
    setFileHandle(hasWritableFormat ? (handle ?? null) : null)
    setFilePath(hasWritableFormat ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    setSavedVersion(state.sceneVersion)
    if (sourceFormat === 'fig' && (handle || path)) {
      void startWatchingFile()
    }
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(path)
    setSourceFormat('fig')
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    stopWatchingFile()
    disposeAutosave()
  }

  return {
    setDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile,
    saveFigFileAs,
    getWritableDocumentSource,
    persistWritableDocumentSource
  }
}
