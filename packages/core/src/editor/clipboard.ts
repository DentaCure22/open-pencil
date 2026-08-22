import type { SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import {
  importClipboardNodes,
  parseFigmaClipboard,
  parseOpenPencilClipboard
} from '#core/clipboard'
import { computeAllLayouts } from '#core/layout'

import { createClipboardCopyActions } from './clipboard/copy'
import { createClipboardExportActions } from './clipboard/export'
import { createClipboardFontActions } from './clipboard/fonts'
import { deleteIds, recreateSnapshots, restoreDeletedEntries } from './clipboard/history'
import { createClipboardImageActions } from './clipboard/images'
import { replaceTargetsWithCreated, selectedReplacementTargets } from './clipboard/paste-replace'
import { resolvePasteTarget } from './clipboard/paste-target'
import { createClipboardPlacementActions } from './clipboard/placement'
import { collectSubtrees, restoreSubtree, snapshotSubtree } from './clipboard/subtree-history'
import { detachOutsideFrameMembership } from './structure/overflow'
import type { EditorContext } from './types'

type PasteOptions = {
  replaceSelection?: boolean
}

export function createClipboardActions(ctx: EditorContext) {
  function duplicateNodeToParent(
    sourceId: string,
    parentId: string,
    overrides: Partial<SceneNode> = {},
    label = 'Duplicate'
  ): SceneNode | null {
    const source = ctx.graph.getNode(sourceId)
    const parent = ctx.graph.getNode(parentId)
    if (!source || !parent) return null
    const clone = ctx.graph.cloneTree(source.id, parent.id, overrides)
    if (!clone) return null
    const snapshots = snapshotSubtree(ctx.graph, clone.id)
    ctx.undo.push({
      forward: () => {
        const snapshot = snapshots.get(clone.id)
        if (snapshot) restoreSubtree(ctx.graph, snapshot, parent.id, snapshots)
      },
      inverse: () => ctx.graph.deleteNode(clone.id),
      label
    })
    return clone
  }

  function duplicateSelected(selectedNodes: SceneNode[]) {
    const prevSelection = new Set(ctx.state.selectedIds)
    const selectedSet = new Set(selectedNodes.map((node) => node.id))
    const topLevel = selectedNodes.filter(
      (node) => !node.parentId || !selectedSet.has(node.parentId)
    )

    const newRootIds: string[] = []
    const allSnapshots = new Map<string, SceneNode>()

    for (const node of topLevel) {
      const parentId = node.parentId ?? ctx.state.currentPageId
      const clone = ctx.graph.cloneTree(node.id, parentId, {
        name: node.name + ' copy',
        x: node.x + 20,
        y: node.y + 20
      })
      if (!clone) continue
      newRootIds.push(clone.id)
      const subtree = snapshotSubtree(ctx.graph, clone.id)
      for (const [id, snap] of subtree) allSnapshots.set(id, snap)
    }

    if (newRootIds.length > 0) {
      ctx.setSelectedIds(new Set(newRootIds))
      ctx.undo.push({
        label: 'Duplicate',
        forward: () => {
          for (const rootId of newRootIds) {
            const snapshot = allSnapshots.get(rootId)
            if (!snapshot) continue
            const parentId = snapshot.parentId ?? ctx.state.currentPageId
            restoreSubtree(ctx.graph, snapshot, parentId, allSnapshots)
          }
          ctx.setSelectedIds(new Set(newRootIds))
        },
        inverse: () => {
          for (const id of newRootIds.slice().reverse()) ctx.graph.deleteNode(id)
          ctx.setSelectedIds(prevSelection)
        }
      })
    }
  }

  function pushPasteUndo(created: string[], prevSelection: Set<string>) {
    const allNodes = collectSubtrees(ctx.graph, created)
    const pageId = ctx.state.currentPageId
    ctx.undo.push({
      label: 'Paste',
      forward: () => {
        recreateSnapshots(ctx, allNodes, pageId)
        computeAllLayouts(ctx.graph, pageId)
        ctx.setSelectedIds(new Set(created))
      },
      inverse: () => {
        deleteIds(ctx, created)
        computeAllLayouts(ctx.graph, pageId)
        ctx.setSelectedIds(prevSelection)
      }
    })
  }

  async function pasteFromHTML(html: string, cursorPos?: Vector, options: PasteOptions = {}) {
    const openPencil = parseOpenPencilClipboard(html)
    if (openPencil) {
      pasteOpenPencilNodes(
        openPencil.nodes,
        openPencil.images,
        cursorPos,
        options,
        openPencil.variables,
        openPencil.variableCollections,
        openPencil.activeMode
      )
      return
    }

    const figma = await parseFigmaClipboard(html)
    if (figma) {
      const prevSelection = new Set(ctx.state.selectedIds)
      const replacementTargets = options.replaceSelection ? selectedReplacementTargets(ctx) : []
      const pasteTarget = replacementTargets[0]?.parentId ?? resolvePasteTarget(ctx)
      const created = importClipboardNodes(figma.nodes, ctx.graph, pasteTarget, 0, 0, figma.blobs)
      if (created.length > 0) {
        if (replacementTargets.length > 0) {
          replaceTargetsWithCreated(
            ctx,
            placementActions.centerNodesAt,
            created,
            replacementTargets,
            prevSelection
          )
          void fontActions.loadFontsForNodes(created)
          warnMissingImages(created)
          ctx.requestRender()
          return
        }
        const { width: viewW, height: viewH } = ctx.getViewportSize()
        const cx = cursorPos?.x ?? (-ctx.state.panX + viewW / 2) / ctx.state.zoom
        const cy = cursorPos?.y ?? (-ctx.state.panY + viewH / 2) / ctx.state.zoom
        placementActions.centerNodesAt(created, cx, cy)
        computeAllLayouts(ctx.graph, ctx.state.currentPageId)
        ctx.setSelectedIds(new Set(created))

        pushPasteUndo(created, prevSelection)
        void fontActions.loadFontsForNodes(created)
        warnMissingImages(created)
        ctx.requestRender()
      }
    }
  }

  function pasteOpenPencilNodes(
    nodes: Array<SceneNode & { children?: SceneNode[] }>,
    images: Map<string, Uint8Array>,
    cursorPos?: Vector,
    options: PasteOptions = {},
    variables?: Array<[string, unknown]>,
    variableCollections?: Array<[string, unknown]>,
    activeMode?: Array<[string, string]>
  ) {
    const prevSelection = new Set(ctx.state.selectedIds)
    const replacementTargets = options.replaceSelection ? selectedReplacementTargets(ctx) : []
    for (const [hash, bytes] of images) ctx.graph.images.set(hash, bytes)
    // Restore variable resources so boundVariables on pasted nodes resolve.
    if (variableCollections) {
      for (const [id, collection] of variableCollections) {
        if (!ctx.graph.variableCollections.has(id)) {
          ctx.graph.variableCollections.set(id, structuredClone(collection) as never)
        }
      }
    }
    if (variables) {
      for (const [id, variable] of variables) {
        if (!ctx.graph.variables.has(id)) {
          ctx.graph.variables.set(id, structuredClone(variable) as never)
        }
      }
    }
    if (activeMode) {
      for (const [collectionId, modeId] of activeMode) {
        if (!ctx.graph.activeMode.has(collectionId)) {
          ctx.graph.activeMode.set(collectionId, modeId)
        }
      }
    }

    const created: string[] = []
    const createNodeTree = (
      source: SceneNode & { children?: SceneNode[] },
      parentId: string,
      offsetRoot: boolean
    ) => {
      const { id: _id, childIds: _childIds, children = [], parentId: _parentId, ...rest } = source
      const node = ctx.graph.createNode(source.type, parentId, {
        ...structuredClone(rest),
        x: source.x + (offsetRoot ? 20 : 0),
        y: source.y + (offsetRoot ? 20 : 0),
        childIds: []
      })
      for (const child of children) createNodeTree(child, node.id, false)
      return node.id
    }

    const pasteTarget = replacementTargets[0]?.parentId ?? resolvePasteTarget(ctx)
    for (const node of nodes) created.push(createNodeTree(node, pasteTarget, true))
    if (created.length === 0) return

    if (replacementTargets.length > 0) {
      replaceTargetsWithCreated(
        ctx,
        placementActions.centerNodesAt,
        created,
        replacementTargets,
        prevSelection
      )
      return
    }

    if (cursorPos) placementActions.centerNodesAt(created, cursorPos.x, cursorPos.y)
    computeAllLayouts(ctx.graph, ctx.state.currentPageId)
    ctx.setSelectedIds(new Set(created))

    pushPasteUndo(created, prevSelection)
  }

  function warnMissingImages(nodeIds: string[]) {
    const allNodes = collectSubtrees(ctx.graph, nodeIds)
    return allNodes.some((n) =>
      n.fills.some((f) => f.type === 'IMAGE' && f.imageHash && !ctx.graph.images.has(f.imageHash))
    )
  }

  function deleteSelected() {
    detachOutsideFrameMembership(ctx, ctx.state.selectedIds)
    const entries: Array<{
      id: string
      parentId: string
      index: number
      subtree: Map<string, SceneNode>
    }> = []
    const selectedIds = new Set(ctx.state.selectedIds)
    for (const id of selectedIds) {
      const node = ctx.graph.getNode(id)
      if (!node || node.locked) continue
      const parentId = node.parentId ?? ctx.state.currentPageId
      const parent = ctx.graph.getNode(parentId)
      const index = parent?.childIds.indexOf(id) ?? -1
      entries.push({ id, parentId, index, subtree: snapshotSubtree(ctx.graph, id) })
    }
    if (entries.length === 0) return

    const relayoutParents = () => {
      for (const parentId of new Set(entries.map((entry) => entry.parentId))) {
        ctx.runLayoutForNode(parentId)
      }
    }

    const prevSelection = new Set(ctx.state.selectedIds)
    for (const { id } of entries) ctx.graph.deleteNode(id)
    relayoutParents()

    ctx.undo.push({
      label: 'Delete',
      forward: () => {
        for (const { id } of entries) ctx.graph.deleteNode(id)
        relayoutParents()
        ctx.setSelectedIds(new Set())
      },
      inverse: () => {
        restoreDeletedEntries(ctx, entries)
        relayoutParents()
        ctx.setSelectedIds(prevSelection)
      }
    })
    ctx.setSelectedIds(new Set())
  }

  const copyActions = createClipboardCopyActions(ctx)
  const exportActions = createClipboardExportActions(ctx)
  const fontActions = createClipboardFontActions(ctx)
  const imageActions = createClipboardImageActions(ctx)
  const placementActions = createClipboardPlacementActions(ctx)

  return {
    collectSubtrees,
    ...placementActions,
    ...fontActions,
    duplicateNodeToParent,
    duplicateSelected,
    ...copyActions,
    pasteFromHTML,
    warnMissingImages,
    deleteSelected,
    ...imageActions,
    ...exportActions
  }
}
