import { shallowRef, computed, triggerRef } from 'vue'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { readFigFile } from '@open-pencil/core/io/formats/fig'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { setOpenPencilStore } from '@/app/browser-bridge'
import { createCodeObject, createUserCodeObjectDocument } from '@/app/code-object/model'
import { setActiveEditorStore } from '@/app/editor/active-store'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { placeFileIntakeFiles } from '@/app/file-intake/intake'
import { openPencilWorkspaceId } from '@/app/workspace-document/identity'

export interface Tab {
  id: string
  store: EditorStore
}

const io = new IORegistry(BUILTIN_IO_FORMATS)

let nextTabId = 1

function generateTabId(): string {
  return `tab-${nextTabId++}`
}

const tabsRef = shallowRef<Tab[]>([])
const activeTabId = shallowRef('')

export const activeTab = computed(() => tabsRef.value.find((t) => t.id === activeTabId.value))

export const allTabs = computed(() =>
  tabsRef.value.map((t) => {
    void t.store.state.sceneVersion
    const workspaceId = openPencilWorkspaceId(t.store.graph)
    return {
      id: t.id,
      name: t.store.state.documentName,
      isActive: t.id === activeTabId.value,
      isWorkspace: workspaceId !== null,
      workspaceId
    }
  })
)

export function getActiveStore(): EditorStore {
  const tab = tabsRef.value.find((t) => t.id === activeTabId.value)
  if (!tab) throw new Error('No active tab')
  return tab.store
}

export function getActiveTabId(): string {
  return activeTabId.value
}

export function getTabById(tabId: string): Tab | undefined {
  return tabsRef.value.find((tab) => tab.id === tabId)
}

export function getTabForStore(store: EditorStore): Tab | undefined {
  return tabsRef.value.find((tab) => tab.store === store)
}

export function getTabsSnapshot(): Tab[] {
  return [...tabsRef.value]
}

export function getWorkspaceTabs(workspaceId?: string): Tab[] {
  return tabsRef.value.filter((tab) => {
    const candidateId = openPencilWorkspaceId(tab.store.graph)
    return candidateId !== null && (!workspaceId || candidateId === workspaceId)
  })
}

export function getWorkspaceTab(workspaceId?: string): Tab | undefined {
  return getWorkspaceTabs(workspaceId)[0]
}

export function createTab(store?: EditorStore, initialGraph?: SceneGraph): Tab {
  const s = store ?? createEditorStore(initialGraph)
  const tab: Tab = { id: generateTabId(), store: s }
  tabsRef.value = [...tabsRef.value, tab]
  activateTab(tab)
  return tab
}

function activateTab(tab: Tab) {
  activeTabId.value = tab.id
  setActiveEditorStore(tab.store)
  triggerRef(tabsRef)
  setOpenPencilStore(tab.store)
}

export function switchTab(tabId: string) {
  const tab = tabsRef.value.find((t) => t.id === tabId)
  if (!tab) return
  activateTab(tab)
}

