import { describe, expect, test } from 'bun:test'

import {
  createWorkViewMemory,
  recordWorkViewMovement,
  rememberWorkViewSnapshot,
  workViewLocationKey,
  type WorkViewSnapshot
} from '@/app/flow-state'

const currentView: WorkViewSnapshot = {
  activeTool: 'SELECT',
  location: { kind: 'smylr-production-page', pageId: 'dental-chart' },
  selectedIds: ['current-alternate-frame'],
  viewport: { panX: 48, panY: 72, zoom: 0.8 }
}

const flowView: WorkViewSnapshot = {
  activeTool: 'HAND',
  location: { kind: 'smylr-flow-page', pageId: 'dental-chart' },
  selectedIds: ['flow-alternate-frame'],
  viewport: { panX: -240, panY: 96, zoom: 0.52 }
}

describe('flow-state view movement', () => {
  test('records the exact origin against the stable work item', () => {
    const movement = recordWorkViewMovement(
      'alternate-dental-chart',
      createWorkViewMemory(),
      currentView,
      flowView.location,
      {
        id: 'movement-current-to-flow',
        now: '2026-07-20T10:00:00.000Z'
      }
    )

    expect(movement.receipt).toMatchObject({
      from: currentView.location,
      id: 'movement-current-to-flow',
      itemId: 'alternate-dental-chart',
      origin: currentView,
      to: flowView.location
    })
    expect(movement.memory.views[workViewLocationKey(currentView.location)]).toEqual(currentView)
  })

  test('keeps independent camera, tool, and selection state for each view', () => {
    const withCurrent = rememberWorkViewSnapshot(createWorkViewMemory(), currentView)
    const withFlow = rememberWorkViewSnapshot(withCurrent, flowView)

    expect(withFlow.views[workViewLocationKey(currentView.location)]).toEqual(currentView)
    expect(withFlow.views[workViewLocationKey(flowView.location)]).toEqual(flowView)
    expect(withFlow.active).toEqual(flowView)

    flowView.selectedIds.push('later-mutation')
    expect(withFlow.views[workViewLocationKey(flowView.location)]?.selectedIds).toEqual([
      'flow-alternate-frame'
    ])
    flowView.selectedIds.pop()
  })
})
