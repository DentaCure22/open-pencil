import { describe, expect, test } from 'bun:test'

import codeObjectCommand, {
  codeObjectInspectRpcArgs,
  codeObjectUpsertRpcArgs
} from '#cli/commands/code-object'

const exactTarget = {
  'content-document-id': 'content-document:1',
  'document-id': 'document:1',
  'page-id': 'page:1',
  'runtime-instance-id': 'runtime:1',
  'workspace-id': 'workspace:1'
}

const input = {
  persist: true,
  props: { label: 'Proof' },
  source: 'export default function Proof() { return <div>Proof</div> }',
  state: { count: 1 },
  zoomToSelection: false
}

describe('Code Object CLI arguments', () => {
  test('warns that trusted Code Object source is not sandboxed', () => {
    expect(codeObjectCommand.meta?.description).toContain('not a security sandbox')
    expect(codeObjectCommand.meta?.description).toContain('never use external or untrusted source')
  })

  test('forwards the exact target and nested guarded mutation', () => {
    expect(
      codeObjectUpsertRpcArgs(
        {
          ...exactTarget,
          'expected-revision': '42',
          objectKey: 'proof-card',
          'request-id': 'request:proof-card'
        },
        input
      )
    ).toMatchObject({
      content_document_id: 'content-document:1',
      document_id: 'document:1',
      mutation: { expectedRevision: 42, requestId: 'request:proof-card' },
      object_key: 'proof-card',
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    })
  })

  test('requires the five-part target, revision, and stable request ID', () => {
    expect(() =>
      codeObjectUpsertRpcArgs(
        {
          ...exactTarget,
          'content-document-id': undefined,
          'expected-revision': '42',
          objectKey: 'proof-card',
          'request-id': 'request:proof-card'
        },
        input
      )
    ).toThrow('--content-document-id is required')
    expect(() =>
      codeObjectUpsertRpcArgs(
        {
          ...exactTarget,
          objectKey: 'proof-card',
          'request-id': 'request:proof-card'
        },
        input
      )
    ).toThrow('--expected-revision is required')
    expect(() =>
      codeObjectUpsertRpcArgs(
        {
          ...exactTarget,
          'expected-revision': '-1',
          objectKey: 'proof-card',
          'request-id': 'request:proof-card'
        },
        input
      )
    ).toThrow('non-negative integer')
    expect(() =>
      codeObjectUpsertRpcArgs(
        { ...exactTarget, 'expected-revision': '42', objectKey: 'proof-card' },
        input
      )
    ).toThrow('--request-id is required')
  })

  test('pins Code Object inspection to the exact target and page-owned owner', () => {
    expect(
      codeObjectInspectRpcArgs({
        ...exactTarget,
        'owner-id': 'node:proof-card'
      })
    ).toEqual({
      content_document_id: 'content-document:1',
      document_id: 'document:1',
      owner_id: 'node:proof-card',
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    })
    expect(() =>
      codeObjectInspectRpcArgs({
        ...exactTarget,
        'content-document-id': undefined,
        'owner-id': 'node:proof-card'
      })
    ).toThrow('--content-document-id is required')
    expect(() => codeObjectInspectRpcArgs({ ...exactTarget, 'owner-id': '' })).toThrow(
      '--owner-id is required'
    )
  })
})
