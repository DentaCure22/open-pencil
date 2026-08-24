import { describe, expect, test } from 'bun:test'

import {
  availableWorkLifecycleActions,
  createWorkLifecycleState,
  transitionWorkLifecycle
} from '@/app/flow-state'

describe('work lifecycle state machine', () => {
  test('keeps branch, review, approval, implementation, and verification ordered', () => {
    let state = createWorkLifecycleState('draft')
    const actions = [
      'start-branch',
      'request-review',
      'mark-preferred',
      'create-change-set',
      'approve',
      'start-implementation'
    ] as const

    for (const [index, action] of actions.entries()) {
      const result = transitionWorkLifecycle('alternate-a', state, {
        action,
        id: `receipt-${index}`,
        now: `2026-07-20T00:00:0${index}.000Z`
      })
      expect(result.ok).toBe(true)
      state = result.state
    }

    const withoutEvidence = transitionWorkLifecycle('alternate-a', state, { action: 'verify' })
    expect(withoutEvidence.ok).toBe(false)
    if (withoutEvidence.ok) throw new Error('verification unexpectedly succeeded')
    expect(withoutEvidence.reason).toContain('source patch')

    const verified = transitionWorkLifecycle('alternate-a', state, {
      action: 'verify',
      evidence: {
        realAppVerified: true,
        sourcePatchId: 'patch-1',
        testCommand: 'bun test flow-state',
        testPassed: true,
        verifiedBy: 'codex'
      },
      id: 'receipt-verified',
      now: '2026-07-20T00:00:07.000Z'
    })
    expect(verified.ok).toBe(true)
    expect(verified.state.status).toBe('verified')
    expect(verified.state.history.map((receipt) => receipt.action)).toEqual([...actions, 'verify'])
    expect(verified.state.history.at(-1)?.evidence?.realAppVerified).toBe(true)
  })

  test('rejects skipped stages and exposes only actions valid from the current state', () => {
    const review = createWorkLifecycleState('in-review')
    expect(availableWorkLifecycleActions(review)).toEqual([
      'request-changes',
      'mark-preferred',
      'archive'
    ])

    const prematureApproval = transitionWorkLifecycle('alternate-b', review, {
      action: 'approve'
    })
    expect(prematureApproval.ok).toBe(false)
    if (prematureApproval.ok) throw new Error('approval unexpectedly succeeded')
    expect(prematureApproval.reason).toContain('unavailable from In review')
    expect(prematureApproval.state).toBe(review)
  })
})
