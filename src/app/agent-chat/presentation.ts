import type { AgentConversationThread } from './client'

function sentenceCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function conciseTask(value: string): string {
  const userRequest = /^User request:\s*(.+)$/im.exec(value)?.[1]
  const task = /^Task:\s*(.+)$/im.exec(value)?.[1]
  const firstLine = value
    .replace(/^OpenPencil contextual comment\s*/i, '')
    .replace(/^\/plan\s+/i, '')
    .split('\n')[0]
    ?.trim()
  const rawTitle = ((userRequest ?? task ?? firstLine) || 'Agent task').trim()
  const title = sentenceCase(rawTitle)
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title
}

export function plainConversationPreview(value: string, maxLength = 88): string {
  const plain = value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, ' ')
    .replace(/[*_~#>|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxLength) return plain
  return `${plain.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

export function agentConversationTitle(thread: AgentConversationThread): string {
  return conciseTask(thread.task)
}
