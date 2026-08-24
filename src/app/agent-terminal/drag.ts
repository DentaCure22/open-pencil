import { useEventListener } from '@vueuse/core'
import { onScopeDispose, type Ref } from 'vue'

import type { SceneNode, Vector } from '@open-pencil/scene-graph'

import { codeObjectDocument, codeObjectPluginData } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'

import { AGENT_CARD_HEIGHT, AGENT_CARD_WIDTH } from './board-layout'
import {
  agentBoardObjectDocument,
  agentConversationBoardObject,
  createAgentConversationDraftId,
  createAgentConversationBoardObject,
  type AgentConversationBoardThread
} from './board-object'

export const AGENT_CONVERSATION_DRAG_TYPE = 'application/x-openpencil-agent-conversation'
const AGENT_CONVERSATION_DRAG_TEXT_TYPE = 'text/plain'

export type AgentConversationDragPayload = AgentConversationBoardThread & {
  newConversation?: true
  threadId: string
}

type PendingAgentConversationDrag = {
  lastClientX: number
  lastClientY: number
  lastPoint: Vector | null
  overBoard: boolean
  placed: boolean
  payload: AgentConversationDragPayload
}

let pendingAgentConversationDrag: PendingAgentConversationDrag | null = null
let livePreview: HTMLElement | null = null
let pointerIntent: {
  payload: AgentConversationDragPayload
  pointerId: number
  startX: number
  startY: number
} | null = null
let suppressAgentConversationClick = false
let html5DragActive = false

const POINTER_DRAG_THRESHOLD_PX = 8

function hasAgentConversation(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && [...dataTransfer.types].includes(AGENT_CONVERSATION_DRAG_TYPE))
}

let dragCursorRestore = ''
let boardDragActivity: ((active: boolean) => void) | null = null

export function isAgentConversationDragActive(): boolean {
  return pendingAgentConversationDrag !== null
}

function createLivePreview(payload: AgentConversationDragPayload): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const preview = document.createElement('div')
  preview.dataset.testId = 'agent-conversation-drag-preview'
  preview.textContent = payload.title
  preview.style.cssText =
    'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:flex;height:28px;max-width:280px;align-items:center;padding:0 10px;border-radius:8px;border:1px solid var(--border);background:var(--color-panel, var(--panel));color:var(--color-surface, inherit);font-size:11px;font-weight:500;line-height:28px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 6px 18px rgba(0,0,0,.28);will-change:transform;contain:layout style;user-select:none'
  document.body.appendChild(preview)
  return preview
}

function showLivePreview(payload: AgentConversationDragPayload) {
  if (livePreview) return
  livePreview = createLivePreview(payload)
  if (typeof document !== 'undefined') {
    dragCursorRestore = document.documentElement.style.cursor
    document.documentElement.style.cursor = 'grabbing'
  }
}

function moveLivePreview(clientX: number, clientY: number) {
  if (!livePreview) return
  livePreview.style.transform = `translate3d(${clientX - 16}px, ${clientY - 14}px, 0)`
}

function removeLivePreview() {
  livePreview?.remove()
  livePreview = null
  if (typeof document !== 'undefined') {
    document.documentElement.style.cursor = dragCursorRestore
    dragCursorRestore = ''
  }
}

export function resolveAgentConversationDrag(
  dataTransfer: DataTransfer | null
): AgentConversationDragPayload | null {
  return pendingAgentConversationDrag?.payload ?? readAgentConversationDrag(dataTransfer)
}

function startPendingAgentConversationDrag(
  payload: AgentConversationDragPayload,
  clientX = 0,
  clientY = 0
): void {
  pendingAgentConversationDrag = {
    lastClientX: clientX,
    lastClientY: clientY,
    lastPoint: null,
    overBoard: false,
    placed: false,
    payload
  }
  suppressAgentConversationClick = true
  showLivePreview(payload)
  boardDragActivity?.(true)
  if (clientX || clientY) moveLivePreview(clientX, clientY)
}

export function newAgentConversationDragPayload(): AgentConversationDragPayload {
  return {
    conversationId: createAgentConversationDraftId(),
    newConversation: true,
    threadId: 'new',
    title: 'New task'
  }
}

export function armAgentConversationPointerDrag(
  event: PointerEvent,
  payload: AgentConversationDragPayload
): void {
  if (event.button !== 0) return
  pointerIntent = {
    payload,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement) {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Capture is optional; window pointer listeners still track the drag.
    }
  }
}

export function shouldSuppressAgentConversationClick(): boolean {
  if (!suppressAgentConversationClick) return false
  suppressAgentConversationClick = false
  return true
}

