import { describe, expect, test } from 'bun:test'

import { parseCliOpenPencilOutput, projectOpenPencilResult } from '../src/openpencil-result'

const target = {
  boardRevision: 12,
  contentDocumentId: 'content-1',
  documentId: 'tab-1',
  pageId: 'page-1',
  runtimeInstanceId: 'runtime-1',
  workspaceId: 'workspace-1'
}

describe('OpenPencil result projection', () => {
  test('derives authority and durability witnesses from a completed exact CLI result', () => {
    const payload = parseCliOpenPencilOutput(
      JSON.stringify({
        owner_id: 'owner-1',
        persistence: { status: 'durable', target: 'browser_local' },
        presentation: { acknowledged: true, selected_ids: ['owner-1'] },
        receipt: { requestId: 'request-1', status: 'applied' },
        status: { command: 'completed', mutation: 'applied' },
        target
      })
    )
    const events = projectOpenPencilResult('build', payload)
    expect(events.map((event) => event.kind)).toEqual(['openpencil_result', 'durability_confirmed'])
    expect(events[0]?.data).toMatchObject({
      mutation_state: 'applied',
      owner_id: 'owner-1',
      request_id: 'request-1',
      target: {
        content_document_id: 'content-1',
        document_id: 'tab-1',
        page_id: 'page-1',
        runtime_instance_id: 'runtime-1',
        workspace_id: 'workspace-1'
      }
    })
  })

  test('does not turn presentation acknowledgement into a separate proof gate', () => {
    const events = projectOpenPencilResult('board_build', {
      structured_content: {
        owner_id: 'owner-1',
        presentation: { acknowledged: true },
        receipt: { requestId: 'request-1' },
        status: { command: 'completed', mutation: 'applied' },
        target
      }
    })
    expect(events.some((event) => event.kind === 'pixel_witness_captured')).toBe(false)
    expect(events.some((event) => event.kind === 'render_acknowledged')).toBe(false)
  })

  test('preserves mixed-plan object and connection ownership from compact or full results', () => {
    const ownerIds = { brief: 'node-1', control: 'node-2' }
    const connectionIds = ['connection-1', 'connection-2']
    for (const ownership of [
      {
        connection_ids: connectionIds,
        owner_ids: ownerIds,
        receipt: { requestId: 'request-mixed', status: 'applied' }
      },
      {
        receipt: {
          connection_ids: connectionIds,
          owner_ids: ownerIds,
          requestId: 'request-mixed',
          status: 'applied'
        }
      }
    ]) {
      const events = projectOpenPencilResult('build', {
        ...ownership,
        persistence: { status: 'durable', target: 'local_workspace_authority' },
        status: { command: 'completed', mutation: 'applied' },
        target
      })

      expect(events[0]?.data).toMatchObject({
        connection_ids: connectionIds,
        owner_id: null,
        owner_ids: ownerIds,
        request_id: 'request-mixed'
      })
      expect(events.map((event) => event.kind)).toEqual([
        'openpencil_result',
        'durability_confirmed'
      ])
    }
  })

  test('does not invent authority evidence from malformed or read-only output', () => {
    expect(parseCliOpenPencilOutput('not json')).toBeNull()
    expect(projectOpenPencilResult('context', { status: { command: 'completed' } })).toEqual([])
    expect(projectOpenPencilResult('build', { status: { command: 'completed' } })).toEqual([])
  })
})
