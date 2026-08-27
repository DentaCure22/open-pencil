import { ref, type Ref } from 'vue'

import { resolveBrowserCaptureAttachments } from '@/app/browser-inspector/attachment'
import { BROWSER_CAPTURE_DRAG_TYPE } from '@/app/browser-inspector/drag'
import { toast } from '@/app/shell/ui'

import { uploadAgentAttachments } from './attachment-transfer'
import { readAttachmentDrag } from './attachments'
import type { AgentConversationHistory, AgentConversationThread } from './conversations'
import { appendAgentTodoBrief, updateAgentTodoDraft, type AgentWorkMapTodo } from './work-map'

const WORK_MAP_TODO_DRAG_TYPE = 'application/x-openpencil-work-map-todo'

type TodoContentDropOptions = {
  history: Readonly<Ref<AgentConversationHistory | null>>
  openTodoObject: (todo: AgentWorkMapTodo, thread: AgentConversationThread) => void
  refresh: (fresh?: boolean) => Promise<void>
}

export function carriesWorkMapTodoContentTypes(types: readonly string[]): boolean {
  if (types.includes(WORK_MAP_TODO_DRAG_TYPE)) return false
  return (
    types.includes('Files') ||
    types.includes(BROWSER_CAPTURE_DRAG_TYPE) ||
    types.includes('text/plain')
  )
}

export function useWorkMapTodoContentDrop(options: TodoContentDropOptions) {
  const todoContentDropTargetId = ref<string | null>(null)
  const todoContentSavingId = ref<string | null>(null)

  function carriesTodoContentDrop(dataTransfer: DataTransfer | null): boolean {
    return Boolean(dataTransfer && carriesWorkMapTodoContentTypes([...dataTransfer.types]))
  }

  function showTodoContentDrop(event: DragEvent, todo: AgentWorkMapTodo) {
    if (!carriesTodoContentDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    todoContentDropTargetId.value = todo.id
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function hideTodoContentDrop(event: DragEvent, todo: AgentWorkMapTodo) {
    if (todoContentDropTargetId.value !== todo.id) return
    const current = event.currentTarget
    const related = event.relatedTarget
    if (current instanceof HTMLElement && related instanceof Node && current.contains(related))
      return
    todoContentDropTargetId.value = null
  }

  async function dropContentOnTodo(event: DragEvent, todo: AgentWorkMapTodo) {
    if (!carriesTodoContentDrop(event.dataTransfer) || todoContentSavingId.value) return
    event.preventDefault()
    event.stopPropagation()
    todoContentDropTargetId.value = null
    if (!todo.threadId) {
      toast.info('This older Todo cannot hold dropped content yet.')
      return
    }
    let thread = options.history.value?.threads.find(
      (candidate) => candidate.nativeThreadId === todo.threadId
    )
    if (!thread) {
      await options.refresh(true)
      thread = options.history.value?.threads.find(
        (candidate) => candidate.nativeThreadId === todo.threadId
      )
    }
    if (!thread?.todoDraft) {
      toast.error('Todo object unavailable')
      return
    }
    todoContentSavingId.value = todo.id
    try {
      const droppedFiles = readAttachmentDrag(event.dataTransfer)
      const resolved = await resolveBrowserCaptureAttachments(droppedFiles)
      const attachments = await uploadAgentAttachments(resolved.attachments)
      const text = [
        event.dataTransfer?.getData('text/plain').trim(),
        resolved.contextPrompt?.trim()
      ]
        .filter(Boolean)
        .join('\n\n')
      if (!text && !attachments.length) return
      await updateAgentTodoDraft({
        attachments,
        brief: appendAgentTodoBrief(thread.todoDraft.brief, { attachments, text }),
        threadId: thread.nativeThreadId
      })
      await options.refresh(true)
      const updatedThread = options.history.value?.threads.find(
        (candidate) => candidate.nativeThreadId === todo.threadId
      )
      if (updatedThread) options.openTodoObject(todo, updatedThread)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Todo update failed')
    } finally {
      todoContentSavingId.value = null
    }
  }

  return {
    dropContentOnTodo,
    hideTodoContentDrop,
    showTodoContentDrop,
    todoContentDropTargetId
  }
}
