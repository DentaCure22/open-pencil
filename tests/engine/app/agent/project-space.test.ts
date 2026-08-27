import { describe, expect, test } from 'bun:test'

import {
  collapsedProjectDirectoryLayout,
  fluidProjectTerritoryAppearance,
  rectOverlapRatio,
  shouldDetachFromFluidProjectSpace,
  workMapProjectSpaceBindings
} from '@/app/agent-chat/project-space'
import type { AgentWorkMap } from '@/app/agent-chat/work-map'

function workMap(): AgentWorkMap {
  return {
    bots: [],
    inbox: [],
    placements: [],
    projects: [
      {
        createdAt: '2026-08-26T00:00:00.000Z',
        id: 'project-1',
        name: 'Dental Chart',
        spaceFrameId: 'frame-1',
        spacePageId: 'page-1',
        updatedAt: '2026-08-26T00:00:00.000Z'
      },
      {
        createdAt: '2026-08-26T00:00:00.000Z',
        id: 'project-2',
        name: 'Other page',
        spaceFrameId: 'frame-2',
        spacePageId: 'page-2',
        updatedAt: '2026-08-26T00:00:00.000Z'
      }
    ],
    revision: 1,
    routines: [],
    todos: []
  }
}

describe('Work Map project frames', () => {
  test('resolves only exact frame bindings on the current page', () => {
    expect(workMapProjectSpaceBindings(workMap(), 'page-1')).toEqual([
      {
        frameId: 'frame-1',
        project: expect.objectContaining({ id: 'project-1', name: 'Dental Chart' })
      }
    ])
  })

  test('keeps a crossing object attached until the release is deliberate', () => {
    const parent = { width: 400, height: 300 }
    const stillConnected = { x: 360, y: 80, width: 100, height: 100 }
    const crossed = { x: 390, y: 80, width: 100, height: 100 }

    expect(rectOverlapRatio(stillConnected, parent)).toBeCloseTo(0.4)
    expect(shouldDetachFromFluidProjectSpace(stillConnected, parent)).toBe(false)
    expect(shouldDetachFromFluidProjectSpace(crossed, parent)).toBe(true)
  })

  test('rests as a normal rounded frame and stretches toward the moving child', () => {
    const frame = { width: 520, height: 360 }
    const resting = fluidProjectTerritoryAppearance(frame, [])
    const pulled = fluidProjectTerritoryAppearance(frame, [
      { x: 490, y: 230, width: 120, height: 100 }
    ])

    expect(resting).toMatchObject({ bottom: 0, left: 0, right: 0, top: 0 })
    expect(resting.borderRadius).toBe('18px 18px 18px 18px / 18px 18px 18px 18px')
    expect(pulled.right).toBeGreaterThan(50)
    expect(pulled.top).toBe(0)
    expect(pulled.tension).toBeGreaterThan(0.6)
    expect(pulled.detachReady).toBe(true)
    expect(pulled.borderRadius).not.toBe(resting.borderRadius)
  })

  test('packs closed sub-bot directories into deterministic parent rows', () => {
    const parent = { height: 520, width: 700, x: 100, y: 80 }

    expect(collapsedProjectDirectoryLayout(parent, 0)).toEqual({
      height: 48,
      width: 228,
      x: 116,
      y: 536
    })
    expect(collapsedProjectDirectoryLayout(parent, 1)).toEqual({
      height: 48,
      width: 228,
      x: 352,
      y: 536
    })
    expect(collapsedProjectDirectoryLayout(parent, 2)).toEqual({
      height: 48,
      width: 228,
      x: 116,
      y: 480
    })

    expect(
      collapsedProjectDirectoryLayout({ height: 891, width: 1224, x: -270, y: -149 }, 0, {
        height: 742,
        width: 517,
        x: 255,
        y: 0
      })
    ).toEqual({
      height: 48,
      width: 228,
      x: 271,
      y: 678
    })
  })
})
