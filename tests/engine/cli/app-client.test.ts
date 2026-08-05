import { describe, expect, test } from 'bun:test'

import {
  directOrNestedRpcResult,
  isRetryableNamedTargetError,
  isRetryableWorkspaceTargetError
} from '#cli/app-client'

describe('direct app RPC result compatibility', () => {
  test('keeps live Code Object fields while excluding the routing envelope', () => {
    expect(
      directOrNestedRpcResult({
        component: { definition_id: 'decision-lens', source_hash: 'sha256:current' },
        frame: { id: '0:299' },
        ok: true,
        target: {
          boardRevision: 4,
          documentId: 'tab-1',
          documentName: 'OpenPencil Workspace',
          pageId: '0:4170',
          pageName: 'Native Connectors — Example'
        }
      })
    ).toEqual({
      component: { definition_id: 'decision-lens', source_hash: 'sha256:current' },
      frame: { id: '0:299' }
    })
  })

  test('keeps legacy nested results unchanged', () => {
    expect(
      directOrNestedRpcResult({
        ok: true,
        result: { component: { definition_id: 'decision-lens' }, frame: { id: '0:299' } },
        target: {
          boardRevision: 4,
          documentId: 'tab-1',
          documentName: 'OpenPencil Workspace',
          pageId: '0:4170',
          pageName: 'Native Connectors — Example'
        }
      })
    ).toEqual({ component: { definition_id: 'decision-lens' }, frame: { id: '0:299' } })
  })
})

describe('named app target reconnect recovery', () => {
  test('retries transient server, client, and hydration failures', () => {
    const documentName = 'Smylr Production Canvas'
    const messages = [
      'Could not connect to OpenPencil app on localhost:7600.',
      'OpenPencil app is running but no document is open.',
      'Active OpenPencil client changed',
      'Browser disconnected',
      `Document named "${documentName}" not found`
    ]

    for (const message of messages) {
      expect(isRetryableNamedTargetError(new Error(message), documentName)).toBe(true)
    }
  })

  test('does not retry ambiguity or semantic board failures', () => {
    const documentName = 'Smylr Production Canvas'
    expect(
      isRetryableNamedTargetError(
        new Error(`Document name "${documentName}" is ambiguous: tab-1, tab-2`),
        documentName
      )
    ).toBe(false)
    expect(
      isRetryableNamedTargetError(
        new Error('Refusing to remove non-empty duplicate pages: 0:9'),
        documentName
      )
    ).toBe(false)
  })

  test('retries a stable workspace target while the app hydrates', () => {
    const workspaceId = 'workspace-stable'
    expect(
      isRetryableWorkspaceTargetError(
        new Error(`Workspace "${workspaceId}" not found`),
        workspaceId
      )
    ).toBe(true)
    expect(
      isRetryableWorkspaceTargetError(
        new Error(`Workspace "${workspaceId}" is open more than once: tab-1, tab-2`),
        workspaceId
      )
    ).toBe(false)
  })
})
