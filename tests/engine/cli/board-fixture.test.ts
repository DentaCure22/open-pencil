import { describe, expect, test } from 'bun:test'

import { boardFixtureRpcArgs } from '#cli/board-fixture'

const exact = {
  'content-document-id': 'content:1',
  'context-token': 'context:1',
  'document-id': 'document:1',
  'page-id': 'page:1',
  'runtime-instance-id': 'local-authority:1',
  'workspace-id': 'workspace:1'
}

describe('Board fixture CLI', () => {
  test('pins capture and assert to the complete exact target', () => {
    expect(boardFixtureRpcArgs({ ...exact, operation: 'capture' })).toEqual({
      content_document_id: 'content:1',
      context_token: 'context:1',
      document_id: 'document:1',
      operation: 'capture',
      page_id: 'page:1',
      runtime_instance_id: 'local-authority:1',
      workspace_id: 'workspace:1'
    })
    expect(
      boardFixtureRpcArgs({ ...exact, 'fixture-id': 'fixture:1', operation: 'assert' })
    ).toMatchObject({ fixture_id: 'fixture:1', operation: 'assert' })
  })

  test('requires CAS and stable request identity for reset', () => {
    expect(
      boardFixtureRpcArgs({
        ...exact,
        'expected-revision': '17',
        'fixture-id': 'fixture:1',
        operation: 'reset',
        'request-id': 'request:reset'
      })
    ).toMatchObject({
      expected_revision: 17,
      fixture_id: 'fixture:1',
      operation: 'reset',
      request_id: 'request:reset'
    })
    expect(() =>
      boardFixtureRpcArgs({
        ...exact,
        'fixture-id': 'fixture:1',
        operation: 'reset',
        'request-id': 'request:reset'
      })
    ).toThrow('--expected-revision is required')
  })
})
