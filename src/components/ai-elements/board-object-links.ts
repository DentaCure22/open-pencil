import type { InjectionKey } from 'vue'

import type { AiBoardObjectChange } from '@/app/agent-chat/types'

import type { AssistantMarkdownNode } from './markdown'

export type BoardObjectLinkContext = {
  hover: (id: string | null) => void
  open: (id: string) => void
}

export const boardObjectLinkContextKey: InjectionKey<BoardObjectLinkContext> = Symbol(
  'board-object-link-context'
)

type LinkCandidate = {
  id: string
  lowerName: string
  name: string
}

type TextMatch = LinkCandidate & { index: number }

const SKIPPED_NODE_TYPES = new Set(['boardObjectLink', 'code', 'image', 'inlineCode', 'link'])
const WORD_CHARACTER = /[\p{L}\p{N}_]/u

function candidates(changes: readonly AiBoardObjectChange[]): LinkCandidate[] {
  const seen = new Set<string>()
  return changes
    .flatMap((change) => {
      const name = change.name.trim()
      const lowerName = name.toLocaleLowerCase()
      if (name.length < 3 || lowerName === 'board object' || seen.has(lowerName)) return []
      seen.add(lowerName)
      return [{ id: change.id, lowerName, name }]
    })
    .sort((left, right) => right.name.length - left.name.length)
}

function validBoundary(text: string, index: number, length: number): boolean {
  const first = text[index] ?? ''
  const last = text[index + length - 1] ?? ''
  const before = text[index - 1] ?? ''
  const after = text[index + length] ?? ''
  if (WORD_CHARACTER.test(first) && WORD_CHARACTER.test(before)) return false
  if (WORD_CHARACTER.test(last) && WORD_CHARACTER.test(after)) return false
  return true
}

function nextCandidate(
  text: string,
  lowerText: string,
  from: number,
  available: readonly LinkCandidate[]
): TextMatch | null {
  let best: TextMatch | null = null
  for (const candidate of available) {
    let index = lowerText.indexOf(candidate.lowerName, from)
    while (index >= 0 && !validBoundary(text, index, candidate.name.length)) {
      index = lowerText.indexOf(candidate.lowerName, index + candidate.name.length)
    }
    if (index < 0) continue
    if (
      !best ||
      index < best.index ||
      (index === best.index && candidate.name.length > best.name.length)
    ) {
      best = { ...candidate, index }
    }
  }
  return best
}

function linkTextNode(
  node: AssistantMarkdownNode,
  available: readonly LinkCandidate[],
  linkedIds: Set<string>
): AssistantMarkdownNode[] {
  const value = node.value ?? ''
  if (!value || available.length === 0) return [node]
  const lowerValue = value.toLocaleLowerCase()
  const result: AssistantMarkdownNode[] = []
  let cursor = 0

  while (cursor < value.length) {
    const match = nextCandidate(
      value,
      lowerValue,
      cursor,
      available.filter((candidate) => !linkedIds.has(candidate.id))
    )
    if (!match) break
    if (match.index > cursor) result.push({ type: 'text', value: value.slice(cursor, match.index) })
    const end = match.index + match.name.length
    result.push({
      boardObjectId: match.id,
      children: [{ type: 'text', value: value.slice(match.index, end) }],
      type: 'boardObjectLink'
    })
    linkedIds.add(match.id)
    cursor = end
  }

  if (cursor === 0) return [node]
  if (cursor < value.length) result.push({ type: 'text', value: value.slice(cursor) })
  return result
}

function linkNodes(
  nodes: readonly AssistantMarkdownNode[],
  available: readonly LinkCandidate[],
  linkedIds: Set<string>
): AssistantMarkdownNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'text') return linkTextNode(node, available, linkedIds)
    if (SKIPPED_NODE_TYPES.has(node.type) || !node.children?.length) return [node]
    return [{ ...node, children: linkNodes(node.children, available, linkedIds) }]
  })
}

export function linkBoardObjectReferences(
  nodes: readonly AssistantMarkdownNode[],
  changes: readonly AiBoardObjectChange[],
  linkedIds = new Set<string>()
): AssistantMarkdownNode[] {
  return linkNodes(nodes, candidates(changes), linkedIds)
}
