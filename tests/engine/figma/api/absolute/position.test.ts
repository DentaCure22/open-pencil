import { describe, expect, test } from 'bun:test'

import { createAPI } from '../helpers'

describe('absolute position', () => {
  test('absoluteBoundingBox accounts for nesting', () => {
    const api = createAPI()
    const parent = api.createFrame()
    parent.x = 100
    parent.y = 200
    const child = api.createRectangle()
    parent.appendChild(child)
    child.x = 10
    child.y = 20
    child.resize(50, 30)
    const bounds = child.absoluteBoundingBox
    expect(bounds.x).toBe(110)
    expect(bounds.y).toBe(220)
    expect(bounds.width).toBe(50)
    expect(bounds.height).toBe(30)
  })

  test('model geometry ignores transient collaborative drag presentation', () => {
    const api = createAPI()
    const parent = api.createFrame()
    parent.x = 100
    parent.y = 200
    const child = api.createRectangle()
    parent.appendChild(child)
    child.x = 10
    child.y = 20
    child.resize(50, 30)

    api.graph.setNodePositionPresentation(parent.id, { x: 800, y: 900 })
    api.graph.setNodePositionPresentation(child.id, { x: 300, y: 400 })

    expect(api.graph.getAbsolutePosition(child.id)).toEqual({ x: 1100, y: 1300 })
    expect(child.absoluteTransform).toEqual([
      [1, 0, 110],
      [0, 1, 220]
    ])
    expect(child.absoluteBoundingBox).toEqual({ height: 30, width: 50, x: 110, y: 220 })
    expect(child.absoluteRenderBounds).toEqual({ height: 30, width: 50, x: 110, y: 220 })
  })
})
