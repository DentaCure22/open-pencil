import { useLocalStorage } from '@vueuse/core'
import { computed, type ComputedRef, type Ref } from 'vue'

import type { AgentPromptAnnotation } from '@/app/agent-chat/models'
import {
  agentRightPanelState,
  closeAgentRightPanel,
  openAgentRightPanel
} from '@/app/agent-chat/right-panel'
import type { AiMessage, AiTurnChanges } from '@/app/agent-chat/types'

import {
  parseT3DiffAnnotationSourceId,
  t3DiffAnnotationSourceId,
  type T3DiffReviewComment
} from './t3-right-panel.logic'

type DiffPanelState = {
  capturedAt: string
  open: boolean
  selectedPath?: string
}

type ConversationDiffReviewOptions = {
  annotations: Ref<AgentPromptAnnotation[]>
  messages: ComputedRef<AiMessage[]>
  threadId: ComputedRef<string>
  view: Ref<'conversation' | 'list' | 'plan'>
}

export function useConversationDiffReview(options: ConversationDiffReviewOptions) {
  const stateByThread = useLocalStorage<Record<string, DiffPanelState>>(
    'open-pencil:t3-right-panel-state-v1',
    {}
  )
  const state: ComputedRef<DiffPanelState | null> = computed(() => {
    const threadId = options.threadId.value
    if (!threadId || !Object.hasOwn(stateByThread.value, threadId)) return null
    return stateByThread.value[threadId]
  })
  const changes = computed<AiTurnChanges | null>(() => {
    const capturedAt = state.value?.capturedAt
    if (!capturedAt) return null
    return (
      [...options.messages.value]
        .reverse()
        .find((message) => message.changes?.capturedAt === capturedAt)?.changes ?? null
    )
  })
  const comments = computed<T3DiffReviewComment[]>(() => {
    const capturedAt = state.value?.capturedAt
    if (!capturedAt) return []
    return options.annotations.value.flatMap((annotation) => {
      const target = parseT3DiffAnnotationSourceId(annotation.sourceMessageId)
      if (!target || target.capturedAt !== capturedAt) return []
      return [
        {
          ...target,
          id: annotation.id,
          quote: annotation.quote,
          rangeLabel: annotation.quote.split('\n')[1] || 'selected lines',
          text: annotation.comment
        }
      ]
    })
  })

  function save(next: DiffPanelState): void {
    const threadId = options.threadId.value
    if (!threadId) return
    stateByThread.value = { ...stateByThread.value, [threadId]: next }
  }

  function open(nextChanges: AiTurnChanges, selectedPath: string): void {
    save({ capturedAt: nextChanges.capturedAt, open: true, selectedPath })
    openAgentRightPanel('diff')
  }

  function close(): void {
    closeAgentRightPanel()
    if (state.value) save({ ...state.value, open: false })
  }

  function reopen(): void {
    const panel = agentRightPanelState.value
    const surface =
      panel.surface === 'diff' && options.view.value !== 'conversation' ? 'layers' : panel.surface
    openAgentRightPanel(surface, { projectId: panel.projectId, projectName: panel.projectName })
    if (surface === 'diff' && state.value) save({ ...state.value, open: true })
  }

  function selectFile(path: string): void {
    if (state.value) save({ ...state.value, selectedPath: path })
  }

  function addComment(comment: Omit<T3DiffReviewComment, 'id'>): void {
    options.annotations.value = [
      ...options.annotations.value,
      {
        comment: comment.text,
        endOffset: comment.quote.length,
        id: `diff-${crypto.randomUUID()}`,
        quote: comment.quote,
        sourceMessageId: t3DiffAnnotationSourceId(comment),
        startOffset: 0
      }
    ]
  }

  function deleteComment(commentId: string): void {
    options.annotations.value = options.annotations.value.filter(
      (annotation) => annotation.id !== commentId
    )
  }

  function openAnnotation(annotation: AgentPromptAnnotation): void {
    const target = parseT3DiffAnnotationSourceId(annotation.sourceMessageId)
    if (!target) return
    const nextChanges = [...options.messages.value]
      .reverse()
      .find((message) => message.changes?.capturedAt === target.capturedAt)?.changes
    if (nextChanges) open(nextChanges, target.path)
  }

  return {
    addComment,
    changes,
    close,
    comments,
    deleteComment,
    open,
    openAnnotation,
    reopen,
    selectFile,
    state
  }
}
