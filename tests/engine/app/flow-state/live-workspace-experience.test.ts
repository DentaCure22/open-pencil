import { afterEach, describe, expect, test } from 'bun:test'

import { reactive } from 'vue'

import { createEditorStore } from '@/app/editor/session'
import {
  createWorkLifecycleState,
  transitionWorkLifecycle,
  type WorkLifecycleAction,
  type WorkLifecycleState
} from '@/app/flow-state'
import { syncLiveWorkspaceExperienceProjection } from '@/app/smylr-live-inspector/experience-projections'
import type { LiveWorkspaceItem } from '@/app/smylr-live-inspector/workspace'
import { createSmylrProductionWorkspaceGraph } from '@/app/smylr-production/workspace'
import { workspaceRegistry } from '@/app/workspace'
import { resolveExperienceProjections } from '@/app/workspace-ui/experience-projections'

function approvedLifecycle(): WorkLifecycleState {
  let state = createWorkLifecycleState('draft')
  const actions: WorkLifecycleAction[] = [
    'start-branch',
    'request-review',
    'mark-preferred',
    'create-change-set',
    'approve'
  ]
  actions.forEach((action, index) => {
    const result = transitionWorkLifecycle('alternate-experience', state, {
      action,
      id: `receipt-${action}`,
      now: `2026-07-20T10:0${index}:00.000Z`
    })
    if (!result.ok) throw new Error(result.reason)
    state = result.state
  })
  return state
}

function item(): LiveWorkspaceItem {
  return {
    branch: { name: 'codex/alternate-experience', status: 'ready-for-review' },
    changeSet: {
      acceptanceCriteria: ['Preserve the exact Dental Chart state and return path'],
      patchIds: ['patch-experience'],
      sourceTargets: ['src/dental-chart.tsx'],
      verificationStatus: 'workspace-checked'
    },
    createdAt: '2026-07-20T09:00:00.000Z',
    id: 'alternate-experience',
    kind: 'variant',
    lifecycle: approvedLifecycle(),
    name: 'Dental Chart alternate',
    nodeId: 'dental-chart-root',
    note: 'Review the charting experience before implementation.',
    patch: {
      add: [],
      nodeId: 'dental-chart-root',
      remove: [],
      source: { componentName: 'DentalChart', filePath: 'src/dental-chart.tsx' }
    },
    route: '/dental-chart',
    status: 'approved',
    updatedAt: '2026-07-20T10:05:00.000Z'
  }
}

afterEach(() => workspaceRegistry.clear())

describe('live workspace experience projections', () => {
  test('uses one stable alternate and exact lifecycle revision in every projection purpose', () => {
    const graph = createSmylrProductionWorkspaceGraph({ selectedPageId: 'dental-chart' }).graph
    const store = createEditorStore(graph)
    const alternate = item()

    const projection = syncLiveWorkspaceExperienceProjection(store, alternate)
    const root = projection.workspace.objects[alternate.id]
    if (!root || root.type !== 'surface-run') throw new Error('Projection root is missing')
    const resolved = resolveExperienceProjections(projection.workspace, projection.rootSurface)

    expect(root.id).toBe(alternate.id)
    expect(root.artifact.boardRevision).toBe(alternate.lifecycle.revision)
    expect(root.interactions.map((interaction) => interaction.id)).toEqual(
      alternate.lifecycle.history.map((receipt) => receipt.id)
    )
    expect(resolved.availablePurposes).toEqual(['focus', 'compare', 'knowledge', 'review'])
    expect(resolved.comparison).toMatchObject({
      basis: 'companion-surfaces',
      status: 'available'
    })
    expect(resolved.members.compare[0]?.objectId).toBe(alternate.id)
    expect(resolved.members.focus[0]?.objectId).toBe(alternate.id)
    expect(resolved.members.knowledge.some((member) => member.objectId === alternate.id)).toBe(true)
    expect(resolved.members.review.some((member) => member.objectId === alternate.id)).toBe(true)
    expect(
      resolved.members.review.find((member) => member.role === 'review-object')?.objectId
    ).toBe('alternate-experience__transition-v2-receipt-approve')

    store.dispose()
  })

  test('reuses the same workspace objects when synchronized again', () => {
    const graph = createSmylrProductionWorkspaceGraph({ selectedPageId: 'dental-chart' }).graph
    const store = createEditorStore(graph)
    const alternate = item()
    const first = syncLiveWorkspaceExperienceProjection(store, alternate)
    const second = syncLiveWorkspaceExperienceProjection(store, alternate)

    expect(second.rootSurface).toEqual(first.rootSurface)
    expect(Object.keys(second.workspace.objects)).toEqual(Object.keys(first.workspace.objects))
    expect(second.workspace.revision).toBe(first.workspace.revision)

    store.dispose()
  })

  test('snapshots reactive app state into clone-safe workspace objects', () => {
    const graph = createSmylrProductionWorkspaceGraph({ selectedPageId: 'dental-chart' }).graph
    const store = createEditorStore(graph)

    const projection = syncLiveWorkspaceExperienceProjection(store, reactive(item()))
    expect(() => structuredClone(projection.workspace)).not.toThrow()

    store.dispose()
  })
})
