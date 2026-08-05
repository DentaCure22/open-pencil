import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import {
  codeObjectReadInputSchema,
  registerCodeObjectReadTool
} from '#mcp/tool/code-object-registration'

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

function textResult(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ text?: string; type: string }> }).content
  const text = content?.find((item) => item.type === 'text')?.text
  if (!text) throw new Error('Missing MCP text result')
  return JSON.parse(text) as Record<string, unknown>
}

function exactArgs() {
  return {
    content_document_id: 'content-document:code-object',
    document_id: 'document-tab:code-object',
    owner_id: 'node:code-object-owner',
    page_id: 'page:code-object',
    runtime_instance_id: 'runtime:code-object',
    workspace_id: 'workspace:code-object'
  }
}

describe('Code Object read MCP registration', () => {
  test('requires an exact target and owner ID, then forwards unchanged', async () => {
    const args = exactArgs()
    expect(codeObjectReadInputSchema.parse(args)).toEqual(args)
    for (const field of Object.keys(args)) {
      const missing = Object.fromEntries(Object.entries(args).filter(([key]) => key !== field))
      expect(() => codeObjectReadInputSchema.parse(missing)).toThrow()
    }

    let handler: ToolHandler | undefined
    const server = {
      registerTool(
        name: string,
        options: { description: string; inputSchema: z.ZodType },
        registered: ToolHandler
      ) {
        expect(name).toBe('get_code_object')
        expect(options.description).toContain('SHA-256 source hash')
        expect(options.description).toContain('board_build_refine_recipe_base')
        handler = registered
      }
    }
    const calls: Record<string, unknown>[] = []
    registerCodeObjectReadTool(server as McpServer, async (body) => {
      calls.push(body)
      return {
        ok: true,
        result: {
          board_build_refine_recipe_base: {
            expected_source_hash: `sha256:${'a'.repeat(64)}`,
            kind: 'code_object',
            object_key: 'decision-lens',
            operation: 'refine',
            owner_id: 'node:code-object-owner',
            source_format: 'tsx'
          },
          component: {
            definition_id: 'decision-lens',
            source_hash: `sha256:${'a'.repeat(64)}`
          }
        }
      }
    })
    if (!handler) throw new Error('get_code_object was not registered')
    expect(textResult(await handler(args))).toMatchObject({
      board_build_refine_recipe_base: {
        expected_source_hash: `sha256:${'a'.repeat(64)}`,
        object_key: 'decision-lens',
        owner_id: 'node:code-object-owner'
      }
    })
    expect(calls).toEqual([{ args, command: 'get_code_object' }])
  })

  test('preserves the live direct app response as well as its exact target', async () => {
    let handler: ToolHandler | undefined
    const server = {
      registerTool(
        _name: string,
        _options: { description: string; inputSchema: z.ZodType },
        registered: ToolHandler
      ) {
        handler = registered
      }
    }
    registerCodeObjectReadTool(server as McpServer, () =>
      Promise.resolve({
        component: {
          definition_id: 'decision-lens',
          source_hash: `sha256:${'b'.repeat(64)}`,
          state: { activeChoice: 'A' }
        },
        frame: { height: 480, id: 'node:code-object-owner', width: 680, x: 144, y: 96 },
        ok: true,
        target: { pageId: 'page:code-object', runtimeInstanceId: 'runtime:code-object' }
      })
    )
    if (!handler) throw new Error('get_code_object was not registered')

    expect(textResult(await handler(exactArgs()))).toEqual({
      component: {
        definition_id: 'decision-lens',
        source_hash: `sha256:${'b'.repeat(64)}`,
        state: { activeChoice: 'A' }
      },
      frame: { height: 480, id: 'node:code-object-owner', width: 680, x: 144, y: 96 },
      target: { pageId: 'page:code-object', runtimeInstanceId: 'runtime:code-object' }
    })
  })

  test('omits full source by default and returns only an explicitly bounded excerpt', async () => {
    let handler: ToolHandler | undefined
    const source = '0123456789'.repeat(4_000)
    const server = {
      registerTool(
        _name: string,
        _options: { description: string; inputSchema: z.ZodType },
        registered: ToolHandler
      ) {
        handler = registered
      }
    }
    registerCodeObjectReadTool(server as McpServer, () =>
      Promise.resolve({
        ok: true,
        result: {
          component: {
            definition_id: 'large-code-object',
            source,
            source_hash: `sha256:${'c'.repeat(64)}`,
            source_length: source.length
          }
        }
      })
    )
    if (!handler) throw new Error('get_code_object was not registered')

    const metadata = textResult(await handler(exactArgs()))
    expect(metadata.component).not.toHaveProperty('source')
    expect(metadata.component).toHaveProperty('source_ref')

    const excerpt = textResult(
      await handler({
        ...exactArgs(),
        include_source: true,
        source_length: 1_000,
        source_start: 500
      })
    )
    expect(excerpt.component).toMatchObject({
      source_excerpt: source.slice(500, 1_500),
      source_range: { end: 1_500, start: 500, total: source.length, truncated: true }
    })
    expect(excerpt.component).not.toHaveProperty('source')
  })
})
