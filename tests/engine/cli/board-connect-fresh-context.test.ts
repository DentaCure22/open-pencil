import { describe, expect, test } from 'bun:test'

import { exactFreshContextTarget } from '#cli/board-build/fresh-context'
import {
  connectWithFreshContext,
  normalizeFreshBoardConnectLogical,
  type BoardConnectRpcSender
} from '#cli/board-connect/fresh-context'
import { boardInternalCommand as boardCommand } from '#cli/commands/board'

const exactTarget = {
  'content-document-id': 'content-document:1',
  'document-id': 'document:1',
  'page-id': 'page:1',
  'runtime-instance-id': 'runtime:1',
  'workspace-id': 'workspace:1'
}

const exactRpcTarget = {
  content_document_id: 'content-document:1',
  document_id: 'document:1',
  page_id: 'page:1',
  runtime_instance_id: 'runtime:1',
  workspace_id: 'workspace:1'
}

function rpcTarget(boardRevision = 12) {
  return {
    boardRevision,
    contentDocumentId: 'content-document:1',
    documentId: 'document:1',
    documentName: 'Board document',
    pageId: 'page:1',
    pageName: 'Page 1',
    runtimeInstanceId: 'runtime:1',
    workspaceId: 'workspace:1'
  }
}

function contextResult(expectedRevision = 12) {
  return {
    capabilities: ['board.change.object_graph.connect'],
    connect_objects_base: {
      ...exactRpcTarget,
      context_token: 'context:fresh-connect',
      expected_revision: expectedRevision
    },
    neighborhood: {
      nodes: [
        { id: 'node:source', name: 'CLI Ready', parent_id: 'page:1', visible: true },
        { id: 'node:target', name: 'Next gate', parent_id: 'page:1', visible: true }
      ],
      truncated: false
    }
  }
}

const logical = {
  automatic: false,
  kind: 'visual' as const,
  label: 'Explains',
  request_id: 'request:fresh-connect',
  source_id: 'node:source',
  source_port: 'right' as const,
  target_id: 'node:target',
  target_port: 'left' as const,
  trace_id: 'trace:connect'
}

