import { nextTick, ref, type ComputedRef, type Ref } from 'vue'

import {
  uploadAgentAttachments,
  type AgentPromptAttachment
} from '@/app/agent-chat/attachment-transfer'
import type {
  AgentConversationHistory,
  AgentConversationThread
} from '@/app/agent-chat/conversations'
import { conversationSelection, type AgentPromptSubmission } from '@/app/agent-chat/models'
import {
  createAgentTodoChat,
  type AgentTodoBrief,
  type AgentWorkMapProject,
  type AgentWorkMapTodo
} from '@/app/agent-chat/work-map'
import type { WorkMapBotBoardPlacement } from '@/app/agent-chat/work-map-create-drag'
import { resolveBrowserCaptureAttachments } from '@/app/browser-inspector/attachment'
import type { EditorStore } from '@/app/editor/session'
import { toast } from '@/app/shell/ui'
import { useDialogUI } from '@/components/ui/dialog'

import { createAgentWorkMapRequestId, useAgentWorkMapPersistence } from './work-map-persistence'

type WorkMapCreateDraft = {
  boardPlacement?: WorkMapBotBoardPlacement
  kind: 'project'
  parentId?: string
  parentName?: string
}

type WorkMapCreationOptions = {
  history: Readonly<Ref<AgentConversationHistory | null>>
  modelScope: ComputedRef<string>
  openTodoObject: (todo: AgentWorkMapTodo, thread: AgentConversationThread) => void
  refresh: (fresh?: boolean) => Promise<void>
  root: Ref<HTMLElement | null>
  store: EditorStore
}

const WORK_MAP_BOT_FRAME_WIDTH = 720
const WORK_MAP_BOT_FRAME_HEIGHT = 480

function createWorkMapProjectId(): string {
  if (typeof crypto.randomUUID === 'function') return `project:${crypto.randomUUID()}`
  const values = crypto.getRandomValues(new Uint32Array(2))
  return `project:${String(Date.now())}-${String(values[0])}-${String(values[1])}`
}

export function createWorkMapTodoBrief(
  goal: string,
  attachments: AgentPromptAttachment[],
  contextPrompt?: string
): AgentTodoBrief {
  const todoGoal =
    goal ||
    (attachments.length
      ? `Review ${attachments.map((attachment) => attachment.name).join(', ')}`
      : 'Review this saved work')
  return {
    ...(contextPrompt ? { context: contextPrompt } : {}),
    goal: todoGoal,
    ...(attachments.length
      ? {
          references: attachments.map((attachment) => ({
            id: attachment.path,
            kind:
              attachment.type?.startsWith('image/') || attachment.visual?.kind === 'image'
                ? ('image' as const)
                : ('file' as const),
            label: attachment.name,
            ...(attachment.visual?.summary ? { note: attachment.visual.summary } : {})
          }))
        }
      : {}),
    suggestedNextStep: 'Clarify the outcome and shape the plan.'
  }
}

