import { computed, ref, type ComputedRef } from 'vue'

import { resolveBrowserCaptureAttachments } from '../browser-inspector/attachment'
import { stopAgentConversation, submitAgentConversation } from './actions'
import { respondToAgentUiRequest, type AgentExtensionUiResponse } from './approval'
import { agentConversationContextPrompt } from './bot-setup'
import {
  clearAgentComposerDraft,
  NEW_AGENT_CHAT_COMPOSER_DRAFT_ID,
  useAgentComposerDraft
} from './composer-drafts'
import type { AgentConversationThread } from './conversations'
import {
  conversationSelection,
  type AgentPromptAnnotation,
  type AgentPromptSubmission
} from './models'
import { clearOptimisticConversation } from './optimistic'
import {
  abandonAgentChatsNewTask,
  agentChatsPanelCreating,
  agentChatsPanelDraftId,
  claimAgentChatsNewTaskReceipt,
  isAgentChatsNewTaskDraftId
} from './panel'

type ConversationApprovalActions = {
  beginResponse: (
    thread: AgentConversationThread,
    requestId: string,
    response: AgentExtensionUiResponse
  ) => boolean
  removeFeedback: (threadId: string, requestId: string) => void
  supersedePending: (thread: AgentConversationThread) => string[]
}

function newConversationLaunch(
  projectId: string | null,
  botProjectId: string | null | undefined
): { createBot?: boolean; projectId: string | null } {
  if (botProjectId === undefined) return { projectId }
  return { createBot: true, projectId: botProjectId }
}

