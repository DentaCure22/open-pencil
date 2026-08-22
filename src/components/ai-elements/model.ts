import type { AiConversationStatus, AiMessage, AiMessagePart, AiToolState } from './types'

const CODE_FENCE = /```([^\n`]*)\n([\s\S]*?)```/g

export function messageParts(message: AiMessage): AiMessagePart[] {
  if (message.parts?.length) return message.parts
  if (!message.text) return []
  if (message.role === 'user' || message.role === 'system') {
    return [{ text: message.text, type: 'text' }]
  }
  const parts: AiMessagePart[] = []
  let cursor = 0
  for (const match of message.text.matchAll(CODE_FENCE)) {
    const index = match.index
    if (index > cursor) parts.push({ text: message.text.slice(cursor, index), type: 'text' })
    parts.push({
      code: match[2],
      language: match[1].trim() || undefined,
      type: 'code'
    })
    cursor = index + match[0].length
  }
  if (cursor < message.text.length) {
    parts.push({ text: message.text.slice(cursor), type: 'text' })
  }
  return parts.length ? parts : [{ text: message.text, type: 'text' }]
}

export function conversationStatus(input: {
  error?: string
  sending?: boolean
  state?: string
}): AiConversationStatus {
  if (input.error) return 'error'
  if (input.sending) return 'submitted'
  if (input.state === 'needs_attention') return 'needs_attention'
  if (input.state === 'stopped') return 'stopped'
  if (input.state === 'running') return 'streaming'
  return 'ready'
}

export function formatAttachmentSize(value?: number): string {
  if (!value || value < 1) return ''
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

type ToolInputRecord = {
  CommandLine?: unknown
  TargetFile?: unknown
  action?: unknown
  changes?: unknown
  cmd?: unknown
  command?: unknown
  connect?: unknown
  describe?: unknown
  file?: unknown
  file_path?: unknown
  filePath?: unknown
  glob?: unknown
  items?: unknown
  path?: unknown
  pattern?: unknown
  query?: unknown
  search?: unknown
  server?: unknown
  target_file?: unknown
  tool?: unknown
  uri?: unknown
  url?: unknown
}

export type AiToolKind =
  | 'command'
  | 'connected-app'
  | 'edit'
  | 'handoff'
  | 'image'
  | 'list'
  | 'message'
  | 'read'
  | 'search'
  | 'tool'
  | 'web'

const SHORT_TOOL_INPUT_KEYS = [
  'command',
  'cmd',
  'CommandLine',
  'TargetFile',
  'target_file',
  'file_path',
  'filePath',
  'path',
  'query',
  'search',
  'pattern',
  'glob',
  'uri',
  'url',
  'file'
] as const satisfies readonly (keyof ToolInputRecord)[]
const MAX_SHORT_TOOL_INPUT = 72

function truncateToolInput(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= MAX_SHORT_TOOL_INPUT) return compact
  return `${compact.slice(0, MAX_SHORT_TOOL_INPUT - 1).trimEnd()}…`
}

function stringField(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function isToolInputRecord(value: unknown): value is ToolInputRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseJsonInput(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (cause) {
    if (cause instanceof SyntaxError) return undefined
    throw cause
  }
}

function extractToolPaths(value: unknown[]): string {
  const paths: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      paths.push(item.trim())
    } else if (isToolInputRecord(item)) {
      const path = stringField(item.path) || stringField(item.file) || stringField(item.uri)
      if (path) paths.push(path)
    }
    if (paths.length >= 3) break
  }
  return paths.join(', ')
}

function extractToolRecord(value: ToolInputRecord): string {
  for (const key of SHORT_TOOL_INPUT_KEYS) {
    const field = value[key]
    if (typeof field === 'string' && field.trim()) return field.trim()
    if (Array.isArray(field)) {
      const joined = extractToolPaths(field)
      if (joined) return joined
    }
  }
  if (Array.isArray(value.changes)) return extractToolPaths(value.changes)
  if (Array.isArray(value.items)) return extractToolPaths(value.items)
  return ''
}

export function shortToolInput(input?: string): string {
  if (!input?.trim()) return ''
  const trimmed = input.trim()
  const parsed = parseJsonInput(trimmed)
  if (parsed !== undefined) {
    if (typeof parsed === 'string') return truncateToolInput(parsed)
    if (Array.isArray(parsed)) return truncateToolInput(extractToolPaths(parsed) || trimmed)
    if (isToolInputRecord(parsed)) {
      const extracted = extractToolRecord(parsed)
      if (extracted) return truncateToolInput(extracted)
    }
  }
  const firstLine = trimmed.split('\n')[0]?.trim() ?? ''
  if (firstLine.startsWith('{') || firstLine.startsWith('[')) return ''
  return truncateToolInput(firstLine)
}

function displayToolName(name: string, input?: string): string {
  if (name.trim().toLowerCase() !== 'mcp') return name
  const parsed = input?.trim() ? parseJsonInput(input.trim()) : undefined
  if (!isToolInputRecord(parsed)) return 'connected app'
  const tool = stringField(parsed.tool)
  if (tool) return tool
  const action = stringField(parsed.action)
  if (action) return action
  if (typeof parsed.search === 'string') return 'search'
  return 'connected app'
}

function includesToolTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term))
}

export function toolCallKind(name: string, input?: string): AiToolKind {
  const normalized = displayToolName(name, input).replaceAll('_', ' ').toLowerCase()
  if (includesToolTerm(normalized, ['search', 'grep'])) return 'search'
  if (
    includesToolTerm(normalized, ['command', 'shell']) ||
    ['bash', 'exec', 'powershell', 'sh', 'terminal', 'zsh'].includes(normalized)
  ) {
    return 'command'
  }
  if (includesToolTerm(normalized, ['read', 'view'])) return 'read'
  if (includesToolTerm(normalized, ['file change', 'edit', 'write', 'str replace', 'apply patch'])) {
    return 'edit'
  }
  if (normalized.includes('list') || normalized === 'ls') return 'list'
  if (normalized.includes('connect')) return 'connected-app'
  if (normalized.includes('worker message')) return 'message'
  if (normalized.includes('handoff')) return 'handoff'
  if (includesToolTerm(normalized, ['screenshot', 'image'])) return 'image'
  if (includesToolTerm(normalized, ['fetch', 'web', 'url'])) {
    return 'web'
  }
  return 'tool'
}

export function toolCallLabel(name: string, input?: string): string {
  const displayName = displayToolName(name, input)
  const kind = toolCallKind(name, input)
  if (kind === 'search') return 'Searched'
  if (kind === 'command') return 'Ran command'
  if (kind === 'read') return 'Read'
  if (kind === 'edit') return 'Edited files'
  if (kind === 'list') return 'Listed'
  if (kind === 'connected-app') return 'Connected app'
  if (kind === 'message') return 'Sent message to worker'
  if (kind === 'handoff') return 'Created worker handoff'
  return displayName.replaceAll('_', ' ')
}

export function toolCallProgressLabel(name: string, input?: string): string {
  const displayName = displayToolName(name, input)
  const kind = toolCallKind(name, input)
  if (kind === 'search') return 'Searching'
  if (kind === 'command') return 'Running command'
  if (kind === 'read') return 'Reading'
  if (kind === 'edit') return 'Editing files'
  if (kind === 'list') return 'Listing'
  if (kind === 'connected-app') return 'Connecting app'
  if (kind === 'message') return 'Sending message to worker'
  if (kind === 'handoff') return 'Creating worker handoff'
  return `Running ${displayName.replaceAll('_', ' ')}`
}

function lowerInitial(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value
}

const TOOL_GROUP_LABELS: Record<AiToolKind, string> = {
  command: 'Ran commands',
  'connected-app': 'Used connected app',
  edit: 'Edited files',
  handoff: 'Created handoff',
  image: 'Viewed images',
  list: 'Listed files',
  message: 'Messaged worker',
  read: 'Read files',
  search: 'Searched',
  tool: 'Used tools',
  web: 'Fetched web'
}

export function toolGroupLabel(
  tools: Array<{ input?: string; name: string; state: AiToolState | 'stopped' }>
): string {
  const labels = new Map<AiToolKind, string>()
  for (const tool of tools) {
    const kind = toolCallKind(tool.name, tool.input)
    const running = tool.state === 'pending' || tool.state === 'running'
    if (!labels.has(kind) || running) {
      labels.set(
        kind,
        running ? toolCallProgressLabel(tool.name, tool.input) : TOOL_GROUP_LABELS[kind]
      )
    }
  }
  return [...labels.values()]
    .map((value, index) => (index === 0 ? value : lowerInitial(value)))
    .join(', ')
}

export function latestMessageCreatedAt(messages: AiMessage[]): string | undefined {
  let latest: { timestamp: number; value: string } | undefined
  for (const message of messages) {
    const timestamp = Date.parse(message.createdAt)
    if (!Number.isFinite(timestamp) || (latest && timestamp <= latest.timestamp)) continue
    latest = { timestamp, value: message.createdAt }
  }
  return latest?.value
}

export function formatElapsedDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return ''
  if (durationMs < 1_000) return '<1s'
  const totalSeconds = Math.floor(durationMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes ? `${String(minutes)}m ${String(seconds)}s` : `${String(seconds)}s`
}

export function resolveReasoningActivityState(
  state: Extract<AiMessagePart, { type: 'reasoning' }>['state'],
  index: number,
  activityCount: number,
  status: AiConversationStatus
): 'complete' | 'stopped' | 'streaming' {
  if (state !== 'streaming') return 'complete'
  if (index < activityCount - 1 || status === 'ready') return 'complete'
  if (['error', 'needs_attention', 'stopped'].includes(status)) return 'stopped'
  return 'streaming'
}

export function resolveToolActivityState(
  state: AiToolState,
  index: number,
  activityCount: number,
  status: AiConversationStatus
): AiToolState | 'stopped' {
  if (state !== 'pending' && state !== 'running') return state
  if (index < activityCount - 1 || status === 'ready') return 'success'
  if (['error', 'needs_attention', 'stopped'].includes(status)) return 'stopped'
  return state
}