export function useWorkMapCreation(options: WorkMapCreationOptions) {
  const {
    applyOperations,
    busy: workMapBusy,
    load,
    replace,
    workMap
  } = useAgentWorkMapPersistence()
  const workMapCreateDraft = ref<WorkMapCreateDraft | null>(null)
  const workMapCreateTitle = ref('')
  const workMapCreateInput = ref<HTMLInputElement | null>(null)
  const workMapCreateDialog = useDialogUI({ content: 'w-[min(420px,calc(100vw-2rem))]' })
  const workMapTodoComposerProjectId = ref<string | null>(null)
  const workMapTodoComposerText = ref('')
  const workMapTodoComposerAttachments = ref<File[]>([])

  function addWorkMapProject(parentId?: string, boardPlacement?: WorkMapBotBoardPlacement) {
    const parent = parentId
      ? workMap.value?.projects.find((project) => project.id === parentId)
      : undefined
    workMapCreateTitle.value = ''
    workMapCreateDraft.value = {
      kind: 'project',
      ...(parentId ? { parentId, parentName: parent?.name ?? 'Bot' } : {}),
      ...(boardPlacement ? { boardPlacement } : {})
    }
    void nextTick(() => workMapCreateInput.value?.focus())
  }

  function addWorkMapTodo(project: AgentWorkMapProject) {
    if (workMapTodoComposerProjectId.value !== project.id) {
      workMapTodoComposerText.value = ''
      workMapTodoComposerAttachments.value = []
    }
    workMapTodoComposerProjectId.value = project.id
    void nextTick(() => {
      options.root.value
        ?.querySelector<HTMLTextAreaElement>(
          `[data-test-id="work-map-todo-composer-${CSS.escape(project.id)}"] textarea`
        )
        ?.focus()
    })
  }

  function closeWorkMapCreateDialog() {
    workMapCreateDraft.value = null
    workMapCreateTitle.value = ''
  }

  function setWorkMapCreateInput(element: unknown) {
    workMapCreateInput.value = element instanceof HTMLInputElement ? element : null
  }

  async function submitWorkMapCreate() {
    const draft = workMapCreateDraft.value
    const title = workMapCreateTitle.value.trim()
    if (!draft || !title || workMapBusy.value) return
    const projectId = createWorkMapProjectId()
    const placement = draft.boardPlacement
    let frameId: string | undefined
    if (placement) {
      const parentId = placement.parentFrameId ?? placement.pageId
      const parent = options.store.graph.getNode(parentId)
      if (!parent) {
        toast.error('The Board destination is no longer available')
        return
      }
      const offset =
        parent.type === 'CANVAS'
          ? { x: 0, y: 0 }
          : options.store.graph.getAbsolutePosition(parent.id)
      const frame = options.store.graph.createNode('FRAME', parentId, {
        clipsContent: false,
        cornerRadius: 12,
        fills: [],
        height: WORK_MAP_BOT_FRAME_HEIGHT,
        layoutMode: 'NONE',
        name: title,
        strokes: [],
        width: WORK_MAP_BOT_FRAME_WIDTH,
        x: Math.round(placement.x - offset.x - WORK_MAP_BOT_FRAME_WIDTH / 2),
        y: Math.round(placement.y - offset.y - WORK_MAP_BOT_FRAME_HEIGHT / 2)
      })
      frameId = frame.id
      options.store.requestRender()
      await nextTick()
    }
    const applied = await applyOperations([
      {
        name: title,
        op: 'create_project',
        project_id: projectId,
        ...(draft.parentId ? { parent_id: draft.parentId } : {})
      },
      ...(placement && frameId
        ? [
            {
              frame_id: frameId,
              op: 'set_project_space' as const,
              page_id: placement.pageId,
              project_id: projectId
            }
          ]
        : [])
    ])
    if (!applied) {
      if (frameId) {
        options.store.graph.deleteNode(frameId)
        options.store.requestRender()
      }
      return
    }
    if (frameId) {
      options.store.select([frameId])
      options.store.requestRender()
    }
    closeWorkMapCreateDialog()
  }

  function closeWorkMapTodoComposer() {
    workMapTodoComposerProjectId.value = null
    workMapTodoComposerText.value = ''
    workMapTodoComposerAttachments.value = []
  }

  async function submitWorkMapTodo(submission: AgentPromptSubmission) {
    const projectId = workMapTodoComposerProjectId.value
    const goal = workMapTodoComposerText.value.trim()
    if (!projectId || (!goal && !submission.attachments.length) || workMapBusy.value) return
    workMapBusy.value = true
    try {
      const captureResolution = await resolveBrowserCaptureAttachments(submission.attachments)
      const uploaded = await uploadAgentAttachments(captureResolution.attachments)
      const selection = conversationSelection(options.modelScope.value)
      const result = await createAgentTodoChat({
        attachments: uploaded,
        brief: createWorkMapTodoBrief(goal, uploaded, captureResolution.contextPrompt),
        effort: selection.effort,
        expectedRevision: workMap.value?.revision ?? 0,
        model: selection.model,
        projectId,
        requestId: createAgentWorkMapRequestId()
      })
      closeWorkMapTodoComposer()
      replace(result.workMap)
      await options.refresh(true)
      const thread = options.history.value?.threads.find(
        (candidate) => candidate.nativeThreadId === result.threadId
      )
      const todo = result.workMap.todos.find((candidate) => candidate.threadId === result.threadId)
      if (thread && todo) options.openTodoObject(todo, thread)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Todo chat creation failed')
      await load()
    } finally {
      workMapBusy.value = false
    }
  }

  return {
    addWorkMapProject,
    addWorkMapTodo,
    closeWorkMapCreateDialog,
    closeWorkMapTodoComposer,
    setWorkMapCreateInput,
    submitWorkMapCreate,
    submitWorkMapTodo,
    workMapCreateDialog,
    workMapCreateDraft,
    workMapCreateTitle,
    workMapTodoComposerAttachments,
    workMapTodoComposerProjectId,
    workMapTodoComposerText
  }
}
