import type { AutomationDocumentSummary } from '@open-pencil/core/rpc'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { getTabForStore, getTabsSnapshot, type Tab } from '@/app/tabs'
import { openPencilWorkspaceId } from '@/app/workspace-document/identity'

export type UnknownRecord = { [key: string]: unknown }

export type AutomationTargetArgs = {
  document_id?: unknown
  document_name?: unknown
  page_id?: unknown
  page_name?: unknown
  workspace_id?: unknown
}

export function isUnknownRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export type AutomationTarget = {
  store: EditorStore
  documentId: string
  documentName: string
  path?: string
  pageId: string
  pageName: string
  workspaceId?: string
}

export type AutomationTargetResult = Omit<AutomationTarget, 'store'> & { boardRevision: number }

export function stripAutomationTargetArgs(args: UnknownRecord): UnknownRecord {
  const {
    document_id: _documentId,
    document_name: _documentName,
    page_id: _pageId,
    page_name: _pageName,
    workspace_id: _workspaceId,
    ...rest
  } = args
  return rest
}

export function targetToResult(target: AutomationTarget): AutomationTargetResult {
  return {
    boardRevision: target.store.state.sceneVersion,
    documentId: target.documentId,
    documentName: target.documentName,
    ...(target.path ? { path: target.path } : {}),
    pageId: target.pageId,
    pageName: target.pageName,
    ...(target.workspaceId ? { workspaceId: target.workspaceId } : {})
  }
}

export function responseWithTarget(
  body: unknown,
  target: AutomationTarget
): Record<string, unknown> {
  const targetResult = targetToResult(target)
  if (isUnknownRecord(body)) {
    return { ...body, target: targetResult }
  }
  return { ok: true, result: body, target: targetResult }
}

