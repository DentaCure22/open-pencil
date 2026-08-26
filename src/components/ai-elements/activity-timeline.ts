import { isRetiredMemoryTool, toolCallKind } from './model'
import type { AiConversationStatus, AiMessagePart, AiToolState } from './types'

export type ActivityToolPart = Extract<AiMessagePart, { type: 'tool' }>
export type ActivityCommentaryPart = Extract<AiMessagePart, { type: 'commentary' }>
export type ActivityReasoningPart = Extract<AiMessagePart, { type: 'reasoning' }>

export type ActivityItem = {
  index: number
  key: string
  part: ActivityCommentaryPart | ActivityReasoningPart | ActivityToolPart
}

export type ActivityCommentaryGroup = {
  item: ActivityItem & { part: ActivityCommentaryPart }
  key: string
  type: 'commentary'
}

export type ActivityToolGroup = {
  items: Array<ActivityItem & { part: ActivityToolPart }>
  key: string
  open: boolean
  type: 'tools'
}

export type ActivityReasoningGroup = {
  item: ActivityItem & { part: ActivityReasoningPart }
  key: string
  type: 'reasoning'
}

export type ActivityGroup = ActivityCommentaryGroup | ActivityReasoningGroup | ActivityToolGroup

function counted(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`
}

export function activityExploreLabel(tools: Array<{ input?: string; name: string }>): string {
  if (!tools.length) return ''
  let files = 0
  let searches = 0
  let commands = 0
  let edits = 0
  let other = 0
  for (const tool of tools) {
    const kind = toolCallKind(tool.name, tool.input)
    if (kind === 'read' || kind === 'list') files += 1
    else if (kind === 'search') searches += 1
    else if (kind === 'command') commands += 1
    else if (kind === 'edit') edits += 1
    else other += 1
  }
  const parts: string[] = []
  if (files) parts.push(`Explored ${counted(files, 'file', 'files')}`)
  if (searches) parts.push(counted(searches, 'search', 'searches'))
  if (commands) parts.push(commands === 1 ? 'ran 1 command' : `ran ${String(commands)} commands`)
  if (edits) parts.push(edits === 1 ? 'edited 1 file' : `edited ${String(edits)} files`)
  if (other && !parts.length)
    parts.push(other === 1 ? 'Used 1 tool' : `Used ${String(other)} tools`)
  else if (other) parts.push(counted(other, 'other', 'others'))
  return parts.join(', ')
}

export function toolGroupIsOpen(input: {
  followedByNarrative: boolean
  hasRunningTool: boolean
  status: AiConversationStatus
}): boolean {
  // T3 keeps the live tool lane to one compact row. Details expand only when
  // the user asks, which prevents tool output from repeatedly changing the
  // transcript height while a turn is running.
  void input
  return false
}

function isRunningTool(state: AiToolState | 'stopped'): boolean {
  return state === 'pending' || state === 'running'
}

export function groupActivityTimeline(
  items: readonly ActivityItem[],
  status: AiConversationStatus,
  toolState: (item: ActivityItem & { part: ActivityToolPart }) => AiToolState | 'stopped'
): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  for (const item of items) {
    if (item.part.type === 'commentary') {
      groups.push({
        item: { ...item, part: item.part },
        key: item.key,
        type: 'commentary'
      })
      continue
    }
    if (item.part.type === 'reasoning') {
      groups.push({
        item: { ...item, part: item.part },
        key: item.key,
        type: 'reasoning'
      })
      continue
    }
    if (isRetiredMemoryTool(item.part.name)) continue
    const tool = { ...item, part: item.part }
    const previous = groups.at(-1)
    if (previous?.type === 'tools') {
      previous.items.push(tool)
      continue
    }
    groups.push({
      items: [tool],
      key: `tools:${item.key}`,
      open: false,
      type: 'tools'
    })
  }
  const resolved = groups.map((group, index) => {
    if (group.type !== 'tools') return group
    const followedByNarrative = groups.slice(index + 1).some((item) => item.type !== 'tools')
    return {
      ...group,
      open: toolGroupIsOpen({
        followedByNarrative,
        hasRunningTool: group.items.some((item) => isRunningTool(toolState(item))),
        status
      })
    }
  })
  return resolved
}
