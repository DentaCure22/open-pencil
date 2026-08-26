import { toast } from '@/app/shell/ui'

import { promptWithAnnotations } from './annotations'
import {
  attachmentImagePaths,
  promptWithAttachments,
  uploadAgentAttachments
} from './attachment-transfer'
import {
  dispatchAgentPrompt,
  followUpAgentConversation,
  steerAgentConversation,
  stopAgentThread,
  waitForAgentJob
} from './conversations'
import type { AgentPromptSubmission } from './models'
import {
  acceptOptimisticConversation,
  beginOptimisticConversation,
  completeOptimisticConversation,
  failOptimisticConversation,
  stopOptimisticConversation
} from './optimistic'

async function monitorAcceptedAgentJob(input: {
  jobId: string
  refresh: (fresh?: boolean) => Promise<void>
  requestId: string
  threadId: string
}) {
  try {
    const job = await waitForAgentJob(input.jobId)
    if (job.state === 'completed') {
      completeOptimisticConversation(input.threadId, input.requestId, job.response)
    } else if (job.state === 'stopped') {
      stopOptimisticConversation(input.threadId)
    } else {
      failOptimisticConversation(
        input.threadId,
        input.requestId,
        job.response || 'Pi needs attention.'
      )
    }
  } catch (cause) {
    failOptimisticConversation(
      input.threadId,
      input.requestId,
      cause instanceof Error ? cause.message : String(cause)
    )
  }
  await input.refresh(true)
}

export async function submitAgentConversation(input: {
  contextPrompt?: string
  nativeThreadId: string | null
  onAccepted?: (receipt: { jobId: string; threadId: string }) => void
  prompt: string
  refresh: (fresh?: boolean) => Promise<void>
  selection: AgentPromptSubmission
  steer?: boolean
  threadId: string
}): Promise<{ jobId: string; threadId: string }> {
  const annotatedPrompt = promptWithAnnotations(input.prompt, input.selection.annotations)
  const requestId = beginOptimisticConversation(
    input.threadId,
    annotatedPrompt,
    input.selection.attachments
  )
  try {
    const attachments = await uploadAgentAttachments(input.selection.attachments)
    const contextualPrompt = [input.contextPrompt?.trim(), annotatedPrompt]
      .filter((part): part is string => Boolean(part))
      .join('\n\n')
    const prompt = promptWithAttachments(contextualPrompt, attachments)
    const media = {
      attachments,
      displayPrompt: annotatedPrompt,
      imagePaths: attachmentImagePaths(attachments)
    }
    if (!input.nativeThreadId) {
      const receipt = await dispatchAgentPrompt(prompt, input.selection, media)
      input.onAccepted?.(receipt)
      acceptOptimisticConversation(input.threadId, requestId)
      await input.refresh(true)
      return { jobId: receipt.jobId, threadId: receipt.threadId }
    }
    const receipt = await (input.steer ? steerAgentConversation : followUpAgentConversation)(
      input.nativeThreadId,
      prompt,
      input.selection,
      media
    )
    if (!input.steer) toast.info('Follow-up sent')
    acceptOptimisticConversation(input.threadId, requestId)
    await input.refresh(true)
    if (input.steer) return { jobId: receipt.jobId, threadId: receipt.threadId }
    void monitorAcceptedAgentJob({
      jobId: receipt.jobId,
      refresh: input.refresh,
      requestId,
      threadId: input.threadId
    })
    return { jobId: receipt.jobId, threadId: receipt.threadId }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    failOptimisticConversation(input.threadId, requestId, detail)
    throw cause
  }
}

export async function stopAgentConversation(threadId: string, optimisticThreadId: string) {
  await stopAgentThread(threadId)
  stopOptimisticConversation(optimisticThreadId)
}
