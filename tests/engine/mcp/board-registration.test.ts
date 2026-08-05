import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerTools } from '#mcp/tool/registration'

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

type RegisteredTool = {
  description?: string
  handler: ToolHandler
  inputSchema: z.ZodType
}

const EXACT_TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'runtime_instance_id',
  'workspace_id'
] as const

function withoutField(value: Record<string, unknown>, excludedField: string) {
  return Object.fromEntries(Object.entries(value).filter(([field]) => field !== excludedField))
}

function setup(sendRpc: (body: Record<string, unknown>) => Promise<unknown>) {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(
      name: string,
      options: { description?: string; inputSchema: z.ZodType },
      handler: ToolHandler
    ) {
      tools.set(name, { ...options, handler })
    }
  }
  registerTools(server as McpServer, { enableEval: false, sendRpc })
  return tools
}

function requireTool(tools: Map<string, RegisteredTool>, name: string) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Missing registered tool: ${name}`)
  return tool
}

describe('semantic Board MCP registration', () => {
  test('discloses every currently refused asynchronous mutation in tool discovery', () => {
    const tools = setup(async () => ({ ok: true, result: {} }))
    for (const name of [
      'import_svg',
      'insert_icon',
      'node_replace_with',
      'render',
      'stock_photo'
    ]) {
      expect(requireTool(tools, name).description).toContain(
        'currently refuses this asynchronous mutation'
      )
    }
    expect(requireTool(tools, 'create_shape').description).not.toContain(
      'currently refuses this asynchronous mutation'
    )
  })

  test('registers the five-phase surface with exact target and mutation guards', () => {
    const tools = setup(async () => ({ ok: true, result: {} }))

    for (const name of [
      'board_context',
      'board_read',
      'board_change',
      'connect_objects',
      'board_present',
      'board_verify'
    ]) {
      expect(tools.has(name)).toBe(true)
    }
    const context = requireTool(tools, 'board_context')
    expect(context.description).toContain('omit runtime only when one OpenPencil client')
    expect(context.description).toContain('target current_visible')
    expect(context.description).toContain('bounded nearby page-owned summary')
    expect(context.description).toContain('copy-ready board_build_base')
    const exactTarget = {
      content_document_id: 'content-document:1',
      document_id: 'document:1',
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    }
    expect(requireTool(tools, 'board_read').description).toContain('explicit page scope')
    const read = requireTool(tools, 'board_read')
    expect(
      read.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:1',
        object_ids: ['node:1', 'node:2'],
        scope: 'objects'
      })
    ).toMatchObject({ object_ids: ['node:1', 'node:2'], scope: 'objects' })
    expect(
      read.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:1',
        projection: 'summary',
        query: {
          name: 'target',
          region: { height: 400, width: 600, x: 100, y: 200 },
          types: ['FRAME', 'TEXT']
        },
        scope: 'query',
        sort: 'x',
        token_budget: 1_500
      })
    ).toMatchObject({ projection: 'summary', scope: 'query', token_budget: 1_500 })
    expect(() =>
      read.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:1',
        query: {},
        scope: 'query'
      })
    ).toThrow()
    expect(() =>
      read.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:1',
        object_ids: ['node:1'],
        scope: 'page'
      })
    ).toThrow()
    expect(
      context.inputSchema.parse({ page_id: 'page:1', workspace_id: 'workspace:1' })
    ).toMatchObject({ page_id: 'page:1', workspace_id: 'workspace:1' })
    expect(context.inputSchema.parse({ target: 'current_visible' })).toEqual({
      target: 'current_visible'
    })
    expect(
      context.inputSchema.parse({
        page_id: 'page:1',
        runtime_instance_id: 'runtime:writer',
        workspace_id: 'workspace:1'
      })
    ).toMatchObject({
      page_id: 'page:1',
      runtime_instance_id: 'runtime:writer',
      workspace_id: 'workspace:1'
    })
    expect(() => context.inputSchema.parse({ page_id: 'page:1' })).toThrow()
    expect(() =>
      context.inputSchema.parse({ target: 'current_visible', workspace_id: 'workspace:1' })
    ).toThrow()
    expect(() =>
      context.inputSchema.parse({
        bogus: 'must not be silently discarded',
        page_id: 'page:1',
        workspace_id: 'workspace:1'
      })
    ).toThrow()

    const change = requireTool(tools, 'board_change')
    expect(
      change.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:1',
        expected_revision: 12,
        operation: {
          anchor_id: 'node:anchor',
          artifact: { kind: 'native_text', text: 'Native note' },
          kind: 'artifact.create'
        },
        request_id: 'request:1',
        task_id: 'task:1',
        trace_id: 'trace:1',
        visual: { profile: 'local-legible-text-v1' }
      })
    ).toMatchObject({
      expected_revision: 12,
      request_id: 'request:1',
      runtime_instance_id: 'runtime:1',
      task_id: 'task:1',
      trace_id: 'trace:1',
      visual: { profile: 'local-legible-text-v1' }
    })

    expect(
      change.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:card',
        expected_revision: 13,
        operation: {
          anchor_id: 'node:anchor',
          artifact: {
            body: 'One bounded native composition.',
            kind: 'native_card',
            title: 'General builder card',
            width: 360
          },
          kind: 'artifact.create'
        },
        request_id: 'request:card',
        visual: { profile: 'local-legible-card-v1' }
      })
    ).toMatchObject({
      operation: { artifact: { kind: 'native_card' } },
      visual: { profile: 'local-legible-card-v1' }
    })
    expect(
      change.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:free-card',
        expected_revision: 14,
        operation: {
          artifact: {
            body: 'Placed directly from Trace.',
            kind: 'native_card',
            title: 'Trace point'
          },
          kind: 'artifact.create',
          placement: { target: { kind: 'point', x: -120, y: 440 } }
        },
        request_id: 'request:free-card'
      })
    ).toMatchObject({
      operation: { placement: { target: { kind: 'point', x: -120, y: 440 } } }
    })
    expect(
      change.inputSchema.parse({
        ...exactTarget,
        context_token: 'context:auto-card',
        expected_revision: 15,
        operation: {
          artifact: {
            body: 'Let the bounded builder choose the location.',
            kind: 'native_card',
            title: 'Automatic placement'
          },
          kind: 'artifact.create',
          placement: { target: { kind: 'auto' } }
        },
        request_id: 'request:auto-card'
      })
    ).toMatchObject({ operation: { placement: { target: { kind: 'auto' } } } })
    for (const field of EXACT_TARGET_FIELDS) {
      const incompleteTarget = withoutField(exactTarget, field)
      expect(() =>
        change.inputSchema.parse({
          ...incompleteTarget,
          context_token: 'context:1',
          expected_revision: 12,
          operation: {
            anchor_id: 'node:anchor',
            artifact: { kind: 'native_text', text: 'Native note' },
            kind: 'artifact.create'
          },
          request_id: 'request:1'
        })
      ).toThrow()
    }

    const connect = requireTool(tools, 'connect_objects')
    expect(connect.description).toContain('connect_objects_base returned by board_build')
    expect(connect.description).toContain(
      'reacquire context only when that base is absent or stale'
    )
    const connectInput = {
      ...exactTarget,
      context_token: 'context:1',
      expected_revision: 12,
      kind: 'visual' as const,
      request_id: 'request:connect',
      source_id: 'node:source',
      target_id: 'node:target',
      trace_id: 'trace:connect'
    }
    expect(connect.inputSchema.parse(connectInput)).toMatchObject({
      kind: 'visual',
      request_id: 'request:connect',
      source_id: 'node:source',
      target_id: 'node:target'
    })
    const {
      content_document_id,
      context_token,
      document_id,
      expected_revision,
      page_id,
      runtime_instance_id,
      workspace_id,
      ...connectLogical
    } = connectInput
    const packetConnectInput = {
      base: {
        content_document_id,
        context_token,
        document_id,
        expected_revision,
        page_id,
        runtime_instance_id,
        workspace_id
      },
      ...connectLogical
    }
    expect(connect.inputSchema.parse(packetConnectInput)).toMatchObject(packetConnectInput)
    expect(connect.inputSchema.parse({ ...connectInput, automatic: false })).toMatchObject({
      automatic: false,
      kind: 'visual'
    })
    for (const field of EXACT_TARGET_FIELDS) {
      const incompleteTarget = withoutField(connectInput, field)
      expect(() => connect.inputSchema.parse(incompleteTarget)).toThrow()
    }
    expect(() => connect.inputSchema.parse({ ...connectInput, automatic: true })).toThrow()
    for (const kind of ['data', 'action'] as const) {
      expect(() => connect.inputSchema.parse({ ...connectInput, kind })).toThrow()
      expect(connect.inputSchema.parse({ ...connectInput, automatic: false, kind })).toMatchObject({
        automatic: false,
        kind
      })
      expect(connect.inputSchema.parse({ ...connectInput, automatic: true, kind })).toMatchObject({
        automatic: true,
        kind
      })
    }
    expect(() =>
      connect.inputSchema.parse({
        ...connectInput,
        visual: { profile: 'unsupported-connector-style' }
      })
    ).toThrow()
  })

  test('forwards exact runtime, target, context, and operation without substitution', async () => {
    const calls: Record<string, unknown>[] = []
    const tools = setup(async (body) => {
      calls.push(body)
      return {
        ok: true,
        result: { status: { mutation: 'applied' } },
        target: { documentId: 'document:1', pageId: 'page:1' }
      }
    })
    const change = requireTool(tools, 'board_change')
    const args = {
      content_document_id: 'content-document:1',
      context_token: 'context:1',
      document_id: 'document:1',
      expected_revision: 12,
      operation: {
        anchor_id: 'node:anchor',
        artifact: { kind: 'native_text', text: 'Native note' },
        kind: 'artifact.create'
      },
      page_id: 'page:1',
      request_id: 'request:1',
      runtime_instance_id: 'runtime:1',
      task_id: 'task:1',
      trace_id: 'trace:1',
      workspace_id: 'workspace:1'
    }

    await change.handler(args)

    expect(calls).toEqual([{ args, command: 'board_change' }])
    expect(() =>
      change.inputSchema.parse({ ...args, visual: { profile: 'unknown-profile' } })
    ).toThrow()

    const connect = requireTool(tools, 'connect_objects')
    const connectArgs = {
      automatic: false,
      content_document_id: 'content-document:1',
      context_token: 'context:2',
      document_id: 'document:1',
      expected_revision: 13,
      kind: 'data',
      page_id: 'page:1',
      request_id: 'request:connect',
      runtime_instance_id: 'runtime:1',
      source_id: 'node:source',
      target_id: 'node:target',
      workspace_id: 'workspace:1'
    }
    await connect.handler(connectArgs)
    expect(calls.at(-1)).toEqual({ args: connectArgs, command: 'connect_objects' })
    const {
      content_document_id: contentDocumentId,
      context_token: contextToken,
      document_id: documentId,
      expected_revision: expectedRevision,
      page_id: pageId,
      runtime_instance_id: runtimeInstanceId,
      workspace_id: workspaceId,
      ...connectLogical
    } = connectArgs
    await connect.handler({
      base: {
        content_document_id: contentDocumentId,
        context_token: contextToken,
        document_id: documentId,
        expected_revision: expectedRevision,
        page_id: pageId,
        runtime_instance_id: runtimeInstanceId,
        workspace_id: workspaceId
      },
      ...connectLogical
    })
    expect(calls.at(-1)).toEqual({ args: connectArgs, command: 'connect_objects' })
    expect(connect.description).toContain('data/action links require explicit automatic')
  })
})
