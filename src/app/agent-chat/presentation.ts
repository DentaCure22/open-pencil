import type { AgentConversationThread } from './conversations'

function sentenceCase(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

const IMAGE_EXTENSION = '(?:png|jpe?g|webp|gif)'
const CAPTURE_FILENAME = new RegExp(
  `^(?:chrome-selection-.+|screenshots?[\\s._-].+|screen[\\s_-]?shot[\\s._-].+)\\.${IMAGE_EXTENSION}$`,
  'i'
)
const IMAGE_FILENAME = new RegExp(`^[^,\\n/\\\\]+\\.${IMAGE_EXTENSION}$`, 'i')

function isImageFilename(value: string): boolean {
  return IMAGE_FILENAME.test(value)
}

function isCaptureFilename(value: string): boolean {
  return CAPTURE_FILENAME.test(value)
}

/** Keep in sync with the same helper in packages/mcp/src/pi/router-state.ts */
function humanizeImageOnlyConversationTitle(title: string): string {
  const parts = title
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length || !parts.every(isImageFilename)) return title
  if (parts.every(isCaptureFilename)) return 'Screenshot'
  return parts.length === 1 ? 'Image' : `${String(parts.length)} images`
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
  const title = sentenceCase(humanizeImageOnlyConversationTitle(rawTitle))
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
  return thread.title?.trim() || conciseTask(thread.task)
}