export function writeAgentConversationDrag(
  event: DragEvent,
  payload: AgentConversationDragPayload
): void {
  const resolved = pendingAgentConversationDrag?.payload ?? pointerIntent?.payload ?? payload
  if (!pendingAgentConversationDrag) {
    startPendingAgentConversationDrag(resolved, event.clientX, event.clientY)
  }
  pointerIntent = null
  html5DragActive = true
  if (event.dataTransfer) {
    event.dataTransfer.setData(AGENT_CONVERSATION_DRAG_TEXT_TYPE, resolved.title)
    event.dataTransfer.setData(AGENT_CONVERSATION_DRAG_TYPE, JSON.stringify(resolved))
    event.dataTransfer.effectAllowed = 'copy'
  }
}

export function writeNewAgentConversationDrag(event: DragEvent): void {
  writeAgentConversationDrag(event, pointerIntent?.payload ?? newAgentConversationDragPayload())
}

export function readAgentConversationDrag(
  dataTransfer: DataTransfer | null
): AgentConversationDragPayload | null {
  if (!hasAgentConversation(dataTransfer)) return null
  try {
    const value = JSON.parse(dataTransfer?.getData(AGENT_CONVERSATION_DRAG_TYPE) ?? '') as unknown
    if (!value || typeof value !== 'object') return null
    if (
      !('conversationId' in value) ||
      typeof value.conversationId !== 'string' ||
      !('threadId' in value) ||
      typeof value.threadId !== 'string' ||
      !('title' in value) ||
      typeof value.title !== 'string'
    ) {
      return null
    }
    const conversationId = value.conversationId.trim()
    const threadId = value.threadId.trim()
    const title = value.title.trim()
    if (!conversationId || !threadId || !title) return null
    return {
      conversationId,
      ...('newConversation' in value && value.newConversation === true
        ? { newConversation: true as const }
        : {}),
      threadId,
      title
    }
  } catch {
    return null
  }
}

function parentOffset(store: EditorStore, parentId: string): Vector {
  const parent = store.graph.getNode(parentId)
  if (!parent || parent.type === 'CANVAS') return { x: 0, y: 0 }
  return store.graph.getAbsolutePosition(parentId)
}

function usableDropParent(node: SceneNode | null | undefined): boolean {
  return Boolean(
    node &&
    (node.type === 'CANVAS' || node.type === 'FRAME' || node.type === 'SECTION') &&
    !codeObjectDocument(node) &&
    node.layoutMode === 'NONE'
  )
}

function dropParentId(store: EditorStore, point: Vector, existingId?: string): string {
  const entered = store.state.enteredContainerId
    ? store.graph.getNode(store.state.enteredContainerId)
    : undefined
  if (entered && usableDropParent(entered)) return entered.id

  let candidate: SceneNode | undefined | null = store.graph.hitTestFrame(
    point.x,
    point.y,
    new Set(existingId ? [existingId] : []),
    store.state.currentPageId
  )
  while (candidate && !usableDropParent(candidate)) {
    candidate = candidate.parentId ? store.graph.getNode(candidate.parentId) : null
  }
  return candidate?.id ?? store.state.currentPageId
}

function centeredPlacement(
  store: EditorStore,
  parentId: string,
  point: Vector,
  size: { height: number; width: number }
) {
  const offset = parentOffset(store, parentId)
  return {
    parentId,
    x: Math.round(point.x - offset.x - size.width / 2),
    y: Math.round(point.y - offset.y - size.height / 2)
  }
}

export function placeAgentConversationBoardThread(
  store: EditorStore,
  payload: AgentConversationDragPayload,
  point: Vector
): SceneNode {
  const existing = agentConversationBoardObject(store, payload.conversationId)
  const parentId = dropParentId(store, point, existing?.id)
  if (!existing) {
    return createAgentConversationBoardObject(
      store,
      { conversationId: payload.conversationId, title: payload.title },
      centeredPlacement(store, parentId, point, {
        height: AGENT_CARD_HEIGHT,
        width: AGENT_CARD_WIDTH
      })
    )
  }

  const original = new Map([
    [
      existing.id,
      {
        parentId: existing.parentId ?? store.state.currentPageId,
        x: existing.x,
        y: existing.y
      }
    ]
  ])
  const placement = centeredPlacement(store, parentId, point, existing)
  if (existing.parentId !== parentId) store.graph.reparentNode(existing.id, parentId)
  const document = agentBoardObjectDocument(existing)
  store.updateNode(existing.id, {
    name: payload.title,
    pluginData:
      document?.component === 'agent-conversation-terminal'
        ? codeObjectPluginData(existing, { ...document, name: payload.title })
        : existing.pluginData,
    x: placement.x,
    y: placement.y
  })
  store.commitMoveWithReparent(original)
  store.select([existing.id])
  store.requestRender()
  return store.graph.getNode(existing.id) ?? existing
}

