import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { SceneNode, Vector } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import { toast } from '@/app/shell/ui'

import { workMapProjectSpaceBindings } from './project-space'
import type { AgentWorkMap } from './work-map'

export const WORK_MAP_CREATE_DRAG_TYPE = 'application/x-openpencil-work-map-create'
const WORK_MAP_CREATE_BOT_DRAG_TYPE = `${WORK_MAP_CREATE_DRAG_TYPE}-bot`
const WORK_MAP_CREATE_CHAT_DRAG_TYPE = `${WORK_MAP_CREATE_DRAG_TYPE}-chat`
export const WORK_MAP_CREATE_BOT_EVENT = 'openpencil:work-map-create-bot'

export type WorkMapCreationKind = 'bot' | 'chat'

export type WorkMapBotBoardPlacement = {
  pageId: string
  parentFrameId?: string
  x: number
  y: number
}

export type WorkMapCreateBotRequest = {
  boardPlacement?: WorkMapBotBoardPlacement
  parentId?: string
  parentName?: string
}

function hasWorkMapCreation(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  const types = [...dataTransfer.types]
  return (
    types.includes(WORK_MAP_CREATE_DRAG_TYPE) ||
    types.includes(WORK_MAP_CREATE_BOT_DRAG_TYPE) ||
    types.includes(WORK_MAP_CREATE_CHAT_DRAG_TYPE)
  )
}

export function writeWorkMapCreationDrag(event: DragEvent, kind: WorkMapCreationKind): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(WORK_MAP_CREATE_DRAG_TYPE, kind)
  event.dataTransfer.setData(
    kind === 'bot' ? WORK_MAP_CREATE_BOT_DRAG_TYPE : WORK_MAP_CREATE_CHAT_DRAG_TYPE,
    kind
  )
  event.dataTransfer.setData('text/plain', kind === 'bot' ? 'New Bot' : 'New chat')
  event.dataTransfer.effectAllowed = 'copy'
}

export function readWorkMapCreationDrag(
  dataTransfer: DataTransfer | null
): WorkMapCreationKind | null {
  if (!hasWorkMapCreation(dataTransfer)) return null
  const types = [...(dataTransfer?.types ?? [])]
  if (types.includes(WORK_MAP_CREATE_BOT_DRAG_TYPE)) return 'bot'
  if (types.includes(WORK_MAP_CREATE_CHAT_DRAG_TYPE)) return 'chat'
  const kind = dataTransfer?.getData(WORK_MAP_CREATE_DRAG_TYPE)
  return kind === 'bot' || kind === 'chat' ? kind : null
}

function projectAtPoint(store: EditorStore, workMap: AgentWorkMap | null, point: Vector) {
  const projectsByFrame = new Map(
    workMapProjectSpaceBindings(workMap, store.state.currentPageId).map(({ frameId, project }) => [
      frameId,
      project
    ])
  )
  let candidate: SceneNode | null | undefined = store.graph.hitTestFrame(
    point.x,
    point.y,
    new Set(),
    store.state.currentPageId
  )
  while (candidate) {
    const project = projectsByFrame.get(candidate.id)
    if (project) return { frame: candidate, project }
    candidate = candidate.parentId ? store.graph.getNode(candidate.parentId) : null
  }
  return null
}

export function useWorkMapCreationBoardDrop(
  canvasArea: Ref<HTMLElement | null>,
  store: EditorStore,
  workMap: Ref<AgentWorkMap | null>
) {
  const isDraggingWorkMapCreation = ref(false)
  let dragDepth = 0

  function onDragEnter(event: DragEvent) {
    if (!hasWorkMapCreation(event.dataTransfer)) return
    dragDepth += 1
    isDraggingWorkMapCreation.value = true
  }

  function onDragLeave(event: DragEvent) {
    if (!hasWorkMapCreation(event.dataTransfer)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) isDraggingWorkMapCreation.value = false
  }

  function onDragOver(event: DragEvent) {
    if (!hasWorkMapCreation(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(event: DragEvent) {
    const kind = readWorkMapCreationDrag(event.dataTransfer)
    if (!kind) return
    dragDepth = 0
    isDraggingWorkMapCreation.value = false
    if (kind !== 'bot') return

    const bounds = canvasArea.value?.getBoundingClientRect()
    if (!bounds) return
    event.preventDefault()
    event.stopPropagation()
    const point = store.screenToCanvas(event.clientX - bounds.left, event.clientY - bounds.top)
    const target = projectAtPoint(store, workMap.value, point)
    if (target?.project.parentId) {
      toast.info('A sub-bot can live only inside a top-level Bot')
      return
    }
    window.dispatchEvent(
      new CustomEvent<WorkMapCreateBotRequest>(WORK_MAP_CREATE_BOT_EVENT, {
        detail: {
          boardPlacement: {
            pageId: store.state.currentPageId,
            ...(target ? { parentFrameId: target.frame.id } : {}),
            x: point.x,
            y: point.y
          },
          ...(target ? { parentId: target.project.id, parentName: target.project.name } : {})
        }
      })
    )
  }

  useEventListener(canvasArea, 'dragenter', onDragEnter)
  useEventListener(canvasArea, 'dragleave', onDragLeave)
  useEventListener(canvasArea, 'dragover', onDragOver)
  useEventListener(canvasArea, 'drop', onDrop)

  return { isDraggingWorkMapCreation }
}
