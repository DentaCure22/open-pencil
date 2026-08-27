export type AiConversationStatus =
  | 'error'
  | 'needs_attention'
  | 'ready'
  | 'stopped'
  | 'streaming'
  | 'submitted'

export type AiToolState = 'approval' | 'error' | 'pending' | 'running' | 'success'

export type AiFileChange = {
  additions: number
  deletions: number
  patch?: string
  path: string
  previousPath?: string
  status: 'added' | 'copied' | 'deleted' | 'modified' | 'renamed'
}

export type AiTurnChanges = {
  additions: number
  capturedAt: string
  deletions: number
  files: AiFileChange[]
  truncated?: boolean
}

export type AiBoardObjectChange = {
  id: string
  name: string
  pageId?: string
  type?: string
  verb: 'created' | 'edited'
}

export type AiLinkedObject = {
  chapterId: string
  id: string
  name: string
  verb: 'created' | 'edited'
}

export type AiMessagePart =
  | { text: string; type: 'text' }
  | { state?: 'complete' | 'streaming'; text: string; type: 'commentary' }
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
  changes?: AiTurnChanges
  completedAt?: string
  createdAt: string
  id: string
  parts?: AiMessagePart[]
  role: 'assistant' | 'system' | 'user'
  text: string
}
