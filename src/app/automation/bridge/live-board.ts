import { IS_BROWSER } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/core/random'
import { computeAbsoluteBounds, type Rect } from '@open-pencil/scene-graph'
import {
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame,
  type EditorPresentationFrame
} from '@open-pencil/vue/presentation'

import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import { editorViewportInsets } from '@/app/editor/viewport-insets'

const CONTEXT_LIMIT = 48
const PRESENTATION_TIMEOUT_MS = 1_500

type LiveBoardContext = {
  contentDocumentId?: string
  documentId: string
  pageId: string
  runtimeInstanceId: string
  token: string
  workspaceId?: string
}

function selectedIds(target: AutomationTarget): string[] {
  return [...target.store.state.selectedIds]
}

function targetIdentity(target: AutomationTarget) {
  return {
    ...(target.contentDocumentId ? { content_document_id: target.contentDocumentId } : {}),
    document_id: target.documentId,
    page_id: target.pageId,
    runtime_instance_id: target.runtimeInstanceId,
    ...(target.workspaceId ? { workspace_id: target.workspaceId } : {})
  }
}

function presentationIntersection(
  target: AutomationTarget,
  bounds: Rect
): 'inside' | 'outside' | 'partial' {
  const zoom = target.store.state.zoom
  const left = bounds.x * zoom + target.store.state.panX
  const right = (bounds.x + bounds.width) * zoom + target.store.state.panX
  const top = bounds.y * zoom + target.store.state.panY
  const bottom = (bounds.y + bounds.height) * zoom + target.store.state.panY
  const width = IS_BROWSER ? window.innerWidth : 800
  const height = IS_BROWSER ? window.innerHeight : 600
  if (left >= 0 && top >= 0 && right <= width && bottom <= height) return 'inside'
  if (right <= 0 || bottom <= 0 || left >= width || top >= height) return 'outside'
  return 'partial'
}

function presentationObjectIds(value: unknown): string[] {
  if (!isUnknownRecord(value) || !Array.isArray(value.object_ids)) {
    throw new TypeError('board_present requires an object_ids array.')
  }
  const ids = value.object_ids.map((item) => (typeof item === 'string' ? item.trim() : ''))
  if (
    ids.length === 0 ||
    ids.length > 100 ||
    ids.some((id) => !id) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error('board_present object_ids must contain from 1 to 100 unique IDs.')
  }
  return ids
}

function contextToken(value: unknown): string {
  if (!isUnknownRecord(value) || typeof value.context_token !== 'string') {
    throw new TypeError('board_present requires a context_token.')
  }
  const token = value.context_token.trim()
  if (!token) throw new TypeError('board_present requires a context_token.')
  return token
}

function contextMatches(target: AutomationTarget, context: LiveBoardContext): boolean {
  return (
    context.contentDocumentId === target.contentDocumentId &&
    context.documentId === target.documentId &&
    context.pageId === target.pageId &&
    context.runtimeInstanceId === target.runtimeInstanceId &&
    context.workspaceId === target.workspaceId
  )
}

async function awaitPresentationFrame(
  target: AutomationTarget
): Promise<EditorPresentationFrame | null> {
  if (typeof requestAnimationFrame !== 'function') return null
  let callback: (value: EditorPresentationFrame) => void = () => undefined
  const frame = new Promise<EditorPresentationFrame>((resolve) => {
    callback = resolve
  })
  scheduleEditorPresentationFrame(target.store, callback)
  let finishTimeout: (value: null) => void = () => undefined
  const timedOut = new Promise<null>((resolve) => {
    finishTimeout = resolve
  })
  const timeout = setTimeout(() => finishTimeout(null), PRESENTATION_TIMEOUT_MS)
  const result = await Promise.race([frame, timedOut])
  clearTimeout(timeout)
  if (!result) cancelEditorPresentationFrame(target.store, callback)
  return result
}

export function createLiveBoardHandlers(runtimeInstanceId: string) {
  const contexts = new Map<string, LiveBoardContext>()

  function issueContext(target: AutomationTarget) {
    if (target.runtimeInstanceId !== runtimeInstanceId) {
      throw new Error('The resolved Board does not belong to this running client.')
    }
    if (target.store.state.currentPageId !== target.pageId) {
      throw new Error('Live Board context requires the visible page.')
    }
    const token = `live-board-context:${randomHex(16)}`
    contexts.set(token, {
      ...(target.contentDocumentId ? { contentDocumentId: target.contentDocumentId } : {}),
      documentId: target.documentId,
      pageId: target.pageId,
      runtimeInstanceId,
      token,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {})
    })
    while (contexts.size > CONTEXT_LIMIT) {
      const oldest = contexts.keys().next().value
      if (typeof oldest !== 'string') break
      contexts.delete(oldest)
    }
    return {
      capabilities: ['board.present'],
      context_token: token,
      revisions: {
        board: target.store.state.sceneVersion,
        presentation: target.store.state.renderVersion
      },
      runtime: {
        instance_id: runtimeInstanceId,
        page_visibility: 'visible',
        visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState
      },
      selected_ids: selectedIds(target),
      target: targetIdentity(target),
      viewport: {
        pan_x: target.store.state.panX,
        pan_y: target.store.state.panY,
        zoom: target.store.state.zoom
      }
    }
  }

  return {
    context(target: AutomationTarget) {
      return Promise.resolve(issueContext(target))
    },

    async present(target: AutomationTarget, value: unknown) {
      const token = contextToken(value)
      const context = contexts.get(token)
      if (!context || !contextMatches(target, context)) {
        throw new Error('Live Board context is missing, expired, or belongs to another Board.')
      }
      if (target.store.state.currentPageId !== target.pageId) {
        throw new Error('Board presentation requires the visible page.')
      }
      const objectIds = presentationObjectIds(value)
      for (const id of objectIds) {
        const node = target.store.graph.getNode(id)
        if (!node || !target.store.graph.isDescendant(id, target.pageId)) {
          throw new Error(`Object "${id}" is not on Board "${target.pageName}".`)
        }
      }
      target.store.select(objectIds)
      if (objectIds.length === 1) target.store.revealNode(objectIds[0], editorViewportInsets())
      else target.store.zoomToSelection(editorViewportInsets())
      target.store.requestOverlayRepaint()

      const frame = await awaitPresentationFrame(target)
      const bounds = objectIds.map((id) => {
        const node = target.store.graph.getNode(id)
        if (!node) throw new Error(`Object "${id}" disappeared during presentation.`)
        return computeAbsoluteBounds([node], (nodeId) =>
          target.store.graph.getAbsolutePosition(nodeId)
        )
      })
      return {
        presentation: {
          acknowledged: Boolean(frame),
          ...(frame
            ? {
                frame: {
                  render_version: frame.renderVersion,
                  revision: frame.revision,
                  scene_version: frame.sceneVersion,
                  timestamp: frame.timestamp
                }
              }
            : {}),
          intersection: bounds.map((item, index) => ({
            bounds: item,
            object_id: objectIds[index],
            viewport: presentationIntersection(target, item)
          })),
          selected_ids: selectedIds(target),
          viewport: {
            pan_x: target.store.state.panX,
            pan_y: target.store.state.panY,
            zoom: target.store.state.zoom
          }
        },
        status: { command: 'completed', mutation: 'not_applicable' }
      }
    }
  }
}
