import { renderTreeNode } from '@open-pencil/core/design-jsx'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import type { JsonObject, Rect } from '@open-pencil/scene-graph/primitives'

import {
  enqueueAutomationMutation,
  type AutomationMutationMetadata
} from '@/app/automation/bridge/mutation-queue'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { ensureGraphFonts } from '@/app/editor/fonts'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

function readViewportBounds(result: unknown): Rect | null {
  if (!result || typeof result !== 'object') return null
  const bounds = (result as JsonObject).bounds
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return null
  const candidate = bounds as JsonObject
  const { height, width, x, y } = candidate
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null
  }
  return { height, width, x, y }
}

export async function syncAutomationToolState(
  store: AutomationTarget['store'],
  figma: FigmaAPI,
  toolName: string,
  result: unknown
) {
  if (store.state.currentPageId !== figma.currentPageId) {
    await store.switchPage(figma.currentPageId)
  }

  store.select(figma.currentPage.selection.map((node) => node.id))

  if (toolName === 'viewport_zoom_to_fit') {
    const bounds = readViewportBounds(result)
    if (bounds) {
      store.zoomToBounds(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)
    }
  }
}

export function createAutomationToolHandler(makeFigma: FigmaFactory) {
  async function handleToolRender(
    target: AutomationTarget,
    toolArgs: Record<string, unknown>
  ): Promise<unknown> {
    const store = target.store
    const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
    const result = await renderTreeNode(store.graph, tree, {
      parentId: (toolArgs.parent_id as string | undefined) ?? target.pageId,
      x: toolArgs.x as number | undefined,
      y: toolArgs.y as number | undefined
    })
    await ensureGraphFonts(store.graph, [result.id])
    computeAllLayouts(store.graph, target.pageId)
    store.requestRender()
    store.flashNodes([result.id])
    return {
      ok: true,
      result: { id: result.id, name: result.name, type: result.type, children: result.childIds }
    }
  }

  return async function handleTool(target: AutomationTarget, args: unknown): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const toolArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    const metadata = (args as { mutation?: AutomationMutationMetadata }).mutation
    if (!toolName) throw new Error('Missing "name" in args')

    const def = ALL_TOOLS.find((t) => t.name === toolName)
    if (!def) throw new Error(`Unknown tool: ${toolName}`)
    if (!def.mutates) {
      const figma = makeFigma(target.store, target.pageId)
      const result = await def.execute(figma, toolArgs)
      return { ok: true, result }
    }

    const store = target.store
    const outcome = await enqueueAutomationMutation({
      metadata,
      target,
      toolArgs,
      toolName,
      run: async () => {
        if (store.state.currentPageId !== target.pageId) await store.switchPage(target.pageId)
        const before = store.snapshotPage()
        if (toolName === 'render' && toolArgs.tree) {
          const result = await handleToolRender(target, toolArgs)
          pushAutomationUndo(store, toolName, before)
          return result
        }

        const figma = makeFigma(store, target.pageId)
        const result = await def.execute(figma, toolArgs)
        await syncAutomationToolState(store, figma, toolName, result)
        const pageNode = store.graph.getNode(figma.currentPageId)
        if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds)
        computeAllLayouts(store.graph, figma.currentPageId)
        store.requestRender()
        store.flashNodes(extractNodeIds(result))
        pushAutomationUndo(store, toolName, before)
        return result
      }
    })

    if (outcome.status === 'rejected') {
      return {
        ok: true,
        result: { applied: false, mutation_receipt: outcome.receipt }
      }
    }
    return {
      ok: true,
      result: withMutationReceipt(outcome.value, outcome.receipt)
    }
  }
}

function pushAutomationUndo(
  store: AutomationTarget['store'],
  toolName: string,
  before: ReturnType<AutomationTarget['store']['snapshotPage']>
) {
  const after = store.snapshotPage()
  store.pushUndoEntry({
    label: `MCP: ${toolName}`,
    forward: () => store.restorePageFromSnapshot(after),
    inverse: () => store.restorePageFromSnapshot(before)
  })
}

function withMutationReceipt(result: unknown, receipt: Record<string, unknown>) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), mutation_receipt: receipt }
  }
  return { mutation_receipt: receipt, value: result }
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as JsonObject
  if (typeof obj.deleted === 'string') return []
  const ids: string[] = []
  if (typeof obj.id === 'string') ids.push(obj.id)
  if (Array.isArray(obj.results)) {
    for (const item of obj.results) {
      if (item && typeof item === 'object' && typeof (item as JsonObject).id === 'string')
        ids.push((item as JsonObject).id as string)
    }
  }
  return ids
}
