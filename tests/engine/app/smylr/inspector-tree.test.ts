import { describe, expect, test } from 'bun:test'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  createLiveInspectorTreeIndex,
  findLiveInspectorNode,
  findLiveInspectorNodeRect
} from '@/app/smylr-live-inspector/tree'

function node(
  id: string,
  x: number,
  y: number,
  children: SmylrLiveContainerNode[] = []
): SmylrLiveContainerNode {
  return {
    children,
    id,
    label: id,
    rect: { height: 40, width: 80, x, y }
  }
}

function tree() {
  return node('root', 10, 20, [node('first', 5, 7, [node('nested', 3, 4)]), node('last', 90, 8)])
}

describe('Smylr live-inspector tree index', () => {
  test('indexes identities and resolves parent-relative bounds once', () => {
    const root = tree()
    const index = createLiveInspectorTreeIndex(root)

    expect(index.node('nested')?.label).toBe('nested')
    expect(index.rect('nested')).toEqual({ height: 40, width: 80, x: 18, y: 31 })
    expect(index.flatNodes.map(({ depth, node }) => [node.id, depth])).toEqual([
      ['root', 0],
      ['first', 1],
      ['nested', 2],
      ['last', 1]
    ])
  })

  test('navigates the indexed hierarchy without exposing its maps', () => {
    const index = createLiveInspectorTreeIndex(tree())

    expect(index.adjacentNode('root', 'child')?.id).toBe('first')
    expect(index.adjacentNode('nested', 'parent')?.id).toBe('first')
    expect(index.adjacentNode('first', 'next')?.id).toBe('nested')
    expect(index.adjacentNode('last', 'previous')?.id).toBe('nested')
  })

  test('keeps the compatibility lookups on the same tree semantics', () => {
    const root = tree()

    expect(findLiveInspectorNode(root, 'last')?.id).toBe('last')
    expect(findLiveInspectorNodeRect(root, 'last')).toEqual({
      height: 40,
      width: 80,
      x: 100,
      y: 28
    })
  })
})
