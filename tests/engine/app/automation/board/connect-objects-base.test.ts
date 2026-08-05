import { describe, expect, test } from 'bun:test'

import { withConnectObjectsBase } from '@/app/automation/bridge/board-build/connect-objects-base'
import { isUnknownRecord } from '@/app/automation/bridge/target'

const CONNECT_OBJECTS_BASE = {
  content_document_id: 'content-document:connect-base',
  context_token: 'context:connect-base',
  document_id: 'document:connect-base',
  expected_revision: 18,
  page_id: 'page:connect-base',
  runtime_instance_id: 'runtime:connect-base',
  workspace_id: 'workspace:connect-base'
}

const FRESH_CONTEXT = {
  board_build_base: {
    ...CONNECT_OBJECTS_BASE,
    contract: 'board-build/v1'
  }
}

describe('board_build optional connect_objects base', () => {
  test('projects exactly the connector envelope for every successful recipe outcome', () => {
    const successfulRoutes = [
      { mutation: 'applied', route: 'native-text/v1' },
      { mutation: 'applied', route: 'native-card/v1' },
      { mutation: 'applied', route: 'native-diagram/mermaid/v1' },
      { mutation: 'applied', route: 'code-object/tsx-create/v1' },
      { mutation: 'applied', route: 'code-object/tsx-refine/v1' },
      { mutation: 'replayed', route: 'native-text/v1' },
      { mutation: 'replayed', route: 'code-object/tsx-refine/v1' },
      { mutation: 'no_change', route: 'native-diagram/mermaid/v1' },
      { mutation: 'no_change', route: 'code-object/tsx-refine/v1' }
    ]

    for (const scenario of successfulRoutes) {
      const result = withConnectObjectsBase({
        build: { route: { id: scenario.route } },
        context: FRESH_CONTEXT,
        receipt: { appliedRevision: 18 },
        status: { command: 'completed', mutation: scenario.mutation }
      })
      expect(result.connect_objects_base).toEqual(CONNECT_OBJECTS_BASE)
      expect(isUnknownRecord(result.connect_objects_base)).toBe(true)
      if (!isUnknownRecord(result.connect_objects_base)) {
        throw new Error('Successful build omitted connect_objects_base.')
      }
      expect(Object.keys(result.connect_objects_base).sort()).toEqual(
        Object.keys(CONNECT_OBJECTS_BASE).sort()
      )
    }
  })

  test('emits the connector envelope for an immediate completed apply at the same revision', () => {
    const result = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      owner_id: 'owner:immediate',
      receipt: { appliedRevision: 18, requestId: 'request:immediate' },
      status: { command: 'completed', mutation: 'applied' }
    })

    expect(result).toEqual({
      connect_objects_base: CONNECT_OBJECTS_BASE,
      context: FRESH_CONTEXT,
      owner_id: 'owner:immediate',
      receipt: { appliedRevision: 18, requestId: 'request:immediate' },
      status: { command: 'completed', mutation: 'applied' }
    })
  })

  test('emits the connector envelope for an immediate same-revision replay', () => {
    const result = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      owner_id: 'owner:replay',
      receipt: { appliedRevision: 18, requestId: 'request:replay' },
      status: { command: 'completed', mutation: 'replayed' }
    })

    expect(result.connect_objects_base).toEqual(CONNECT_OBJECTS_BASE)
  })

  test('preserves replay evidence but omits the connector envelope after the Board advances', () => {
    const advancedContext = {
      ...FRESH_CONTEXT,
      board_build_base: {
        ...FRESH_CONTEXT.board_build_base,
        expected_revision: 19
      }
    }
    const result = withConnectObjectsBase({
      context: advancedContext,
      owner_id: 'owner:original',
      receipt: { appliedRevision: 18, requestId: 'request:original' },
      status: { command: 'completed', mutation: 'replayed' }
    })

    expect(result).toEqual({
      context: advancedContext,
      owner_id: 'owner:original',
      receipt: { appliedRevision: 18, requestId: 'request:original' },
      status: { command: 'completed', mutation: 'replayed' }
    })
    expect(result).not.toHaveProperty('connect_objects_base')
  })

  test('omits the connector envelope unless completed proof and fresh context are present', () => {
    const unavailable = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      receipt: { appliedRevision: 18 },
      status: { command: 'unavailable', mutation: 'applied' }
    })
    const refused = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      receipt: { appliedRevision: 18 },
      status: { command: 'refused', mutation: 'not_applied' }
    })
    const needsInput = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      receipt: { appliedRevision: 18 },
      status: { command: 'needs_input', mutation: 'not_applied' }
    })
    const noFreshContext = withConnectObjectsBase({
      receipt: { appliedRevision: 18 },
      status: { command: 'completed', mutation: 'no_change' }
    })
    const noReceipt = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      status: { command: 'completed', mutation: 'applied' }
    })
    const invalidReceipt = withConnectObjectsBase({
      context: FRESH_CONTEXT,
      receipt: { appliedRevision: '18' },
      status: { command: 'completed', mutation: 'applied' }
    })

    expect(unavailable).not.toHaveProperty('connect_objects_base')
    expect(refused).not.toHaveProperty('connect_objects_base')
    expect(needsInput).not.toHaveProperty('connect_objects_base')
    expect(noFreshContext).not.toHaveProperty('connect_objects_base')
    expect(noReceipt).not.toHaveProperty('connect_objects_base')
    expect(invalidReceipt).not.toHaveProperty('connect_objects_base')
  })
})
