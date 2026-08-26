import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

export type AgentPromptAttachment = {
  name: string
  path: string
  size?: number
  type?: string
  visual?: {
    durationSeconds?: number
    frameCount?: number
    imagePaths: string[]
    intervalSeconds?: number
    kind: 'image' | 'video-frames'
    summary: string
  }
}

export async function uploadAgentAttachments(files: File[]): Promise<AgentPromptAttachment[]> {
  if (!files.length) return []
  const body = new FormData()
  for (const file of files) body.append('files', file)
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/attachments', {
    body,
    method: 'POST'
  })
  const payload = (await response.json().catch(() => null)) as {
    attachments?: AgentPromptAttachment[]
    error?: string
  } | null
  if (!response.ok || !payload?.attachments) {
    throw new Error(payload?.error || 'Attachments could not be uploaded')
  }
  return payload.attachments
}

export function promptWithAttachments(message: string, attachments: AgentPromptAttachment[]) {
  if (!attachments.length) return message
  const prefix = message.trim() ? `${message}\n\n` : ''
  const files = `${prefix}Attached files:\n${attachments
    .map((file) => `- ${JSON.stringify(file.name)}: ${file.path}`)
    .join('\n')}`
  const visualNotes = attachments
    .filter((file) => file.visual)
    .map((file) => `- ${JSON.stringify(file.name)}: ${file.visual?.summary ?? ''}`)
  if (!visualNotes.length) return files
  const hasVideo = attachments.some((file) => file.visual?.kind === 'video-frames')
  const videoCaveat = hasVideo
    ? '\nVideo filmstrips are an overview, not frame-exact proof. Use the original video for denser or timestamp-specific inspection; audio is not represented in the filmstrip.'
    : ''
  return `${files}\n\nVisual review inputs:\n${visualNotes.join('\n')}${videoCaveat}`
}

export function attachmentImagePaths(attachments: AgentPromptAttachment[]): string[] {
  return [...new Set(attachments.flatMap((attachment) => attachment.visual?.imagePaths ?? []))]
}
