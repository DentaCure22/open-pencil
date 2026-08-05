import { describe, expect, test } from 'bun:test'

import { boardFixtureInputSchema } from '#mcp/tool/board-registration'

const target = {
  content_document_id: 'content:1',
  context_token: 'context:1',
  document_id: 'document:1',
  page_id: 'page:1',
  runtime_instance_id: 'local-authority:1',
  workspace_id: 'workspace:1'
}

describe('Board fixture MCP registration', () => {
  test('exposes strict capture/assert/reset schemas', () => {
    expect(boardFixtureInputSchema.safeParse({ ...target, operation: 'capture' }).success).toBe(
      true
    )
    expect(
      boardFixtureInputSchema.safeParse({
        ...target,
        fixture_id: 'fixture:1',
        operation: 'assert'
      }).success
    ).toBe(true)
    expect(
      boardFixtureInputSchema.safeParse({
        ...target,
        expected_revision: 12,
        fixture_id: 'fixture:1',
        operation: 'reset',
        request_id: 'request:reset'
      }).success
    ).toBe(true)
    expect(
      boardFixtureInputSchema.safeParse({
        ...target,
        fixture_id: 'fixture:1',
        operation: 'reset',
        request_id: 'request:reset'
      }).success
    ).toBe(false)
  })
})