export function listAutomationDocuments(activeStore: EditorStore): AutomationDocumentSummary[] {
  const activeTab = getTabForStore(activeStore)
  return getTabsSnapshot().map((tab) => {
    const workspaceId = openPencilWorkspaceId(tab.store.graph)
    const pages = tab.store.graph.getPages().map((page) => ({ id: page.id, name: page.name }))
    const currentPage = tab.store.graph.getNode(tab.store.state.currentPageId)
    const path = tab.store.getDocumentFilePath()
    return {
      id: tab.id,
      name: tab.store.state.documentName,
      ...(path ? { path } : {}),
      active: tab.id === activeTab?.id,
      current_page_id: tab.store.state.currentPageId,
      current_page_name: currentPage?.name ?? '',
      kind: workspaceId ? 'workspace' : 'document',
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      pages
    }
  })
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function documentNotFoundMessage(
  requestedDocumentId: string | undefined,
  requestedDocumentName: string | undefined,
  requestedWorkspaceId: string | undefined
): string {
  if (requestedWorkspaceId) return `Workspace "${requestedWorkspaceId}" not found`
  if (requestedDocumentId) return `Document "${requestedDocumentId}" not found`
  if (requestedDocumentName) return `Document named "${requestedDocumentName}" not found`
  return 'No active OpenPencil document'
}

function workspaceTabs(tabs: Tab[]): Tab[] {
  return tabs.filter((tab) => openPencilWorkspaceId(tab.store.graph))
}

function uniqueWorkspaceTab(tabs: Tab[], workspaceId: string): Tab | undefined {
  const matches = workspaceTabs(tabs).filter(
    (tab) => openPencilWorkspaceId(tab.store.graph) === workspaceId
  )
  if (matches.length <= 1) return matches[0]
  throw new Error(
    `Workspace "${workspaceId}" is open more than once: ${matches
      .map((candidate) => candidate.id)
      .join(', ')}`
  )
}

function uniqueNamedTab(tabs: Tab[], documentName: string): Tab | undefined {
  const matches = tabs.filter((candidate) => candidate.store.state.documentName === documentName)
  if (matches.length <= 1) return matches[0]
  throw new Error(
    `Document name "${documentName}" is ambiguous: ${matches
      .map((candidate) => candidate.id)
      .join(', ')}`
  )
}

function defaultWorkspaceTab(tabs: Tab[]): Tab | undefined {
  const matches = workspaceTabs(tabs)
  if (matches.length <= 1) return matches[0]
  const workspaceIds = matches.flatMap((candidate) => {
    const workspaceId = openPencilWorkspaceId(candidate.store.graph)
    return workspaceId ? [workspaceId] : []
  })
  throw new Error(`Multiple OpenPencil workspaces are open: ${workspaceIds.join(', ')}`)
}

function validateResolvedTab(
  tab: Tab,
  requestedDocumentId: string | undefined,
  requestedDocumentName: string | undefined,
  requestedWorkspaceId: string | undefined
) {
  if (requestedDocumentId && tab.id !== requestedDocumentId) {
    throw new Error(
      `Workspace "${requestedWorkspaceId}" is document "${tab.id}", not "${requestedDocumentId}"`
    )
  }
  if (requestedDocumentName && tab.store.state.documentName !== requestedDocumentName) {
    throw new Error(
      `Document "${tab.id}" is named "${tab.store.state.documentName}", not "${requestedDocumentName}"`
    )
  }
  if (requestedWorkspaceId && openPencilWorkspaceId(tab.store.graph) !== requestedWorkspaceId) {
    throw new Error(`Document "${tab.id}" is not workspace "${requestedWorkspaceId}"`)
  }
}

export function resolveAutomationTabFromTabs(
  tabs: Tab[],
  activeStore: EditorStore,
  requestedDocumentId: string | undefined,
  requestedDocumentName: string | undefined,
  requestedWorkspaceId: string | undefined
): Tab {
  let tab: Tab | undefined
  if (requestedWorkspaceId) {
    tab = uniqueWorkspaceTab(tabs, requestedWorkspaceId)
  } else if (requestedDocumentId) {
    tab = tabs.find((candidate) => candidate.id === requestedDocumentId)
  } else if (requestedDocumentName) {
    tab = uniqueNamedTab(tabs, requestedDocumentName)
  } else {
    tab = defaultWorkspaceTab(tabs) ?? tabs.find((candidate) => candidate.store === activeStore)
  }
  if (!tab) {
    throw new Error(
      documentNotFoundMessage(requestedDocumentId, requestedDocumentName, requestedWorkspaceId)
    )
  }
  validateResolvedTab(tab, requestedDocumentId, requestedDocumentName, requestedWorkspaceId)
  return tab
}

function resolveAutomationPage(
  tab: Tab,
  requestedPageId: string | undefined,
  requestedPageName: string | undefined
): SceneNode {
  const pageNameMatches = requestedPageName
    ? tab.store.graph.getPages().filter((candidate) => candidate.name === requestedPageName)
    : []
  if (pageNameMatches.length > 1) {
    throw new Error(
      `Page name "${requestedPageName}" is ambiguous in document "${tab.id}": ${pageNameMatches
        .map((candidate) => candidate.id)
        .join(', ')}`
    )
  }
  const pageId = requestedPageId ?? pageNameMatches[0]?.id ?? tab.store.state.currentPageId
  const page = tab.store.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') {
    throw new Error(`Page "${pageId}" not found in document "${tab.id}"`)
  }
  if (requestedPageName && page.name !== requestedPageName) {
    throw new Error(`Page "${page.id}" is named "${page.name}", not "${requestedPageName}"`)
  }
  return page
}

export function resolveAutomationTarget(
  activeStore: EditorStore,
  args: AutomationTargetArgs | undefined
): AutomationTarget {
  const requestedDocumentId = readString(args?.document_id)
  const requestedDocumentName = readString(args?.document_name)
  const requestedWorkspaceId = readString(args?.workspace_id)
  const tab = resolveAutomationTabFromTabs(
    getTabsSnapshot(),
    activeStore,
    requestedDocumentId,
    requestedDocumentName,
    requestedWorkspaceId
  )
  const requestedPageId = readString(args?.page_id)
  const requestedPageName = readString(args?.page_name)
  const page = resolveAutomationPage(tab, requestedPageId, requestedPageName)

  const path = tab.store.getDocumentFilePath()
  const workspaceId = openPencilWorkspaceId(tab.store.graph)
  return {
    store: tab.store,
    documentId: tab.id,
    documentName: tab.store.state.documentName,
    ...(path ? { path } : {}),
    pageId: page.id,
    pageName: page.name,
    ...(workspaceId ? { workspaceId } : {})
  }
}
