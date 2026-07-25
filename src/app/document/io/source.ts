import type { Editor, EditorState } from '@open-pencil/core/editor'
import {
  applyStructuredDataReconciliation,
  applySVGReconciliation,
  readContentSource,
  reconcileStructuredDataSource,
  reconcileSVGSource,
  type SourceReconciliationResult
} from '@open-pencil/core/io'
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
import { toast } from '@/app/shell/ui'
import { IS_TAURI } from '@/constants'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
}

const SOURCE_WRITABLE_FORMATS = new Set([
  'fig',
  'markdown',
  'html',
  'jsx',
  'tsx',
  'json',
  'csv',
  'svg'
])

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
      const sourceFormat = readContentSource(node)?.format
      if (sourceFormat === format || (format === 'json' && sourceFormat === 'json-schema')) {
        return node
      }
    }
    return null
  }

  function frameOwnedCodeObjectSources(): string[] {
    return [...editor.graph.getAllNodes()].flatMap((node) => {
      const raw = node.pluginData.find(
        (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
      )?.value
      if (!raw) return []
      try {
        const parsed: unknown = JSON.parse(raw)
        if (
          parsed &&
          typeof parsed === 'object' &&
          'source' in parsed &&
          typeof parsed.source === 'string'
        ) {
          return [parsed.source]
        }
      } catch {
        return []
      }
      return []
    })
  }

  function captureReconciliationState(document: SceneNode) {
    const text = editor.graph
      .flattenTree(document.id)
      .map(({ node }) => node)
      .filter((node) => node.type === 'TEXT' && node.name === 'Source reconciliation status')
      .map((node) => ({ id: node.id, text: node.text }))
    return { pluginData: structuredClone(document.pluginData), text }
  }

  function restoreReconciliationState(
    document: SceneNode,
    snapshot: ReturnType<typeof captureReconciliationState>
  ) {
    editor.graph.updateNode(document.id, { pluginData: snapshot.pluginData })
    for (const item of snapshot.text) editor.graph.updateNode(item.id, { text: item.text })
  }

  function sourceReconciliation(
    format: string,
    document: SceneNode
  ): SourceReconciliationResult | null {
    if (format === 'json' || format === 'csv') {
      return reconcileStructuredDataSource(editor.graph, document)
    }
    if (format === 'svg') return reconcileSVGSource(editor.graph, document)
    return null
  }

  function applySourceReconciliation(
    format: string,
    document: SceneNode,
    result: SourceReconciliationResult
  ) {
    if (format === 'json' || format === 'csv') {
      applyStructuredDataReconciliation(editor.graph, document, result)
    } else if (format === 'svg') {
      applySVGReconciliation(editor.graph, document, result)
    }
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

    if (format === 'jsx' || format === 'tsx') {
      const authoredSources = frameOwnedCodeObjectSources()
      if (authoredSources.length === 1) {
        await writeFile(new TextEncoder().encode(authoredSources[0]))
        return
      }
      if (authoredSources.length > 1) {
        throw new Error(`Choose one Code Object before saving ${format.toUpperCase()} source`)
      }
    }

    const document = sourceDocumentNode(format)
    if (!document) throw new Error(`${format.toUpperCase()} source document is missing`)
    const snapshot = captureReconciliationState(document)
    const reconciliation = sourceReconciliation(format, document)
    if (reconciliation) {
      applySourceReconciliation(format, document, reconciliation)
      if (reconciliation.status === 'conflict' || reconciliation.status === 'unsupported') {
        throw new Error(reconciliation.message)
      }
    }

    const source = reconciliation?.source ?? readContentSource(document)?.source
    if (source === undefined) {
      throw new Error(`${format.toUpperCase()} source document is missing`)
    }
    try {
      await writeFile(new TextEncoder().encode(source))
    } catch (error) {
      restoreReconciliationState(document, snapshot)
      throw error
    }
  }

  async function saveFigFile() {
    if (getSourceFormat() !== 'fig' && getWritableDocumentSource()) {
      try {
        await writeCurrentSource()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      }
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
