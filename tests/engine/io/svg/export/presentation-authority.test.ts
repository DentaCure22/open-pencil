import { describe, expect, test } from 'bun:test'

import { exportSVGOrThrow, makeGraph, pageId } from './helpers'

describe('SVG presentation authority', () => {
  test('ignores transient collaborative drag presentation', () => {
    const graph = makeGraph()
    const page = pageId(graph)
    const first = graph.createNode('RECTANGLE', page, {
      height: 20,
      width: 20,
      x: 10,
      y: 10
    })
    const second = graph.createNode('RECTANGLE', page, {
      height: 20,
      width: 20,
      x: 100,
      y: 10
    })
    graph.setNodePositionPresentation(first.id, { x: 500, y: 10 })

    const result = exportSVGOrThrow(graph, [first.id, second.id])
    expect(result).toContain('width="110"')
    expect(result).toContain('viewBox="0 0 110 20"')
  })
})
