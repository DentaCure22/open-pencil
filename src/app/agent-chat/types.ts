export type AiConversationStatus =
  | 'error'
  | 'needs_attention'
  | 'ready'
  | 'stopped'
  | 'streaming'
  | 'submitted'

export type AiToolState = 'approval' | 'error' | 'pending' | 'running' | 'success'

export type AiMessagePart =
  | { text: string; type: 'text' }
  | { state?: 'complete' | 'streaming'; text: string; type: 'reasoning' }
  | {
      approval?: { id: string; state: 'approved' | 'denied' | 'requested' }
      error?: string
      images?: Array<{ alt?: string; url: string }>
      input?: string
      name: string
      output?: string
      state: AiToolState
      type: 'tool'
      videos?: Array<{ mimeType?: string; name?: string; url: string }>
    }
  | { code: string; filename?: string; language?: string; type: 'code' }
  | { mediaType?: string; name: string; size?: number; type: 'attachment'; url?: string }
  | { alt?: string; type: 'image'; url: string }
  | { label?: string; title: string; type: 'source'; url: string }

export type AiMessage = {
  completedAt?: string
  createdAt: string
  id: string
  parts?: AiMessagePart[]
  role: 'assistant' | 'system' | 'user'
  text: string
}
