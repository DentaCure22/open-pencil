import { describe, expect, test } from 'bun:test'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  createBoxModelBands,
  createGapMeasurements,
  resolveBoxModelMetrics
} from '@/app/smylr-live-inspector/box-model'

function child(id: string, x: number, y: number, width: number, height: number) {
  return {
    id,
    label: id,
    rect: { height, width, x, y }
  } satisfies SmylrLiveContainerNode
}

describe('Smylr live box-model overlay', () => {
  test('resolves computed and preview margin, border, and padding edges', () => {
    const metrics = resolveBoxModelMetrics(
      {
        'border-width': '2px',
        margin: '4px 8px 12px 16px',
        padding: '8px 16px'
      },
      {
        'padding-left': '24px'
      }
    )

    expect(metrics.margin).toEqual({ bottom: 12, left: 16, right: 8, top: 4 })
    expect(metrics.border).toEqual({ bottom: 2, left: 2, right: 2, top: 2 })
    expect(metrics.padding).toEqual({ bottom: 8, left: 24, right: 16, top: 8 })

    const content = createBoxModelBands(metrics, 200, 100).find((band) => band.layer === 'content')
    expect(content?.rect).toEqual({ height: 80, width: 156, x: 26, y: 10 })
    expect(
      createBoxModelBands(metrics, 200, 100).filter(
        (band) => band.layer === 'border' && band.showLabel
      )
    ).toHaveLength(1)
  })

  test('highlights horizontal and vertical gaps while labeling repeated values once', () => {
    const gaps = createGapMeasurements(
      [
        child('a', 0, 0, 40, 20),
        child('b', 52, 0, 40, 20),
        child('c', 0, 28, 40, 20),
        child('d', 52, 28, 40, 20)
      ],
      100,
      60
    )

    expect(gaps.some((gap) => gap.axis === 'horizontal' && gap.value === 12)).toBe(true)
    expect(gaps.some((gap) => gap.axis === 'vertical' && gap.value === 8)).toBe(true)
    expect(gaps.filter((gap) => gap.axis === 'horizontal' && gap.showLabel)).toHaveLength(1)
    expect(gaps.filter((gap) => gap.axis === 'vertical' && gap.showLabel)).toHaveLength(1)
  })
})
