import type { AgentModelSelection } from '@/app/agent-chat/models'
import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

import { contextCommentImageInstructions, contextCommentPrompt } from './prompt'
import type { ContextCommentDispatchReceipt, ContextCommentDraft } from './types'

type ContextCommentDispatchPayload = {
  error?: string
  threadId?: string
}

function dispatchPayload(value: unknown): ContextCommentDispatchPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return {
    ...('error' in value && typeof value.error === 'string' ? { error: value.error } : {}),
    ...('threadId' in value && typeof value.threadId === 'string'
      ? { threadId: value.threadId }
      : {})
  }
}

async function dispatchDirectly(
  draft: ContextCommentDraft,
  prompt: string,
  selection: AgentModelSelection
): Promise<ContextCommentDispatchReceipt> {
  let response: Response
  try {
    response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/dispatch', {
      body: JSON.stringify({
        displayPrompt: draft.capture ? contextCommentImageInstructions(draft) : draft.text,
        ...(draft.capture ? { evidenceId: draft.capture.evidenceId } : {}),
        effort: selection.effort,
        model: selection.model,
        prompt
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The worker launcher is unavailable.')
  }
  const payload = dispatchPayload(await response.json().catch(() => null))
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : `Worker dispatch failed (${String(response.status)}).`
    )
  }
  return {
    targetThreadId: payload.threadId ?? ''
  }
}

async function dispatchToConversation(
  draft: ContextCommentDraft,
  prompt: string,
  selection: AgentModelSelection
): Promise<ContextCommentDispatchReceipt> {
  const destination = draft.destination
  if (!destination || !draft.capture) throw new Error('The image edit destination is unavailable.')
  let response: Response
  try {
    response = await localWorkspaceAuthorityFetch(
      `/agent-router/v1/pi/conversations/${encodeURIComponent(destination.threadId)}/${destination.action}`,
      {
        body: JSON.stringify({
          displayPrompt: `Edit image\n\n${contextCommentImageInstructions(draft)}`,
          effort: selection.effort,
          evidenceId: draft.capture.evidenceId,
          message: prompt,
          model: selection.model
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(15_000)
      }
    )
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'The image edit could not be sent.')
  }
  const payload = dispatchPayload(await response.json().catch(() => null))
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : `Image edit handoff failed (${String(response.status)}).`
    )
  }
  return { targetThreadId: payload.threadId ?? destination.threadId }
}

export async function dispatchContextComment(
  draft: ContextCommentDraft,
  selection: AgentModelSelection
): Promise<ContextCommentDispatchReceipt> {
  const prompt = contextCommentPrompt(draft)
  const receipt = draft.destination
    ? await dispatchToConversation(draft, prompt, selection)
    : await dispatchDirectly(draft, prompt, selection)
  window.dispatchEvent(
    new CustomEvent('openpencil:context-comment-dispatched', {
      detail: receipt
    })
  )
  return receipt
}