export function closeTab(tabId: string) {
  const idx = tabsRef.value.findIndex((t) => t.id === tabId)
  if (idx === -1) return

  const closingTab = tabsRef.value[idx]
  if (openPencilWorkspaceId(closingTab.store.graph)) return
  const wasActive = activeTabId.value === tabId
  tabsRef.value = tabsRef.value.filter((t) => t.id !== tabId)

  if (tabsRef.value.length === 0) {
    createTab()
    closingTab.store.dispose()
    return
  }

  if (wasActive) {
    const newIdx = Math.min(idx, tabsRef.value.length - 1)
    activateTab(tabsRef.value[newIdx])
  }

  closingTab.store.dispose()
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function codeObjectSourceFormat(fileName: string): 'jsx' | 'tsx' | null {
  const extension = /\.([^.]+)$/i.exec(fileName)?.[1]?.toLowerCase()
  if (extension === 'jsx') return 'jsx'
  if (extension === 'tsx') return 'tsx'
  return null
}

async function openCodeObjectFile(
  store: EditorStore,
  file: File,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<boolean> {
  const format = codeObjectSourceFormat(file.name)
  if (!format) return false

  const name = file.name.replace(/\.[^.]+$/i, '') || 'Code Object'
  const frame = createCodeObject(store, {
    cornerRadius: 12,
    document: createUserCodeObjectDocument({
      definitionId: `file.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      props: {},
      source: await file.text(),
      state: {}
    }),
    height: 520,
    name,
    width: 720,
    x: 96,
    y: 88
  })
  store.undo.clear()
  store.setDocumentSource(file.name, format, handle, path)
  const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
  await store.switchPage(pageId)
  store.select([frame.id])
  await store.fitCurrentPageToViewport()
  return true
}

async function openFileAsSourceObject(store: EditorStore, file: File): Promise<boolean> {
  if (file.name.toLowerCase().endsWith('.fig')) return false
  if (io.findReader(file.name, file.type || undefined)) return false

  const intake = await placeFileIntakeFiles(store, [file], 0, 0)
  store.undo.clear()
  store.setDocumentSource(file.name, 'intake')
  const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
  await store.switchPage(pageId)
  store.select(intake.ids)
  await store.fitCurrentPageToViewport()
  return true
}

export async function openFileInNewTab(
  file: File,
  handle?: FileSystemFileHandle,
  path?: string
): Promise<void> {
  const current = activeTab.value
  const isUntouched = Boolean(
    current?.store.state.documentName === 'Untitled' && !current.store.undo.canUndo
  )
  const targetTab = isUntouched && current ? current : createTab()
  const createdTabId = isUntouched ? null : targetTab.id
  const store = targetTab.store
  const previousDocumentName = store.state.documentName

  const documentName = file.name.replace(/\.[^.]+$/i, '')

  store.state.documentName = documentName
  store.state.loading = true
  await yieldToUI()

  try {
    if (await openCodeObjectFile(store, file, handle, path)) return
    if (await openFileAsSourceObject(store, file)) return

    const isFig = file.name.toLowerCase().endsWith('.fig')
    const { graph: imported, sourceFormat } = isFig
      ? { graph: await readFigFile(file, { populate: 'first-page' }), sourceFormat: 'fig' }
      : await io.readDocument({
          name: file.name,
          mimeType: file.type || undefined,
          data: new Uint8Array(await file.arrayBuffer())
        })

    const importedWorkspaceId = openPencilWorkspaceId(imported)
    const existingWorkspaceTab = importedWorkspaceId
      ? getWorkspaceTab(importedWorkspaceId)
      : undefined
    if (existingWorkspaceTab && existingWorkspaceTab.id !== targetTab.id) {
      switchTab(existingWorkspaceTab.id)
      throw new Error(
        `Workspace "${importedWorkspaceId}" is already open. OpenPencil keeps one live tab per workspace.`
      )
    }

    const firstPageId = imported.getPages()[0]?.id
    if (firstPageId) computeAllLayouts(imported, firstPageId)
    store.replaceGraph(imported)
    store.undo.clear()
    store.setDocumentSource(file.name, sourceFormat, handle, path)
    store.clearSelection()
    const pageId = store.graph.getPages()[0]?.id ?? store.graph.rootId
    await store.switchPage(pageId)
    await store.fitCurrentPageToViewport()
  } catch (error) {
    store.state.loading = false
    if (createdTabId) closeTab(createdTabId)
    else store.state.documentName = previousDocumentName
    throw error
  } finally {
    store.state.loading = false
  }
}

export function tabCount(): number {
  return tabsRef.value.length
}

export function useTabsStore() {
  return {
    tabs: allTabs,
    activeTabId,
    createTab,
    switchTab,
    closeTab,
    getActiveTabId,
    getTabById,
    getTabForStore,
    getTabsSnapshot,
    getWorkspaceTab,
    getWorkspaceTabs,
    openFileInNewTab,
    getActiveStore,
    tabCount
  }
}
