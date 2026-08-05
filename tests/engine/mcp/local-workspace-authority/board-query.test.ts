import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  buildAuthorityBoardQueryIndex,
  parseAuthorityBoardReadQuery,
  queryAuthorityBoard
} from '#mcp/local-workspace-authority/board-query'

function frame(graph: SceneGraph, pageId: string, name: string, x: number, y: number) {
  return graph.createNode('FRAME', pageId, {
    height: 80,
    name,
    width: 160,
    x,
    y
  })
}

function text(
  graph: SceneGraph,
  pageId: string,
  name: string,
  value: string,
  x: number,
  y: number
) {
  return graph.createNode('TEXT', pageId, {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400,
    height: 24,
    name,
    text: value,
    width: 240,
    x,
    y
  })
}

function queryOptions(overrides: Partial<Parameters<typeof queryAuthorityBoard>[2]> = {}) {
  return {
    limit: 100,
    projection: 'summary' as const,
    query: { name: 'target' },
    sort: 'document' as const,
    tokenBudget: 1_500,
    ...overrides
  }
}

describe('local authority Board query', () => {
  test('filters by hierarchy, type, text, and spatial region with deterministic projections', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const container = frame(graph, page.id, 'Target container', 200, 300)
    text(graph, container.id, 'Milestone', 'Ship the target release', 20, 30)
    text(graph, page.id, 'Outside', 'Ship the target release', 1_000, 1_000)

    const result = queryAuthorityBoard(
      graph,
      page.id,
      queryOptions({
        projection: 'geometry',
        query: {
          parent_id: container.id,
          region: { height: 200, width: 300, x: 150, y: 250 },
          text: 'target release',
          types: ['TEXT']
        },
        sort: 'x'
      })
    )

    expect(result).toMatchObject({
      candidateCount: 1,
      matchedCount: 1,
      scannedCount: 1,
      truncated: false
    })
    expect(result.nodes).toEqual([
      expect.objectContaining({ parent_id: container.id, type: 'TEXT', visible: true })
    ])
    expect(result.nodes[0]).not.toHaveProperty('text')
    expect(result.nodes[0]).not.toHaveProperty('name')
  })

  test('caps long text previews and stops at the server token budget', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (let index = 0; index < 20; index += 1) {
      text(graph, page.id, `Target ${index}`, `target ${'x'.repeat(2_000)}`, index * 260, 0)
    }

    const result = queryAuthorityBoard(graph, page.id, queryOptions({ tokenBudget: 256 }))

    expect(result).toMatchObject({
      matchedCount: 20,
      tokenBudget: 256,
      truncated: true,
      truncationReason: 'token_budget'
    })
    expect(result.estimatedPayloadTokens).toBeLessThanOrEqual(256)
    expect(result.nodes.length).toBeGreaterThan(0)
    expect(result.nodes[0]).toMatchObject({ text_truncated: true })
    expect(String(result.nodes[0]?.text_preview).length).toBe(240)
  })

  test('keeps focused output bounded when the synthetic Board grows to 100,000 nodes', () => {
    const sizes = [1_000, 100_000]
    const payloadTokens: number[] = []

    for (const size of sizes) {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      for (let index = 0; index < size - 1; index += 1) {
        frame(graph, page.id, `Background ${index}`, index % 2_000, Math.floor(index / 2_000))
      }
      frame(graph, page.id, 'Needle target', 400, 500)
      const index = buildAuthorityBoardQueryIndex(graph, page.id)
      const result = queryAuthorityBoard(graph, page.id, queryOptions(), index)

      expect(result).toMatchObject({
        candidateCount: 1,
        indexedNodeCount: size,
        matchedCount: 1,
        scannedCount: 1,
        truncated: false
      })
      expect(result.nodes).toHaveLength(1)
      expect(result.estimatedPayloadTokens).toBeLessThanOrEqual(1_500)
      payloadTokens.push(result.estimatedPayloadTokens)
    }

    expect(Math.abs((payloadTokens[1] ?? 0) - (payloadTokens[0] ?? 0))).toBeLessThanOrEqual(4)
  })

  test('keeps short and oversized substring searches exact when an index cannot narrow them', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    frame(graph, page.id, 'AB target', 0, 0)
    text(graph, page.id, 'Large text', `${'x'.repeat(5_000)} hidden target`, 200, 0)
    const index = buildAuthorityBoardQueryIndex(graph, page.id)

    const short = queryAuthorityBoard(
      graph,
      page.id,
      queryOptions({ query: { name: 'ab' } }),
      index
    )
    const oversized = queryAuthorityBoard(
      graph,
      page.id,
      queryOptions({ query: { text: 'hidden target' } }),
      index
    )

    expect(short).toMatchObject({ candidateCount: 2, matchedCount: 1, scannedCount: 2 })
    expect(oversized).toMatchObject({ candidateCount: 1, matchedCount: 1, scannedCount: 1 })
  })

  test('rejects empty or structurally invalid queries before scanning the Board', () => {
    expect(() => parseAuthorityBoardReadQuery({})).toThrow(
      'board_read query requires at least one filter.'
    )
    expect(() => parseAuthorityBoardReadQuery({ name: 'target', unsupported: true })).toThrow(
      'query contains unsupported fields: unsupported.'
    )
    expect(() =>
      parseAuthorityBoardReadQuery({ region: { height: 0, width: 20, x: 0, y: 0 } })
    ).toThrow('query.region width and height must be positive.')
  })
})