export function useAgentPanelConversationActions(options: {
  approvals: ConversationApprovalActions
  canStop: () => boolean
  conversationThreadId: ComputedRef<string>
  modelScope: ComputedRef<string>
  refresh: (fresh?: boolean) => Promise<void>
  refreshWorkMap?: () => Promise<unknown>
  selectedThread: ComputedRef<AgentConversationThread | null>
  steering: ComputedRef<boolean>
}) {
  const creating = agentChatsPanelCreating
  const draftId = agentChatsPanelDraftId
  const followUp = ref('')
  const annotations = ref<AgentPromptAnnotation[]>([])
  const attachments = ref<File[]>([])
  const submitting = ref(false)
  const error = ref('')
  const respondingUiRequests = ref<string[]>([])
  const lastFollowUp = ref('')
  const lastAnnotations = ref<AgentPromptAnnotation[]>([])
  const lastAttachments = ref<File[]>([])
  const pendingNewChatProjectId = ref<string | null>(null)
  const pendingNewBotProjectId = ref<string | null | undefined>(undefined)
  const configuringBot = computed(
    () => creating.value && pendingNewBotProjectId.value !== undefined
  )
  const composerDraftIdentity = computed(
    () =>
      options.selectedThread.value?.id ?? (creating.value ? NEW_AGENT_CHAT_COMPOSER_DRAFT_ID : '')
  )
  const composerDraft = useAgentComposerDraft({
    annotations,
    attachments,
    identity: composerDraftIdentity,
    text: followUp
  })

  function setNewConversationDestination(
    projectId: string | null,
    botProjectId: string | null | undefined
  ) {
    pendingNewChatProjectId.value = projectId
    pendingNewBotProjectId.value = botProjectId
  }

  function clearNewConversationDestination() {
    pendingNewChatProjectId.value = null
    pendingNewBotProjectId.value = undefined
  }

  function discardNewConversationDraft(id = draftId.value) {
    if (id) clearOptimisticConversation(id)
    clearOptimisticConversation('new-task')
    void clearAgentComposerDraft(NEW_AGENT_CHAT_COMPOSER_DRAFT_ID)
    if (!creating.value) return
    composerDraft.clear()
    lastFollowUp.value = ''
    lastAnnotations.value = []
    lastAttachments.value = []
    error.value = ''
    clearNewConversationDestination()
    abandonAgentChatsNewTask()
  }

  function claimNewConversationReceipt(submissionDraftId: string, threadId: string): boolean {
    return (
      creating.value &&
      isAgentChatsNewTaskDraftId(submissionDraftId) &&
      claimAgentChatsNewTaskReceipt(submissionDraftId, `agent:${threadId}`)
    )
  }

  async function submitFollowUp(
    submission: AgentPromptSubmission = {
      ...conversationSelection(options.modelScope.value),
      annotations: annotations.value,
      attachments: []
    }
  ) {
    const thread = options.selectedThread.value
    const message = followUp.value.trim()
    if (
      (!creating.value && !thread?.nativeThreadId) ||
      (!message && !submission.annotations.length && !submission.attachments.length) ||
      submitting.value
    ) {
      return
    }
    error.value = ''
    submitting.value = true
    const submissionDraftId = options.conversationThreadId.value
    let supersededRequestIds: string[] = []
    try {
      const captureResolution = await resolveBrowserCaptureAttachments(submission.attachments)
      const contextPrompt = agentConversationContextPrompt({
        browserContext: captureResolution.contextPrompt,
        configuringBot: configuringBot.value
      })
      const effectiveSubmission = {
        ...submission,
        attachments: captureResolution.attachments
      }
      supersededRequestIds = thread ? options.approvals.supersedePending(thread) : []
      lastFollowUp.value = message
      lastAnnotations.value = submission.annotations.map((annotation) => ({ ...annotation }))
      lastAttachments.value = [...submission.attachments]
      composerDraft.clear()
      const botProjectId = pendingNewBotProjectId.value
      const receipt = await submitAgentConversation({
        ...(contextPrompt ? { contextPrompt } : {}),
        launch: newConversationLaunch(pendingNewChatProjectId.value, botProjectId),
        nativeThreadId: thread?.nativeThreadId ?? null,
        onAccepted: ({ threadId }) => {
          if (!isAgentChatsNewTaskDraftId(submissionDraftId)) return
          claimAgentChatsNewTaskReceipt(submissionDraftId, `agent:${threadId}`)
          if (botProjectId === undefined) clearNewConversationDestination()
        },
        prompt: message,
        refresh: options.refresh,
        selection: effectiveSubmission,
        steer: options.steering.value,
        threadId: submissionDraftId
      })
      if (claimNewConversationReceipt(submissionDraftId, receipt.threadId)) {
        await options.refresh(true)
      }
      if (botProjectId !== undefined) {
        await options.refreshWorkMap?.()
        clearNewConversationDestination()
      }
    } catch (cause) {
      for (const requestId of supersededRequestIds) {
        options.approvals.removeFeedback(thread?.id ?? '', requestId)
      }
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      submitting.value = false
    }
  }

  async function retryFollowUp() {
    if (!lastFollowUp.value && !lastAnnotations.value.length && !lastAttachments.value.length)
      return
    followUp.value = lastFollowUp.value
    annotations.value = lastAnnotations.value.map((annotation) => ({ ...annotation }))
    attachments.value = [...lastAttachments.value]
    error.value = ''
    await submitFollowUp({
      ...conversationSelection(options.modelScope.value),
      annotations: annotations.value,
      attachments: attachments.value
    })
  }

  async function stopConversation() {
    const thread = options.selectedThread.value
    if (!thread || !options.canStop()) return
    try {
      await stopAgentConversation(thread.nativeThreadId, thread.id)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function respondToApproval(requestId: string, response: AgentExtensionUiResponse) {
    const thread = options.selectedThread.value
    if (!thread || respondingUiRequests.value.includes(requestId)) return
    const recorded = options.approvals.beginResponse(thread, requestId, response)
    error.value = ''
    respondingUiRequests.value = [...respondingUiRequests.value, requestId]
    try {
      await respondToAgentUiRequest(thread.nativeThreadId, requestId, response)
      await options.refresh(true)
    } catch (cause) {
      if (recorded) options.approvals.removeFeedback(thread.id, requestId)
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      respondingUiRequests.value = respondingUiRequests.value.filter((id) => id !== requestId)
    }
  }

  return {
    annotations,
    attachments,
    clearNewConversationDestination,
    configuringBot,
    discardNewConversationDraft,
    error,
    followUp,
    lastAnnotations,
    lastAttachments,
    lastFollowUp,
    respondingUiRequests,
    respondToApproval,
    retryFollowUp,
    setNewConversationDestination,
    stopConversation,
    submitFollowUp,
    submitting
  }
}