describe('Board connect fresh-context CLI handshake', () => {
  test('runs one exact context call and one unchanged semantic connector call', async () => {
    const base = contextResult().connect_objects_base
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardConnectRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        return {
          result: { ...contextResult(), connect_objects_base: base },
          target: rpcTarget()
        }
      }
      return {
        result: { connection_id: 'connection:1', status: 'completed' },
        target: rpcTarget(13)
      }
    }
    const ticks = [20, 23.25, 29.75]
    const result = await connectWithFreshContext(exactFreshContextTarget(exactTarget), logical, {
      now: () => ticks.shift() ?? 29.75,
      send
    })

    expect(calls.map((call) => call.command)).toEqual(['board_context', 'connect_objects'])
    expect(calls[0]?.args).toEqual(exactRpcTarget)
    expect(calls[1]?.args.base).toBe(base)
    expect(calls[1]).toEqual({ args: { base, ...logical }, command: 'connect_objects' })
    expect(result.response.result).toEqual({ connection_id: 'connection:1', status: 'completed' })
    expect(result.handshake).toEqual({
      contract: 'board-connect-fresh-context/v2',
      handshake_elapsed_ms: { board_context: 3.25, connect_objects: 6.5, total: 9.75 },
      semantic_rpc_calls: { board_context: 1, connect_objects: 1, total: 2 },
      stale_recovery_count: 0
    })
    expect(boardCommand.subCommands?.connect?.meta?.description).toContain(
      '--fresh-context with exact IDs or unique visible top-level names'
    )
    expect(boardCommand.subCommands?.connect?.args?.['fresh-context']?.description).toContain(
      'normally two semantic RPC calls'
    )
  })

  test('resolves exact endpoint names and retries one conclusive stale race', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    let contextRevision = 12
    const send: BoardConnectRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        const revision = contextRevision++
        return {
          result: {
            ...contextResult(revision),
            connect_objects_base: {
              ...contextResult(revision).connect_objects_base,
              context_token: `context:${revision}`
            }
          },
          target: rpcTarget(revision)
        }
      }
      if (calls.filter((call) => call.command === 'connect_objects').length === 1) {
        throw new Error('Expected revision 12, current revision is 13')
      }
      return {
        result: { connection_id: 'connection:named', status: 'completed' },
        target: rpcTarget(14)
      }
    }
    const result = await connectWithFreshContext(
      exactFreshContextTarget(exactTarget),
      {
        ...logical,
        source_id: 'pending-context-source-name-resolution',
        target_id: 'pending-context-target-name-resolution'
      },
      { send, sourceName: 'CLI Ready', targetName: 'Next gate' }
    )

    expect(calls.map(({ command }) => command)).toEqual([
      'board_context',
      'connect_objects',
      'board_context',
      'connect_objects'
    ])
    expect(calls[3]).toMatchObject({
      args: { kind: 'visual', source_id: 'node:source', target_id: 'node:target' }
    })
    expect(result.handshake).toMatchObject({
      resolved_source_object_id: 'node:source',
      resolved_target_object_id: 'node:target',
      semantic_rpc_calls: { board_context: 2, connect_objects: 2, total: 4 },
      stale_recovery_count: 1
    })
  })

  test('refuses wrong context and response targets without retargeting', async () => {
    const contextCalls: string[] = []
    const wrongContext: BoardConnectRpcSender = async (command) => {
      contextCalls.push(command)
      return {
        result: contextResult(),
        target: { ...rpcTarget(), pageId: 'page:wrong' }
      }
    }
    await expect(
      connectWithFreshContext(exactFreshContextTarget(exactTarget), logical, {
        send: wrongContext
      })
    ).rejects.toThrow('wrong exact target: page_id')
    expect(contextCalls).toEqual(['board_context'])

    const responseCalls: string[] = []
    const wrongResponse: BoardConnectRpcSender = async (command) => {
      responseCalls.push(command)
      return command === 'board_context'
        ? { result: contextResult(), target: rpcTarget() }
        : {
            result: { status: 'completed' },
            target: { ...rpcTarget(13), runtimeInstanceId: 'runtime:wrong' }
          }
    }
    await expect(
      connectWithFreshContext(exactFreshContextTarget(exactTarget), logical, {
        send: wrongResponse
      })
    ).rejects.toThrow('wrong exact target: runtime_instance_id')
    expect(responseCalls).toEqual(['board_context', 'connect_objects'])
  })

  test('rejects base injection and malformed logical fields before any RPC', async () => {
    const calls: string[] = []
    const send: BoardConnectRpcSender = async (command) => {
      calls.push(command)
      throw new Error('RPC must not run')
    }

    for (const conflict of [
      { base: '{}' },
      { 'base-file': 'connector-base.json' },
      { 'context-token': 'context:injected' },
      { 'expected-revision': '12' }
    ]) {
      expect(() => exactFreshContextTarget({ ...exactTarget, ...conflict })).toThrow(
        '--fresh-context cannot be combined'
      )
    }
    expect(() =>
      exactFreshContextTarget({ ...exactTarget, 'runtime-instance-id': undefined })
    ).toThrow('--runtime-instance-id is required with --fresh-context')
    await expect(
      connectWithFreshContext(
        exactFreshContextTarget(exactTarget),
        { ...logical, base: { context_token: 'injected' } } as never,
        { send }
      )
    ).rejects.toThrow('unexpected or authority fields: base')
    await expect(
      connectWithFreshContext(
        exactFreshContextTarget(exactTarget),
        { ...logical, automatic: true },
        { send }
      )
    ).rejects.toThrow('visual connections cannot be automatic')
    await expect(
      connectWithFreshContext(
        exactFreshContextTarget(exactTarget),
        { ...logical, source_id: 'node:same', target_id: 'node:same' },
        { send }
      )
    ).rejects.toThrow('must identify different objects')
    expect(calls).toEqual([])
  })

  test('stops after context on stale or malformed atomic base revisions', async () => {
    for (const boardRevision of [11, 12.5]) {
      const calls: string[] = []
      const send: BoardConnectRpcSender = async (command) => {
        calls.push(command)
        return { result: contextResult(12), target: rpcTarget(boardRevision) }
      }
      await expect(
        connectWithFreshContext(exactFreshContextTarget(exactTarget), logical, { send })
      ).rejects.toThrow(
        boardRevision === 11
          ? 'target revision does not match connect_objects_base.expected_revision'
          : 'valid integer Board revision'
      )
      expect(calls).toEqual(['board_context'])
    }
  })

  test('stops after context when the atomic connector base names another target', async () => {
    const calls: string[] = []
    const send: BoardConnectRpcSender = async (command) => {
      calls.push(command)
      return {
        result: {
          ...contextResult(),
          connect_objects_base: {
            ...contextResult().connect_objects_base,
            page_id: 'page:wrong'
          }
        },
        target: rpcTarget()
      }
    }
    await expect(
      connectWithFreshContext(exactFreshContextTarget(exactTarget), logical, { send })
    ).rejects.toThrow('connect_objects_base for the wrong exact target: page_id')
    expect(calls).toEqual(['board_context'])
  })

  test('stops after context when connector base or capability is absent', async () => {
    for (const result of [
      { capabilities: ['board.read'] },
      { capabilities: ['board.change.object_graph.connect'] }
    ]) {
      const calls: string[] = []
      const send: BoardConnectRpcSender = async (command) => {
        calls.push(command)
        return { result, target: rpcTarget() }
      }
      const expectedError =
        !('connect_objects_base' in result) &&
        result.capabilities.includes('board.change.object_graph.connect')
          ? 'did not return connect_objects_base'
          : 'lacks writer board.change.object_graph.connect capability'
      await expect(
        connectWithFreshContext(exactFreshContextTarget(exactTarget), logical, { send })
      ).rejects.toThrow(expectedError)
      expect(calls).toEqual(['board_context'])
    }
  })

  test('normalizes the complete supported connector semantics', () => {
    expect(normalizeFreshBoardConnectLogical(logical)).toEqual(logical)
    expect(() =>
      normalizeFreshBoardConnectLogical({ ...logical, automatic: undefined, kind: 'data' })
    ).toThrow('require explicit automatic true or false')
    expect(() =>
      normalizeFreshBoardConnectLogical({ ...logical, source_port: '1invalid' })
    ).toThrow('must be a side or stable named port ID')
    expect(() => normalizeFreshBoardConnectLogical({ ...logical, label: 'x'.repeat(81) })).toThrow(
      'label exceeds 80 characters'
    )
  })
})
