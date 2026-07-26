import { describe, expect, test } from 'bun:test'

import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import { getBoxModelMetrics, getGapMeasurements } from '@/app/smylr-live-inspector/box-model'

const SELECTED_RECT = { height: 120, width: 240, x: 20, y: 30 }

describe('Smylr live box model', () => {
  test('normalizes asymmetric computed padding and borders', () => {
    const metrics = getBoxModelMetrics(SELECTED_RECT, {
      'border-bottom-width': '4px',
      'border-left-width': '5px',
      'border-right-width': '3px',
      'border-top-width': '2px',
      padding: '8px 12px 16px 20px'
    })

    expect(metrics.border).toEqual({ bottom: 4, left: 5, right: 3, top: 2 })
    expect(metrics.padding).toEqual({ bottom: 16, left: 20, right: 12, top: 8 })
    expect(metrics.contentWidth).toBe(200)
    expect(metrics.contentHeight).toBe(90)
  })

  test('lets preview shorthands override computed longhands', () => {
    const metrics = getBoxModelMetrics(
      SELECTED_RECT,
      {
        'padding-bottom': '4px',
        'padding-left': '4px',
        'padding-right': '4px',
        'padding-top': '4px'
      },
      { padding: '10px 20px' }
    )

    expect(metrics.padding).toEqual({ bottom: 10, left: 20, right: 20, top: 10 })
  })

  test('measures only direct flex gaps that match the computed gap', () => {
    const node: SmylrLiveContainerNode = {
      children: [
        { id: 'a', label: 'A', rect: { height: 20, width: 40, x: 30, y: 40 } },
        { id: 'b', label: 'B', rect: { height: 20, width: 40, x: 82, y: 40 } },
        { id: 'c', label: 'C', rect: { height: 20, width: 40, x: 30, y: 68 } }
      ],
      computedStyle: { display: 'flex', gap: '8px 12px' },
      id: 'root',
      label: 'Root',
      rect: SELECTED_RECT
    }

    expect(getGapMeasurements(node, SELECTED_RECT)).toEqual([
      { axis: 'horizontal', height: 20, value: 12, width: 12, x: 50, y: 10 },
      { axis: 'vertical', height: 8, value: 8, width: 40, x: 10, y: 30 }
    ])
  })

  test('suppresses gaps for non-layout containers and mismatched empty space', () => {
    const node: SmylrLiveContainerNode = {
      children: [
        { id: 'a', label: 'A', rect: { height: 20, width: 40, x: 20, y: 30 } },
        { id: 'b', label: 'B', rect: { height: 20, width: 40, x: 80, y: 30 } }
      ],
      computedStyle: { display: 'block', gap: '20px' },
      id: 'root',
      label: 'Root',
      rect: SELECTED_RECT
    }

    expect(getGapMeasurements(node, SELECTED_RECT)).toEqual([])
    node.computedStyle = { display: 'flex', gap: '12px' }
    expect(getGapMeasurements(node, SELECTED_RECT)).toEqual([])
  })
})
