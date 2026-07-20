import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { getDesignOutlineChildren } from '@/app/smylr-production/design-layer-outline'

describe('Smylr design layer outline', () => {
  test('leaves ordinary pages on the native full-tree path', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('RECTANGLE', page.id, { name: 'Ordinary layer' })

    expect(getDesignOutlineChildren(graph, page)).toBeUndefined()
  })

  test('keeps non-decorative rectangles and nested containers', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const board = graph.createNode('FRAME', page.id, {
      name: 'Design System · Light'
    })
    const surface = graph.createNode('RECTANGLE', board.id, {
      name: 'Card surface'
    })
    const group = graph.createNode('GROUP', board.id, { name: 'Nested group' })
    const nested = graph.createNode('RECTANGLE', group.id, {
      name: 'Nested surface'
    })

    const pageRows = getDesignOutlineChildren(graph, page)
    const boardRow = pageRows?.find((row) => row.id === board.id)

    expect(boardRow?.children?.some((row) => row.id === surface.id)).toBe(true)
    expect(
      boardRow?.children
        ?.find((row) => row.id === group.id)
        ?.children?.some((row) => row.id === nested.id)
    ).toBe(true)
  })

  test('keeps valid page-level leaf layers once Smylr outlining is active', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, { name: 'Live Smylr App / Treatment Plan' })
    const leaf = graph.createNode('RECTANGLE', page.id, { name: 'Page overlay' })

    const rows = getDesignOutlineChildren(graph, page)

    expect(rows?.some((row) => row.id === leaf.id)).toBe(true)
  })
})