function clearAgentConversationDragState() {
  removeLivePreview()
  pendingAgentConversationDrag = null
  pointerIntent = null
  html5DragActive = false
  boardDragActivity?.(false)
  if (typeof window === 'undefined') {
    suppressAgentConversationClick = false
    return
  }
  window.setTimeout(() => {
    suppressAgentConversationClick = false
  }, 0)
}

export function useAgentConversationDrop(
  canvasAreaRef: Ref<HTMLElement | null>,
  store: EditorStore
) {
  let boardBounds: DOMRect | null = null
  boardDragActivity = (active) => {
    const area = canvasAreaRef.value
    if (area) area.style.pointerEvents = active ? 'none' : ''
    if (active) {
      store.setHoveredNode(null)
      store.setAutoLayoutHover(null)
    }
  }
  onScopeDispose(() => {
    boardDragActivity?.(false)
    boardDragActivity = null
  })

  function refreshBoardBounds() {
    boardBounds = canvasAreaRef.value?.getBoundingClientRect() ?? null
  }

  function isOverBoard(clientX: number, clientY: number) {
    const bounds = boardBounds
    return Boolean(
      bounds &&
        clientX >= bounds.left &&
        clientX <= bounds.right &&
        clientY >= bounds.top &&
        clientY <= bounds.bottom
    )
  }

  function pointFromClient(clientX: number, clientY: number): Vector | null {
    if (!boardBounds) refreshBoardBounds()
    if (!boardBounds) return null
    return store.screenToCanvas(clientX - boardBounds.left, clientY - boardBounds.top)
  }

  function trackPointer(clientX: number, clientY: number) {
    const intent = pointerIntent
    if (intent && !pendingAgentConversationDrag) {
      const dx = clientX - intent.startX
      const dy = clientY - intent.startY
      if (dx * dx + dy * dy >= POINTER_DRAG_THRESHOLD_PX * POINTER_DRAG_THRESHOLD_PX) {
        startPendingAgentConversationDrag(intent.payload, clientX, clientY)
        pointerIntent = null
        refreshBoardBounds()
      }
    }
    const pending = pendingAgentConversationDrag
    if (!pending) return
    pending.lastClientX = clientX
    pending.lastClientY = clientY
    pending.overBoard = isOverBoard(clientX, clientY)
    moveLivePreview(clientX, clientY)
  }

  function measurePendingPoint() {
    const pending = pendingAgentConversationDrag
    if (!pending) return
    refreshBoardBounds()
    pending.overBoard = isOverBoard(pending.lastClientX, pending.lastClientY)
    pending.lastPoint = pointFromClient(pending.lastClientX, pending.lastClientY)
  }

  function placeFromPending(point: Vector | null) {
    const pending = pendingAgentConversationDrag
    if (!pending || pending.placed || !point) return
    pending.placed = true
    removeLivePreview()
    placeAgentConversationBoardThread(store, pending.payload, point)
    pendingAgentConversationDrag = null
  }

  function finishIfOverBoard() {
    measurePendingPoint()
    const pending = pendingAgentConversationDrag
    if (!pending || pending.placed || !pending.overBoard) return
    placeFromPending(pending.lastPoint)
  }

  function onDragEnter(_event: DragEvent) {}

  function onDragOver(event: DragEvent) {
    if (!pendingAgentConversationDrag && !pointerIntent) return
    trackPointer(event.clientX, event.clientY)
    if (!pendingAgentConversationDrag?.overBoard) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(_event: DragEvent) {}

  function onDrop(event: DragEvent) {
    const pending = pendingAgentConversationDrag
    if (!pending) return
    event.preventDefault()
    event.stopPropagation()
    measurePendingPoint()
    const point =
      pending.lastPoint ??
      pointFromClient(event.clientX, event.clientY) ??
      (boardBounds
        ? pointFromClient(
            boardBounds.left + boardBounds.width / 2,
            boardBounds.top + boardBounds.height / 2
          )
        : null)
    placeFromPending(point)
    clearAgentConversationDragState()
  }

  function onDragEnd() {
    finishIfOverBoard()
    clearAgentConversationDragState()
  }

  function onPointerMove(event: PointerEvent) {
    if (!pendingAgentConversationDrag && !pointerIntent) return
    trackPointer(event.clientX, event.clientY)
  }

  function onPointerUp(event: PointerEvent) {
    if (!pendingAgentConversationDrag && !pointerIntent) return
    trackPointer(event.clientX, event.clientY)
    finishIfOverBoard()
    if (html5DragActive && pendingAgentConversationDrag && !pendingAgentConversationDrag.placed) {
      return
    }
    pointerIntent = null
    clearAgentConversationDragState()
  }

  useEventListener(document, 'drop', onDrop, { capture: true })
  useEventListener(window, 'dragend', onDragEnd)
  useEventListener(window, 'pointermove', onPointerMove, { passive: true })
  useEventListener(window, 'pointerup', onPointerUp)

  return { onDragEnter, onDragLeave, onDragOver, onDrop }
}
