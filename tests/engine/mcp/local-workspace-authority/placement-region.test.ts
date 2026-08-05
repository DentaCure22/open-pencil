import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  AuthorityPlacementError,
  parseAuthorityFreePlacementTarget,
  resolveAuthorityFreePlacement
} from '#mcp/local-workspace-authority/placement'

function placementFixture() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.createNode('FRAME', page.id, {
    height: 100,
    name: 'Trace-area blocker',
    width: 100,
    x: 100,
    y: 100
  })
  return { graph, page }
}

describe('local authority region placement', () => {
  test('parses near_region as an explicit placement target', () => {
    expect(
      parseAuthorityFreePlacementTarget({
        height: 100,
        kind: 'near_region',
        width: 100,
        x: 100,
        y: 100
      })
    ).toEqual({ height: 100, kind: 'near_region', width: 100, x: 100, y: 100 })
  })

  test('keeps explicit region placement strict', () => {
    const fixture = placementFixture()
    expect(() =>
      resolveAuthorityFreePlacement({
        clearance: 20,
        footprint: { height: 100, width: 100 },
        graph: fixture.graph,
        pageId: fixture.page.id,
        target: { height: 100, kind: 'region', width: 100, x: 100, y: 100 }
      })
    ).toThrow(AuthorityPlacementError)
  })

  test('searches outward deterministically only for near-region placement', () => {
    const fixture = placementFixture()
    const placed = resolveAuthorityFreePlacement({
      clearance: 20,
      footprint: { height: 100, width: 100 },
      graph: fixture.graph,
      pageId: fixture.page.id,
      target: { height: 100, kind: 'near_region', width: 100, x: 100, y: 100 }
    })

    expect(placed).toMatchObject({
      bounds: { height: 100, width: 100, x: 220, y: 100 },
      rejectedCandidates: 1
    })
  })
})
