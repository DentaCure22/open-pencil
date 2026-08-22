import { describe, expect, test } from 'bun:test'

import { assertGuardedAutomationTarget } from '@/app/automation/bridge/exact-target'

describe('live automation target guards', () => {
  test('allows current-visible context without a persisted target', () => {
    expect(() =>
      assertGuardedAutomationTarget('board_context', { target: 'current_visible' })
    ).not.toThrow()
    expect(() =>
      assertGuardedAutomationTarget('board_context', {
        page_id: 'page:1',
        target: 'current_visible'
      })
    ).toThrow('cannot be combined')
  })

  test('requires an exact live target for presentation', () => {
    expect(() => assertGuardedAutomationTarget('board_present', {})).toThrow(
      'runtime_instance_id, page_id'
    )
    expect(() =>
      assertGuardedAutomationTarget('board_present', {
        document_id: 'document:1',
        page_id: 'page:1',
        runtime_instance_id: 'runtime:1'
      })
    ).not.toThrow()
  })

  test('requires guarded metadata only for mutating primitive tools', () => {
    expect(() => assertGuardedAutomationTarget('tool', { args: {}, name: 'create_shape' })).toThrow(
      'exact target fields'
    )
    expect(() =>
      assertGuardedAutomationTarget('tool', {
        args: {},
        content_document_id: 'content:1',
        document_id: 'document:1',
        mutation: { expectedRevision: 0, requestId: 'request:1' },
        name: 'create_shape',
        page_id: 'page:1',
        runtime_instance_id: 'runtime:1'
      })
    ).not.toThrow()
    expect(() =>
      assertGuardedAutomationTarget('tool', { args: {}, name: 'get_node' })
    ).not.toThrow()
  })
})
