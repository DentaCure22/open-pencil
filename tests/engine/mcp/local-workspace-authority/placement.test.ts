import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { parseAuthorityCodeObjectIntent } from '#mcp/local-workspace-authority/code-object'
import { parseAuthorityCardOperation } from '#mcp/local-workspace-authority/native-card'
import { parseAuthorityTextOperation } from '#mcp/local-workspace-authority/native-text'
import { resolveAuthorityAnchoredPlacement } from '#mcp/local-workspace-authority/placement'

const directions = ['right', 'below', 'left', 'above'] as const

function placementFixture(blockDiagonal = false) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const anchor = graph.createNode('FRAME', page.id, {
    height: 100,
    name: 'Anchor',
    width: 100,
    x: 100,
    y: 100
  })
  if (blockDiagonal) {
    graph.createNode('FRAME', page.id, {
      height: 50,
      name: 'Diagonal blocker',
      width: 50,
      x: 220,
      y: 30
    })
  }
  return { anchor, graph, page }
}

describe('local authority relative placement', () => {
  test('normalizes a title-only native card with an empty body', () => {
    expect(
      parseAuthorityCardOperation({
        kind: 'native_card',
        placement: { target: { kind: 'auto' } },
        title: 'Title only'
      }).body
    ).toBe('')
  })

  test('tries the requested diagonal before the existing cardinal search', () => {
    const fixture = placementFixture()
    const diagonal = resolveAuthorityAnchoredPlacement({
      anchor: fixture.graph.getAbsoluteBounds(fixture.anchor.id),
      clearance: 20,
      footprint: { height: 50, width: 50 },
      graph: fixture.graph,
      pageId: fixture.page.id,
      preferredDirections: [...directions],
      relativeOffset: { column: 1, row: -1 }
    })
    expect(diagonal).toMatchObject({
      bounds: { height: 50, width: 50, x: 220, y: 30 },
      rejectedCandidates: 0
    })

    const cardinal = resolveAuthorityAnchoredPlacement({
      anchor: fixture.graph.getAbsoluteBounds(fixture.anchor.id),
      clearance: 20,
      footprint: { height: 50, width: 50 },
      graph: fixture.graph,
      pageId: fixture.page.id,
      preferredDirections: [...directions]
    })
    expect(cardinal.bounds).toMatchObject({ x: 220, y: 100 })
  })

  test('falls back collision-safely when the requested diagonal is occupied', () => {
    const fixture = placementFixture(true)
    const placed = resolveAuthorityAnchoredPlacement({
      anchor: fixture.graph.getAbsoluteBounds(fixture.anchor.id),
      clearance: 20,
      footprint: { height: 50, width: 50 },
      graph: fixture.graph,
      pageId: fixture.page.id,
      preferredDirections: [...directions],
      relativeOffset: { column: 1, row: -1 }
    })
    expect(placed).toMatchObject({
      bounds: { x: 220, y: 100 },
      rejectedCandidates: 1
    })
  })

  test('plumbs the normalized offset through card, text, and Code Object operations', async () => {
    expect(
      parseAuthorityCardOperation({
        body: 'Body',
        kind: 'native_card',
        placement: {
          relative_offset: { column: 1, row: -1 },
          target: { kind: 'relative', object_id: 'anchor' }
        },
        title: 'Card'
      })
    ).toMatchObject({ relativeOffset: { column: 1, row: -1 } })

    expect(
      parseAuthorityTextOperation(
        {
          kind: 'native_text',
          placement: { relative_offset: { column: -1, row: 1 } },
          text: 'Text'
        },
        'anchor'
      )
    ).toMatchObject({ relativeOffset: { column: -1, row: 1 } })

    const codeObject = await parseAuthorityCodeObjectIntent(
      {
        kind: 'code_object',
        name: 'Control',
        object_key: 'diagonal-control-v1',
        operation: 'create',
        placement: { relative_offset: { column: 1, row: 1 } },
        source: 'export default function App(){return <main>Control</main>}',
        source_format: 'tsx'
      },
      'anchor'
    )
    expect(codeObject.operation).toMatchObject({ relativeOffset: { column: 1, row: 1 } })
  })
})
