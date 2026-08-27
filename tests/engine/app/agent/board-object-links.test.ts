import { describe, expect, test } from 'bun:test'

import type { AiBoardObjectChange } from '@/app/agent-chat/types'
import { linkBoardObjectReferences } from '@/components/ai-elements/board-object-links'
import {
  assistantMarkdownNodes,
  type AssistantMarkdownNode
} from '@/components/ai-elements/markdown'

function objectLinks(nodes: readonly AssistantMarkdownNode[]): AssistantMarkdownNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'boardObjectLink' ? [node] : []),
    ...objectLinks(node.children ?? [])
  ])
}

const changes: AiBoardObjectChange[] = [
  { id: 'hero', name: 'Hero card', verb: 'created' },
  { id: 'copy', name: 'Summary copy', verb: 'edited' }
]

describe('inline Board object links', () => {
  test('links the first plain-text mention of each changed object', () => {
    const nodes = assistantMarkdownNodes(
      'Updated Hero card and Summary copy. Hero card is ready for review.'
    )
    const links = objectLinks(linkBoardObjectReferences(nodes, changes))

    expect(links.map((node) => node.boardObjectId)).toEqual(['hero', 'copy'])
    expect(links.map((node) => node.children?.[0]?.value)).toEqual(['Hero card', 'Summary copy'])
  })

  test('does not rewrite existing links or inline code', () => {
    const nodes = assistantMarkdownNodes(
      '[Hero card](https://example.com) and `Summary copy` stay unchanged.'
    )

    expect(objectLinks(linkBoardObjectReferences(nodes, changes))).toEqual([])
  })

  test('matches whole names without linking longer words', () => {
    const nodes: AssistantMarkdownNode[] = [{ type: 'text', value: 'Hero cards are grouped.' }]

    expect(objectLinks(linkBoardObjectReferences(nodes, changes))).toEqual([])
  })
})
