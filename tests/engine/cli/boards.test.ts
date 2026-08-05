import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { boardListIndex, boardsListRpcArgs, resolveBoardIndexTarget } from '#cli/board-list'
import {
  boardTargetSource,
  createBoardPage,
  exactBoardRpcArgs,
  openBoardByTarget,
  openBoardPage,
  searchBoardPages,
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

describe('Boards CLI', () => {
  test('requires exact IDs for the internal Board target', () => {
    expect(exactBoardRpcArgs(exactCliTarget)).toEqual(exactRpcTarget)
    expect(exactBoardRpcArgs({ ...exactCliTarget, 'workspace-id': undefined })).toEqual({
      content_document_id: 'content:1',
      document_id: 'tab:1',
      page_id: 'page:source',
      runtime_instance_id: 'runtime:1'
    })
    expect(() => exactBoardRpcArgs({ ...exactCliTarget, 'page-id': undefined })).toThrow(
      '--page-id is required'
    )
    expect(boardsListRpcArgs()).toEqual({})
  })

  test('returns and resolves a compact searchable Board index', () => {
    const listed = {
      documents: [
        {
          active: true,
          content_document_id: 'content:1',
          current_page_id: 'page:dental',
          current_page_name: 'Dental Board',
          id: 'tab:1',
          kind: 'workspace' as const,
          name: 'Workspace',
          pages: [
            { id: 'page:dental', name: 'Dental Board' },
            { id: 'page:health', name: 'Health Board' }
          ],
          workspace_id: 'workspace:1'
        }
      ],
      runtime_instance_id: 'runtime:1'
    }

    expect(boardListIndex(listed, { query: 'dental' })).toEqual({
      boards: [{ active: true, id: 'page:dental', name: 'Dental Board' }],
      query: 'dental',
      returned: 1,
      total: 1,
      truncated: false
    })
    expect(boardListIndex(listed, { limit: '1' })).toEqual({
      boards: [{ active: true, id: 'page:dental', name: 'Dental Board' }],
      returned: 1,
      total: 2,
      truncated: true
    })
    expect(resolveBoardIndexTarget(listed, 'Dental Board')).toEqual({
      content_document_id: 'content:1',
      document_id: 'tab:1',
      page_id: 'page:dental',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    })
    expect(resolveBoardIndexTarget(listed, 'page:health').page_id).toBe('page:health')
    expect(() => resolveBoardIndexTarget(listed, 'Missing Board')).toThrow('No Board matches')
    expect(() => boardListIndex(listed, { limit: '101' })).toThrow('--limit')
  })

  test('creates through fresh writer context and opens the returned exact page ID', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        return {
          result: {
            execution_surface: 'browser_local',
            revisions: { board: 7 },
            runtime: { write_authority: 'writer' }
          },
          target: rpcTarget('page:source')
        }
      }
      if (command === 'tool') {
        return {
          result: {
            id: 'page:created',
            mutation_receipt: { expectedRevision: 7, requestId: 'request:create' },
            name: 'Agent Sandbox'
          },
          target: rpcTarget('page:source')
        }
      }
      if (args.page_id === 'page:created') {
        return {
          result: { action: 'opened', status: 'completed' },
          target: rpcTarget('page:created', 'Agent Sandbox')
        }
      }
      return {
        result: { action: 'opened', status: 'completed' },
        target: rpcTarget('page:source')
      }
    }

    const result = await createBoardPage(
      { ...exactCliTarget, name: 'Agent Sandbox', 'request-id': 'request:create' },
      send
    )

    expect(result).toMatchObject({
      source_page_id: 'page:source',
      status: 'completed',
      target: { pageId: 'page:created' }
    })
    expect(calls.map((call) => call.command)).toEqual([
      'board_context',
      'board_open',
      'board_context',
      'tool',
      'board_open'
    ])
    expect(calls[3]).toMatchObject({
      args: {
        ...exactRpcTarget,
        args: { name: 'Agent Sandbox' },
        mutation: { expectedRevision: 7, requestId: 'request:create' },
        name: 'create_page'
      },
      command: 'tool'
    })
    expect(calls[4]?.args.page_id).toBe('page:created')
  })

  test('refuses a viewer before sending a mutation', async () => {
    const calls: string[] = []
    const send: BoardRpcSender = async (command) => {
      calls.push(command)
      if (command === 'board_context') {
        return {
          result: {
            execution_surface: 'browser_local',
            revisions: { board: 7 },
            runtime: { write_authority: 'viewer' }
          },
          target: rpcTarget('page:source')
        }
      }
      return {
        result: { action: 'opened', status: 'completed' },
        target: rpcTarget('page:source')
      }
    }

    await expect(
      createBoardPage({ ...exactCliTarget, name: 'Blocked', 'request-id': 'request:viewer' }, send)
    ).rejects.toThrow('exact OpenPencil Board is view-only')
    expect(calls).toEqual(['board_context'])
  })

  test('reports applied creation honestly when the created page cannot be opened', async () => {
    const send: BoardRpcSender = async (command, args) => {
      if (command === 'board_context') {
        return {
          result: {
            execution_surface: 'browser_local',
            revisions: { board: 7 },
            runtime: { write_authority: 'writer' }
          },
          target: rpcTarget('page:source')
        }
      }
      if (command === 'tool') {
        return { result: { id: 'page:created' }, target: rpcTarget('page:source') }
      }
      if (args.page_id === 'page:created') throw new Error('runtime disconnected')
      return {
        result: { action: 'opened', status: 'completed' },
        target: rpcTarget('page:source')
      }
    }

    await expect(
      createBoardPage({ ...exactCliTarget, name: 'Partial', 'request-id': 'request:partial' }, send)
    ).resolves.toMatchObject({
      creation: { id: 'page:created' },
      open_error: 'runtime disconnected',
      status: 'created_not_opened'
    })
  })

  test('creates and verifies a page through persisted authority without opening it', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'tool') {
        return { result: { id: 'page:created' }, target: rpcTarget('page:source') }
      }
      const pageId = String(args.page_id)
      return {
        result: {
          capabilities: ['board.read.page'],
          context_token: `context:${pageId}`,
          execution_surface: 'local_workspace_authority',
          neighborhood: { count: 8, nodes: [{ id: 'irrelevant' }] },
          revisions: { board: 7 },
          runtime: { write_authority: 'writer' }
        },
        target: rpcTarget(pageId, pageId === 'page:created' ? 'Agent Sandbox' : 'Source')
      }
    }

    const result = await createBoardPage(
      { ...exactCliTarget, name: 'Agent Sandbox', 'request-id': 'request:headless-create' },
      send
    )
    expect(result).toMatchObject({
      opened: null,
      status: 'created_headless',
      target: { pageId: 'page:created' }
    })
    expect(result.created_context).not.toHaveProperty('capabilities')
    expect(result.created_context).not.toHaveProperty('neighborhood')
    expect(calls.map((call) => call.command)).toEqual(['board_context', 'tool', 'board_context'])
    expect(calls[1]).toMatchObject({
      args: {
        context_token: 'context:page:source',
        mutation: { expectedRevision: 7, requestId: 'request:headless-create' },
        name: 'create_page'
      }
    })
  })

  test('auto-resolves the sole persisted authority when create omits all target flags', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const authorityRuntimeId = 'local-authority:authority:1'
    const authorityTarget = (pageId: string) => ({
      ...rpcTarget(pageId, pageId === 'page:created' ? 'Agent Sandbox' : 'Source'),
      documentId: 'content:1',
      runtimeInstanceId: authorityRuntimeId
    })
    const send: BoardRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'list_documents') {
        return {
          result: {
            documents: [
              {
                active: false,
                content_document_id: 'content:1',
                current_page_id: '',
                current_page_name: '',
                id: 'content:1',
                kind: 'workspace',
                name: 'Workspace',
                pages: [{ id: 'page:source', name: 'Source' }],
                workspace_id: 'workspace:1'
              }
            ],
            runtime_instance_id: authorityRuntimeId
          }
        }
      }
      if (command === 'tool') {
        return { result: { id: 'page:created' }, target: authorityTarget('page:source') }
      }
      const pageId = String(args.page_id)
      return {
        result: {
          context_token: `context:${pageId}`,
          execution_surface: 'local_workspace_authority',
          revisions: { board: 7 },
          runtime: { write_authority: 'writer' }
        },
        target: authorityTarget(pageId)
      }
    }

    await expect(
      createBoardPage(
        {
          name: 'Agent Sandbox',
          'request-id': 'request:authority-no-page'
        },
        send
      )
    ).resolves.toMatchObject({
      source_page_id: 'page:source',
      status: 'created_headless',
      target: { pageId: 'page:created' }
    })
    expect(calls.map((call) => call.command)).toEqual([
      'list_documents',
      'board_context',
      'tool',
      'board_context'
    ])
    expect(calls[2]?.args.page_id).toBe('page:source')
    expect(calls[1]?.args.document_id).toBe('content:1')
  })

  test('uses partial target flags only to pin and validate persisted authority discovery', async () => {
    const calls: string[] = []
    const send: BoardRpcSender = async (command) => {
      calls.push(command)
      return {
        result: {
          documents: [
            {
              active: false,
              content_document_id: 'content:1',
              current_page_id: '',
              current_page_name: '',
              id: 'content:1',
              kind: 'workspace',
              name: 'Workspace',
              pages: [{ id: 'page:source', name: 'Source' }],
              workspace_id: 'workspace:1'
            }
          ],
          runtime_instance_id: 'local-authority:authority:1'
        }
      }
    }

    await expect(
      createBoardPage(
        {
          name: 'Wrong workspace',
          'request-id': 'request:wrong-workspace',
          'workspace-id': 'workspace:other'
        },
        send
      )
    ).rejects.toThrow('No persisted Board document matches')
    expect(calls).toEqual(['list_documents'])
  })

  test('refuses ambiguous persisted documents before acquiring mutation context', async () => {
    const calls: string[] = []
    const send: BoardRpcSender = async (command) => {
      calls.push(command)
      return {
        result: {
          documents: [
            {
              active: false,
              content_document_id: 'content:1',
              current_page_id: '',
              current_page_name: '',
              id: 'content:1',
              kind: 'workspace',
              name: 'Workspace 1',
              pages: [{ id: 'page:1', name: 'Source 1' }],
              workspace_id: 'workspace:1'
            },
            {
              active: false,
              content_document_id: 'content:2',
              current_page_id: '',
              current_page_name: '',
              id: 'content:2',
              kind: 'workspace',
              name: 'Workspace 2',
              pages: [{ id: 'page:2', name: 'Source 2' }],
              workspace_id: 'workspace:2'
            }
          ],
          runtime_instance_id: 'local-authority:authority:1'
        }
      }
    }

    await expect(
      createBoardPage({ name: 'Ambiguous', 'request-id': 'request:ambiguous-authority' }, send)
    ).rejects.toThrow('ambiguous across 2 persisted Board documents')
    expect(calls).toEqual(['list_documents'])
  })

  test('searches once and opens by Board name without exposing authority IDs', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'workspace_search') {
        return {
          result: {
            contract: 'workspace-search/v1',
            indexed_revision: 7,
            query: 'dental',
            results: [
              {
                board: { id: 'page:source', name: 'Dental Board' },
                canonical_object_id: 'page:source',
                id: 'page:source',
                kind: 'board',
                name: 'Dental Board',
                owner_id: 'page:source',
                type: 'CANVAS'
              }
            ],
            returned: 1,
            total: 1,
            truncated: false
          }
        }
      }
      if (command === 'list_documents') {
        return {
          result: {
            documents: [
              {
                active: true,
                content_document_id: 'content:1',
                current_page_id: 'page:source',
                current_page_name: 'Dental Board',
                id: 'tab:1',
                kind: 'workspace',
                name: 'Workspace',
                pages: [{ id: 'page:source', name: 'Dental Board' }],
                workspace_id: 'workspace:1'
              }
            ],
            runtime_instance_id: 'runtime:1'
          }
        }
      }
      return {
        result: { action: 'opened', status: 'completed' },
        target: rpcTarget('page:source', 'Dental Board')
      }
    }

    await expect(searchBoardPages({ query: 'dental' }, send)).resolves.toEqual({
      contract: 'workspace-search/v1',
      indexed_revision: 7,
      query: 'dental',
      results: [
        {
          board: { id: 'page:source', name: 'Dental Board' },
          canonical_object_id: 'page:source',
          id: 'page:source',
          kind: 'board',
          name: 'Dental Board',
          owner_id: 'page:source',
          type: 'CANVAS'
        }
      ],
      returned: 1,
      total: 1,
      truncated: false
    })
    expect(calls).toEqual([{ args: { limit: 20, query: 'dental' }, command: 'workspace_search' }])

    calls.length = 0
    await expect(openBoardByTarget({ target: 'Dental Board' }, send)).resolves.toMatchObject({
      status: 'completed',
      target: { pageId: 'page:source' }
    })
    expect(calls).toEqual([
      { args: {}, command: 'list_documents' },
      { args: exactRpcTarget, command: 'board_open' }
    ])
  })

  test('opens a non-visible exact live Board in one semantic call', async () => {
    const calls: string[] = []
    const send: BoardRpcSender = async (command) => {
      calls.push(command)
      return {
        result: { action: 'opened', status: 'completed' },
        target: rpcTarget('page:source')
      }
    }

    await expect(openBoardPage(exactCliTarget, send)).resolves.toMatchObject({
      navigation: { action: 'opened' },
      status: 'completed',
      target: { pageId: 'page:source' }
    })
    expect(calls).toEqual(['board_open'])
  })

  test('queues exact persisted Board navigation without claiming a visible editor opened', async () => {
    const calls: string[] = []
    const authorityRuntimeId =
      'local-authority:local-authority-f06b17af-2b12-4b51-8e75-49506e084910'
    const send: BoardRpcSender = async (command, args) => {
      calls.push(command)
      expect(args.editor_runtime_instance_id).toBe('runtime:chosen-editor')
      return {
        result: {
          action: 'queued',
          editor_runtime_instance_id: 'runtime:chosen-editor',
          intent_id: 'board-open:1',
          status: 'queued_for_editor'
        },
        target: { ...rpcTarget('page:source'), runtimeInstanceId: authorityRuntimeId }
      }
    }

    await expect(
      openBoardPage(
        {
          ...exactCliTarget,
          'editor-runtime-instance-id': 'runtime:chosen-editor',
          'runtime-instance-id': authorityRuntimeId
        },
        send
      )
    ).resolves.toMatchObject({
      navigation: { action: 'queued', intent_id: 'board-open:1' },
      status: 'queued_for_editor',
      target: { pageId: 'page:source' }
    })
    expect(calls).toEqual(['board_open'])
  })

  test('accepts atomic context and create handoffs while refusing ambiguous targets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-board-create-base-'))
    const basePath = path.join(root, 'base.json')
    const base = {
      contract: 'board-build/v1',
      ...exactRpcTarget,
      context_token: 'context:stale-safe-to-ignore',
      expected_revision: 4
    }
    await writeFile(basePath, JSON.stringify(base))
    try {
      await expect(
        boardTargetSource({
          'base-file': basePath,
          name: 'From base',
          'request-id': 'request:base'
        })
      ).resolves.toMatchObject(exactCliTarget)
      await expect(
        boardTargetSource({
          base: JSON.stringify({ board_build_base: base }),
          name: 'From context',
          'request-id': 'request:context'
        })
      ).resolves.toMatchObject(exactCliTarget)
      await expect(
        boardTargetSource({
          base: JSON.stringify({
            created_context: {
              board_build_base: { ...base, page_id: 'page:created' }
            }
          })
        })
      ).resolves.toMatchObject({
        ...exactCliTarget,
        'page-id': 'page:created'
      })
      await expect(
        boardTargetSource({
          base: JSON.stringify(base),
          'page-id': 'page:other'
        })
      ).rejects.toThrow('cannot be combined')
      await expect(boardTargetSource({ base: '{}' })).rejects.toThrow('board-build/v1')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
