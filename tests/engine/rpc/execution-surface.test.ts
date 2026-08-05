import { describe, expect, test } from 'bun:test'

import {
  classifyRpcExecutionSurface,
  normalizePersistedExecutionError,
  persistedAuthorityUnavailableError
} from '@open-pencil/core/rpc'

describe('RPC execution-surface classifier', () => {
  test('defaults Board work without runtime identity to persisted authority', () => {
    expect(classifyRpcExecutionSurface('board_build')).toBe('persisted_authority')
    expect(classifyRpcExecutionSurface('board_context', { target: 'current' })).toBe(
      'persisted_authority'
    )
    expect(
      classifyRpcExecutionSurface('board_build', { runtime_instance_id: 'local-authority:1' })
    ).toBe('persisted_authority')
  })

  test('honors explicit live identity only for dual-surface commands', () => {
    expect(
      classifyRpcExecutionSurface('board_build', { runtime_instance_id: 'runtime:live-editor' })
    ).toBe('live_runtime')
    expect(
      classifyRpcExecutionSurface('trace_query', { runtime_instance_id: 'runtime:live-editor' })
    ).toBe('persisted_authority')
  })

  test('keeps live-only commands and current_visible on the live runtime', () => {
    expect(classifyRpcExecutionSurface('board_present')).toBe('live_runtime')
    expect(classifyRpcExecutionSurface('board_context', { target: 'current_visible' })).toBe(
      'live_runtime'
    )
  })

  test('keeps persisted metadata reads off the live runtime', () => {
    expect(classifyRpcExecutionSurface('get_mermaid_source')).toBe('persisted_authority')
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
