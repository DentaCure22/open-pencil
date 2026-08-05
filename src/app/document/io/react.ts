import type { Editor, EditorState } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'
import {
  hasReactDocumentSource,
  patchReactInlineStyle,
  reactDocumentSourceForNode,
  reactSourceToDesignDocument,
  reactSourceToSceneGraph,
  reconcileDesignDocumentToSceneGraph,
  sourceIdForNode,
  type ReactStylePatchResult,
  type ReconcileDesignDocumentResult
} from '@open-pencil/dom-css/browser'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  reconcileBoardPage,
  type BoardPermissionDescriptor,
  type BoardPageReconciliationProvenance
} from '@/app/board-permissions'
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

const REACT_STYLE_PROPERTY_BY_SCENE_FIELD = {
  width: 'width',
  height: 'height',
  minWidth: 'minWidth',
  maxWidth: 'maxWidth',
  minHeight: 'minHeight',
  maxHeight: 'maxHeight',
  opacity: 'opacity',
  cornerRadius: 'borderRadius',
  fontSize: 'fontSize',
  fontWeight: 'fontWeight',
  lineHeight: 'lineHeight',
  letterSpacing: 'letterSpacing',
  itemSpacing: 'gap',
  paddingTop: 'paddingTop',
  paddingRight: 'paddingRight',
  paddingBottom: 'paddingBottom',
  paddingLeft: 'paddingLeft'
} as const

export type ReactDesignStyleField = keyof typeof REACT_STYLE_PROPERTY_BY_SCENE_FIELD

export interface ReactDesignStylePatchRequest {
  field: ReactDesignStyleField
  nodeId?: string
}

export interface ReadyReactDesignStylePatch {
  status: 'ready'
  field: ReactDesignStyleField
  nodeId: string
  pageId: string
  patch: ReactStylePatchResult
  sourceBefore: string
  sourceId: string
}

export interface RejectedReactDesignStylePatch {
  status: 'rejected'
  field: ReactDesignStyleField
  nodeId: string | null
  reason: string
  sourceId: string | null
}

export type ReactDesignStylePatchProposal =
  | ReadyReactDesignStylePatch
  | RejectedReactDesignStylePatch

export interface AppliedReactDesignStylePatch {
  proposal: ReadyReactDesignStylePatch
  reconciliation: ReconcileDesignDocumentResult
}

function applyReactPageReconciliation<TResult>(
  editor: Editor,
  page: SceneNode,
  provenance: BoardPageReconciliationProvenance,
  label: string,
  apply: () => TResult
): TResult {
  const descriptor: BoardPermissionDescriptor = {
    actorId: 'openpencil-react-design',
    defaultOrigin: { height: page.height, width: page.width, x: page.x, y: page.y },
    labels: {
      create: 'Create React design layer',
      delete: 'Delete React design layer',
      update: label
    },
    marker: {
      key: 'page-id',
      pluginId: 'openpencil-react-design',
      value: page.id
    },
    name: 'React Static Design reconciliation',
    pageId: page.id,
    permissions: ['page.reconcile']
  }
  const receipt = reconcileBoardPage(editor, descriptor, {
    apply,
    label,
    provenance,
    type: 'board.page.reconcile'
  })
  if (receipt.status === 'denied' || receipt.result === undefined) {
    throw new Error(`React design reconciliation denied: ${receipt.reason ?? 'action-failed'}`)
  }
  return receipt.result
}

function selectedNodeId(editor: Editor, requestedNodeId: string | undefined): string | null {
  if (requestedNodeId) return requestedNodeId
  const selectedIds = [...editor.state.selectedIds]
  return selectedIds.length === 1 ? (selectedIds[0] ?? null) : null
}

function nodeBelongsToPage(editor: Editor, node: SceneNode, pageId: string): boolean {
  let current: SceneNode | undefined = node
  while (current) {
    if (current.id === pageId) return true
    current = current.parentId ? editor.graph.getNode(current.parentId) : undefined
  }
  return false
}

function rejectedProposal(
  request: ReactDesignStylePatchRequest,
  reason: string,
  nodeId: string | null,
  sourceId: string | null = null
): RejectedReactDesignStylePatch {
  return { status: 'rejected', field: request.field, nodeId, reason, sourceId }
}

/**
 * Build one reviewable TSX edit from the current value of one supported native field.
 * This is deliberately read-only: callers must present or otherwise approve the exact patch before
 * passing it to applyReactDesignStylePatch().
 */
