import { describe, expect, test } from 'bun:test'

import { boardListIndex, boardsListRpcArgs, resolveBoardIndexTarget } from '#cli/board-list'
import {
  exactBoardRpcArgs,
  openBoardByTarget,
  openBoardPage,
  type BoardRpcSender
} from '#cli/commands/boards'

const exactCliTarget = {
  'content-document-id': 'content:1',
  'document-id': 'tab:1',
  'page-id': 'page:source',
  'runtime-instance-id': 'runtime:1',
  'workspace-id': 'workspace:1'
}

const exactRpcTarget = {
  content_document_id: 'content:1',
  document_id: 'tab:1',
  page_id: 'page:source',
  runtime_instance_id: 'runtime:1',
  workspace_id: 'workspace:1'
}

function rpcTarget(pageId: string, pageName = 'Source') {
  return {
    boardRevision: 7,
    contentDocumentId: 'content:1',
    documentId: 'tab:1',
    documentName: 'Workspace',
    pageId,
    pageName,
    runtimeInstanceId: 'runtime:1',
    workspaceId: 'workspace:1'
  }
}

const listed = {
  documents: [
    {
      active: true,
      content_document_id: 'content:1',
      current_page_id: 'page:source',
      current_page_name: 'Dental Board',
      id: 'tab:1',
      kind: 'workspace' as const,
      name: 'Workspace',
      pages: [
        { id: 'page:source', name: 'Dental Board' },
        { id: 'page:health', name: 'Health Board' }
      ],
      workspace_id: 'workspace:1'
    }
  ],
  runtime_instance_id: 'runtime:1'
}

describe('Board navigation CLI', () => {
  test('requires exact IDs for direct navigation', () => {
    expect(exactBoardRpcArgs(exactCliTarget)).toEqual(exactRpcTarget)
    expect(() => exactBoardRpcArgs({ ...exactCliTarget, 'page-id': undefined })).toThrow(
      '--page-id is required'
    )
    expect(boardsListRpcArgs()).toEqual({})
  })

  test('resolves the compact Board index used by go', () => {
    expect(boardListIndex(listed, { query: 'dental' })).toMatchObject({
      boards: [{ id: 'page:source', name: 'Dental Board' }],
      returned: 1,
      total: 1
    })
    expect(resolveBoardIndexTarget(listed, 'Dental Board')).toEqual(exactRpcTarget)
    expect(resolveBoardIndexTarget(listed, 'page:health').page_id).toBe('page:health')
  })

  test('resolves a Board name and queues one exact navigation', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'list_documents') return { result: listed }
      return {
        result: { action: 'queued', status: 'queued_for_editor' },
        target: rpcTarget('page:source', 'Dental Board')
      }
    }

    await expect(
      openBoardByTarget(
        { objects: 'card:1,card:2', region: '1,2,300,200', target: 'Dental Board' },
        send
      )
    ).resolves.toMatchObject({ status: 'queued_for_editor', target: { pageId: 'page:source' } })
    expect(calls).toEqual([
      { args: {}, command: 'list_documents' },
      {
        args: {
          ...exactRpcTarget,
          object_ids: ['card:1', 'card:2'],
          region: { height: 200, width: 300, x: 1, y: 2 }
        },
        command: 'board_open'
      }
    ])
  })

  test('does not claim navigation completed visibly', async () => {
    const send: BoardRpcSender = async () => ({
      result: { action: 'queued', intent_id: 'board-open:1', status: 'queued_for_editor' },
      target: rpcTarget('page:source')
    })
    await expect(openBoardPage(exactCliTarget, send)).resolves.toMatchObject({
      navigation: { action: 'queued', intent_id: 'board-open:1' },
      status: 'queued_for_editor'
    })
  })
})
