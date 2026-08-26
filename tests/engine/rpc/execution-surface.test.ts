import { describe, expect, test } from 'bun:test'

import {
  classifyRpcExecutionSurface,
  normalizePersistedExecutionError,
  persistedAuthorityUnavailableError
} from '@open-pencil/core/rpc'

describe('RPC execution-surface classifier', () => {
  test('defaults Board reads without runtime identity to persisted authority', () => {
    expect(classifyRpcExecutionSurface('board_context', { target: 'current' })).toBe(
      'persisted_authority'
    )
    expect(classifyRpcExecutionSurface('board_read')).toBe('persisted_authority')
    expect(classifyRpcExecutionSurface('board_apply')).toBe('persisted_authority')
  })

  test('keeps durable read commands on authority even with a stale live identity', () => {
    expect(
      classifyRpcExecutionSurface('trace_query', { runtime_instance_id: 'runtime:live-editor' })
    ).toBe('persisted_authority')
  })

  test('does not classify removed Board authoring commands', () => {
    for (const command of ['board_build', 'board_change', 'board_fixture']) {
      expect(() => classifyRpcExecutionSurface(command)).toThrow(
        'rpc_execution_surface_unclassified'
      )
    }
  })

  test('keeps live-only commands and current_visible on the live runtime', () => {
    expect(classifyRpcExecutionSurface('board_present')).toBe('live_runtime')
    expect(classifyRpcExecutionSurface('board_context', { target: 'current_visible' })).toBe(
      'live_runtime'
    )
    expect(classifyRpcExecutionSurface('tool', { name: 'create_page' })).toBe('live_runtime')
  })

  test('keeps persisted search off the live runtime', () => {
    expect(classifyRpcExecutionSurface('workspace_search')).toBe('persisted_authority')
  })

  test('uses authority-specific errors instead of live-runtime errors', () => {
    expect(persistedAuthorityUnavailableError('board_read').message).toStartWith(
      'persisted_authority_unavailable:'
    )
    expect(
      normalizePersistedExecutionError(
        'trace_query',
        new Error('no_live_runtime: trace_query requires a live runtime')
      ).message
    ).toStartWith('persisted_command_unsupported:')
  })
})