export function proposeReactDesignStylePatch(
  editor: Editor,
  request: ReactDesignStylePatchRequest
): ReactDesignStylePatchProposal {
  const nodeId = selectedNodeId(editor, request.nodeId)
  if (!nodeId) {
    return rejectedProposal(request, 'Select exactly one source-linked native layer', null)
  }
  const page = editor.graph.getNode(editor.state.currentPageId)
  const source = page ? reactDocumentSourceForNode(page) : null
  if (!page || !source) {
    return rejectedProposal(request, 'The current Board is not linked to React source', nodeId)
  }
  const node = editor.graph.getNode(nodeId)
  if (!node || !nodeBelongsToPage(editor, node, page.id)) {
    return rejectedProposal(
      request,
      'The selected native layer is not on the current Board',
      nodeId
    )
  }
  const sourceId = sourceIdForNode(node)
  if (!sourceId) {
    return rejectedProposal(request, 'The selected native layer has no stable source ID', nodeId)
  }

  const value = node[request.field]
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return rejectedProposal(
      request,
      `${request.field} cannot be represented as one literal React style value`,
      nodeId,
      sourceId
    )
  }

  try {
    const patch = patchReactInlineStyle(source.code, {
      sourceId,
      property: REACT_STYLE_PROPERTY_BY_SCENE_FIELD[request.field],
      value
    })
    return {
      status: 'ready',
      field: request.field,
      nodeId,
      pageId: page.id,
      patch,
      sourceBefore: source.code,
      sourceId
    }
  } catch (error) {
    return rejectedProposal(
      request,
      error instanceof Error ? error.message : String(error),
      nodeId,
      sourceId
    )
  }
}

/**
 * Apply an already-reviewed proposal, re-import it into the same native page, and record the source
 * plus SceneGraph reconciliation as one Undo entry. Stale proposals are rejected.
 */
export async function applyReactDesignStylePatch(
  editor: Editor,
  proposal: ReadyReactDesignStylePatch
): Promise<AppliedReactDesignStylePatch> {
  const page = editor.graph.getNode(proposal.pageId)
  const source = page ? reactDocumentSourceForNode(page) : null
  const node = editor.graph.getNode(proposal.nodeId)
  if (!page || page.id !== editor.state.currentPageId || !source || !node) {
    throw new Error('The React design patch target is no longer available')
  }
  if (source.code !== proposal.sourceBefore || sourceIdForNode(node) !== proposal.sourceId) {
    throw new Error('The React design source changed after this patch was proposed')
  }
  const currentProposal = proposeReactDesignStylePatch(editor, {
    field: proposal.field,
    nodeId: proposal.nodeId
  })
  if (
    currentProposal.status !== 'ready' ||
    currentProposal.pageId !== proposal.pageId ||
    currentProposal.patch.code !== proposal.patch.code ||
    currentProposal.patch.start !== proposal.patch.start ||
    currentProposal.patch.end !== proposal.patch.end ||
    currentProposal.patch.replacement !== proposal.patch.replacement
  ) {
    throw new Error('The native layer changed after this React design patch was proposed')
  }

  const document = await reactSourceToDesignDocument(proposal.patch.code, {
    componentName: source.componentName,
    cssText: source.cssText,
    stateValues: source.states?.map((state) => state.value)
  })
  const reconciliation = applyReactPageReconciliation(
    editor,
    page,
    { operation: 'react-design.patch', sourceId: proposal.sourceId },
    `Update React ${proposal.patch.message}`,
    () => {
      const result = reconcileDesignDocumentToSceneGraph(editor.graph, document, {
        parentId: page.id,
        pageName: page.name
      })
      computeAllLayouts(editor.graph, page.id)
      return result
    }
  )
  editor.select([proposal.nodeId])
  return { proposal, reconciliation }
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
    const retainedSource = reactDocumentSourceForNode(page)
    const document = await reactSourceToDesignDocument(source, {
      cssText: options.cssText ?? retainedSource?.cssText,
      stateValues: options.stateValues ?? retainedSource?.states?.map((item) => item.value)
    })
    const result = applyReactPageReconciliation(
      editor,
      page,
      { operation: 'react-design.reimport' },
      'Re-import React design',
      () => {
        const reconciliation = reconcileDesignDocumentToSceneGraph(editor.graph, document, {
          parentId: page.id,
          pageName: options.documentName ?? page.name
        })
        computeAllLayouts(editor.graph, page.id)
        return reconciliation
      }
    )
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

  return {
    applyReactDesignStylePatch: (proposal: ReadyReactDesignStylePatch) =>
      applyReactDesignStylePatch(editor, proposal),
    importReactText,
    proposeReactDesignStylePatch: (request: ReactDesignStylePatchRequest) =>
      proposeReactDesignStylePatch(editor, request)
  }
}
