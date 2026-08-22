import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { boardBuildInputSchema, registerBoardBuildTool } from '#mcp/tool/board-build-registration'

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

type RegisteredTool = {
  description: string
  handler: ToolHandler
  inputSchema: z.ZodType
}

function exactBuildArgs(): Record<string, unknown> {
  return {
    anchor_id: 'node:anchor',
    content_document_id: 'content-document:stable',
    context_token: 'context:exact',
    contract: 'board-build/v1',
    document_id: 'document-tab:runtime',
    expected_revision: 12,
    intent: 'Create a useful flow',
    page_id: 'page:exact',
    recipe: {
      kind: 'native_diagram',
      source: 'flowchart LR\n  A --> B',
      source_format: 'mermaid'
    },
    request_id: 'request:exact',
    runtime_instance_id: 'runtime:exact',
    workspace_id: 'workspace:exact'
  }
}

function packetBuildArgs(args = exactBuildArgs()): Record<string, unknown> {
  const {
    content_document_id,
    context_token,
    contract,
    document_id,
    expected_revision,
    page_id,
    runtime_instance_id,
    workspace_id,
    ...logical
  } = args
  return {
    base: {
      content_document_id,
      context_token,
      contract,
      document_id,
      expected_revision,
      page_id,
      runtime_instance_id,
      workspace_id
    },
    ...logical
  }
}

describe('general bounded Board builder MCP registration', () => {
  test('accepts one atomic mixed plan under board_build and excludes recipe-only fields', () => {
    const { anchor_id: _anchorId, recipe: _recipe, ...base } = exactBuildArgs()
    const planArgs = {
      ...base,
      plan: {
        artifacts: [
          {
            alias: 'start',
            recipe: {
              body: 'A single durable composition.',
              kind: 'native_card',
              placement: { target: { kind: 'point', x: 100, y: 120 } },
              title: 'Start'
            }
          },
          {
            alias: 'note',
            anchor: { alias: 'start' },
            recipe: { kind: 'native_text', text: 'Then verify.' }
          }
        ],
        contract: 'board-build-plan/v1'
      }
    }
    expect(boardBuildInputSchema.parse(planArgs)).toMatchObject(planArgs)
    expect(boardBuildInputSchema.parse(packetBuildArgs(planArgs))).toMatchObject(
      packetBuildArgs(planArgs)
    )
    expect(() => boardBuildInputSchema.parse({ ...planArgs, anchor_id: 'node:anchor' })).toThrow()
    expect(() =>
      boardBuildInputSchema.parse({
        ...planArgs,
        plan: { ...planArgs.plan, artifacts: [...planArgs.plan.artifacts, { alias: 'bad' }] }
      })
    ).toThrow()
  })

  test('exposes semantic composition without public grid geometry', () => {
    const { anchor_id: _anchorId, recipe: _recipe, ...base } = exactBuildArgs()
    const planArgs = {
      ...base,
      plan: {
        artifacts: [
          {
            alias: 'title',
            recipe: {
              kind: 'native_text',
              placement: { target: { kind: 'point', x: 320, y: 200 } },
              text: 'Research plan'
            }
          },
          {
            alias: 'one',
            recipe: { body: 'First item.', height: 216, kind: 'native_card', title: 'One' }
          },
          {
            alias: 'two',
            recipe: { body: 'Second item.', height: 236, kind: 'native_card', title: 'Two' }
          }
        ],
        contract: 'board-build-plan/v1',
        composition: {
          anchor: { alias: 'title' },
          members: [{ alias: 'one' }, { alias: 'two' }],
          placement: 'below',
          preferences: { direction: 'horizontal' }
        }
      }
    }

    expect(boardBuildInputSchema.parse(planArgs)).toMatchObject(planArgs)
    const independentlyPlaced = structuredClone(planArgs)
    independentlyPlaced.plan.artifacts[1].recipe.placement = {
      target: { kind: 'point', x: 400, y: 400 }
    }
    expect(() => boardBuildInputSchema.parse(independentlyPlaced)).toThrow(
      'may not declare anchor or recipe placement fields'
    )
    expect(() =>
      boardBuildInputSchema.parse({
        ...planArgs,
        plan: { ...planArgs.plan, layout: { columns: 2, kind: 'grid' } }
      })
    ).toThrow('layout')
  })

  test('accepts anchorless semantic composition only for new aliases without relative placement', () => {
    const { anchor_id: _anchorId, recipe: _recipe, ...base } = exactBuildArgs()
    const planArgs = {
      ...base,
      plan: {
        artifacts: [
          {
            alias: 'one',
            recipe: { body: 'First item.', kind: 'native_card', title: 'One' }
          },
          {
            alias: 'two',
            recipe: { body: 'Second item.', kind: 'native_card', title: 'Two' }
          }
        ],
        composition: {
          members: [{ alias: 'one' }, { alias: 'two' }],
          preferences: { direction: 'horizontal' }
        },
        contract: 'board-build-plan/v1'
      }
    }

    expect(boardBuildInputSchema.parse(planArgs)).toMatchObject(planArgs)
    expect(() =>
      boardBuildInputSchema.parse({
        ...planArgs,
        plan: {
          ...planArgs.plan,
          composition: { ...planArgs.plan.composition, placement: 'right' }
        }
      })
    ).toThrow('anchor is required when relative placement is requested')
  })

  test('accepts a direction subset and sends a canonical complete order to the RPC', async () => {
    const { anchor_id: _anchorId, recipe: _recipe, ...base } = exactBuildArgs()
    const args = {
      ...base,
      plan: {
        artifacts: [
          {
            alias: 'start',
            recipe: {
              body: 'Start here.',
              kind: 'native_card',
              placement: { target: { kind: 'auto' } },
              title: 'Start'
            }
          },
          {
            alias: 'finish',
            anchor: { alias: 'start' },
            recipe: {
              body: 'Finish here.',
              kind: 'native_card',
              placement: {
                preferred_directions: ['left', 'top']
              },
              title: 'Finish'
            }
          }
        ],
        contract: 'board-build-plan/v1'
      }
    }
    const calls: Record<string, unknown>[] = []
    let registered: RegisteredTool | undefined
    const server = {
      registerTool(
        _name: string,
        options: { description: string; inputSchema: z.ZodType },
        handler: ToolHandler
      ) {
        registered = { ...options, handler }
      }
    }
    registerBoardBuildTool(server as McpServer, async (body) => {
      calls.push(body)
      return { ok: true, result: { status: { command: 'completed' } } }
    })
    if (!registered) throw new Error('board_build was not registered')

    const parsed = registered.inputSchema.parse(args)
    await registered.handler(parsed)
    expect(calls).toMatchObject([
      {
        args: {
          plan: {
            artifacts: [
              {},
              {
                recipe: {
                  placement: {
                    preferred_directions: ['left', 'above', 'right', 'below']
                  }
                }
              }
            ]
          }
        },
        command: 'board_build'
      }
    ])

    const unsupported = structuredClone(args)
    unsupported.plan.artifacts[1].recipe.placement.preferred_directions = ['north']
    expect(() => registered?.inputSchema.parse(unsupported)).toThrow()

    const duplicate = structuredClone(args)
    duplicate.plan.artifacts[1].recipe.placement.preferred_directions = ['above', 'top']
    await registered.handler(registered.inputSchema.parse(duplicate))
    expect(calls.at(-1)).toMatchObject({
      args: {
        plan: {
          artifacts: [
            {},
            {
              recipe: {
                placement: { preferred_directions: ['above', 'right', 'below', 'left'] }
              }
            }
          ]
        }
      },
      command: 'board_build'
    })

    const naturalDiagonal = structuredClone(args)
    naturalDiagonal.plan.artifacts[1].recipe.placement.preferred_directions = ['top right']
    await registered.handler(registered.inputSchema.parse(naturalDiagonal))
    expect(calls.at(-1)).toMatchObject({
      args: {
        plan: {
          artifacts: [
            {},
            {
              recipe: {
                placement: {
                  preferred_directions: ['above', 'right', 'below', 'left'],
                  relative_offset: { column: 1, row: -1 }
                }
              }
            }
          ]
        }
      },
      command: 'board_build'
    })

    const empty = structuredClone(args)
    empty.plan.artifacts[1].recipe.placement.preferred_directions = []
    expect(() => registered?.inputSchema.parse(empty)).toThrow()
  })

  test('exposes Code Object and native Mermaid artifacts under the same plan contract', () => {
    const { anchor_id: _anchorId, recipe: _recipe, ...base } = exactBuildArgs()
    const args = {
      ...base,
      plan: {
        artifacts: [
          {
            alias: 'app',
            recipe: {
              kind: 'code_object',
              name: 'Risk triage',
              object_key: 'risk-triage-v1',
              operation: 'create',
              placement: { target: { kind: 'auto' } },
              source: 'export default function App(){return <main>Risk triage</main>}',
              source_format: 'tsx'
            }
          },
          {
            alias: 'flow',
            anchor: { alias: 'app' },
            recipe: {
              kind: 'native_diagram',
              placement: { clearance: 72, preferred_directions: ['right'] },
              source: 'flowchart LR\n  Observe --> Decide',
              source_format: 'mermaid'
            }
          }
        ],
        contract: 'board-build-plan/v1'
      }
    }
    expect(boardBuildInputSchema.parse(args)).toMatchObject(args)
  })

  test('requires every exact identity and enforces route-specific anchor rules', () => {
    const creation = exactBuildArgs()
    expect(boardBuildInputSchema.parse(creation)).toMatchObject(creation)

    for (const field of [
      'content_document_id',
      'context_token',
      'document_id',
      'page_id',
      'runtime_instance_id',
      'workspace_id'
    ]) {
      const missing = Object.fromEntries(Object.entries(creation).filter(([key]) => key !== field))
      expect(() => boardBuildInputSchema.parse(missing)).toThrow()
    }

    const missingAnchor: Record<string, unknown> = { ...creation }
    delete missingAnchor.anchor_id
    expect(boardBuildInputSchema.parse(missingAnchor)).toMatchObject(missingAnchor)

    const refinement = {
      ...missingAnchor,
      recipe: {
        kind: 'native_diagram',
        owner_id: 'node:diagram-owner',
        source: 'flowchart LR\n  A --> B --> C',
        source_format: 'mermaid'
      }
    }
    expect(boardBuildInputSchema.parse(refinement)).toMatchObject(refinement)
    expect(() => boardBuildInputSchema.parse({ ...refinement, anchor_id: 'node:anchor' })).toThrow(
      'cannot combine owner_id with anchor_id'
    )

    expect(() =>
      boardBuildInputSchema.parse({
        ...missingAnchor,
        recipe: { kind: 'native_text', text: 'Anchor required' }
      })
    ).toThrow('anchor_id')

    const card = {
      ...creation,
      recipe: {
        body: 'One bounded native composition.',
        kind: 'native_card',
        title: 'General builder card',
        width: 360
      }
    }
    expect(boardBuildInputSchema.parse(card)).toMatchObject(card)
    expect(() => boardBuildInputSchema.parse({ ...card, anchor_id: undefined })).toThrow(
      'anchor_id'
    )
    const pointCard = {
      ...card,
      anchor_id: undefined,
      recipe: {
        ...card.recipe,
        placement: { target: { kind: 'point', x: 120, y: -80 } }
      }
    }
    expect(boardBuildInputSchema.parse(pointCard)).toMatchObject(pointCard)
    const autoCard = {
      ...card,
      anchor_id: undefined,
      recipe: {
        ...card.recipe,
        placement: { target: { kind: 'auto' } }
      }
    }
    expect(boardBuildInputSchema.parse(autoCard)).toMatchObject(autoCard)
    const relativeCard = {
      ...card,
      anchor_id: undefined,
      recipe: {
        ...card.recipe,
        placement: {
          preferred_directions: ['right', 'left', 'below', 'above'],
          target: { kind: 'relative', object_id: 'node:release-readiness' }
        }
      }
    }
    expect(boardBuildInputSchema.parse(relativeCard)).toMatchObject(relativeCard)
    expect(() =>
      boardBuildInputSchema.parse({
        ...autoCard,
        recipe: { ...autoCard.recipe, placement: { target: { kind: 'auto', x: 10 } } }
      })
    ).toThrow()
    expect(() => boardBuildInputSchema.parse({ ...pointCard, anchor_id: 'node:anchor' })).toThrow(
      'exactly one'
    )
    expect(() =>
      boardBuildInputSchema.parse({
        ...pointCard,
        recipe: {
          ...pointCard.recipe,
          placement: { target: { height: 0, kind: 'region', width: 300, x: 0, y: 0 } }
        }
      })
    ).toThrow()
    expect(() =>
      boardBuildInputSchema.parse({ ...card, recipe: { ...card.recipe, width: 900 } })
    ).toThrow()
  })

  test('rejects unsupported native recipe fields and nested placement typos', () => {
    const cases = [
      {
        field: 'color',
        recipe: { color: '#ff0000', kind: 'native_text', text: 'Visible text' }
      },
      {
        field: 'titel',
        recipe: {
          body: 'Visible body',
          kind: 'native_card',
          titel: 'Misspelled title',
          title: 'Visible title'
        }
      },
      {
        field: 'theme',
        recipe: {
          kind: 'native_diagram',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid',
          theme: 'dark'
        }
      },
      {
        field: 'clearence',
        recipe: {
          kind: 'native_text',
          placement: { clearence: 48 },
          text: 'Visible text'
        }
      }
    ]

    for (const item of cases) {
      const result = boardBuildInputSchema.safeParse({ ...exactBuildArgs(), recipe: item.recipe })
      expect(result.success).toBe(false)
      if (result.success) throw new Error(`Expected ${item.field} to be rejected.`)
      expect(JSON.stringify(result.error.issues)).toContain(item.field)
    }
  })

  test('rejects unsupported top-level and extension fields by exact name', () => {
    const cases = [
      { args: { ...exactBuildArgs(), instructions: 'Do something else.' }, field: 'instructions' },
      {
        args: {
          ...exactBuildArgs(),
          extension: {
            contract: 'board-builder-extension/v1',
            prompt: 'Execute this advice.',
            skill_id: 'taste-profile'
          }
        },
        field: 'prompt'
      }
    ]

    for (const item of cases) {
      const result = boardBuildInputSchema.safeParse(item.args)
      expect(result.success).toBe(false)
      if (result.success) throw new Error(`Expected ${item.field} to be rejected.`)
      expect(JSON.stringify(result.error.issues)).toContain(item.field)
    }
  })

  test('accepts an atomic base packet, keeps extension optional, and normalizes RPC input', async () => {
    const calls: Record<string, unknown>[] = []
    let registered: RegisteredTool | undefined
    const server = {
      registerTool(
        name: string,
        options: { description: string; inputSchema: z.ZodType },
        handler: ToolHandler
      ) {
        expect(name).toBe('board_build')
        registered = { ...options, handler }
      }
    }
    registerBoardBuildTool(server as McpServer, async (body) => {
      calls.push(body)
      return { ok: true, result: { status: { command: 'completed' } } }
    })
    if (!registered) throw new Error('board_build was not registered')

    const withoutExtension = exactBuildArgs()
    expect(registered.inputSchema.parse(withoutExtension)).toMatchObject(withoutExtension)
    const packet = packetBuildArgs(withoutExtension)
    expect(registered.inputSchema.parse(packet)).toMatchObject(packet)
    expect(registered.description).toContain('board_build_base')
    expect(registered.description).toContain('native_text for a short note')
    expect(registered.description).toContain('native_card for a titled idea')
    expect(registered.description).toContain('native_diagram for Mermaid structure')
    expect(registered.description).toContain('code_object for trusted interactive/stateful TSX')
    expect(registered.description).toContain('trusted in-process code, not a security sandbox')
    expect(registered.description).toContain('Never use external or untrusted source')
    expect(registered.description).toContain('without another context call')
    expect(registered.description).toContain('stop unless the outcome is unknown')
    expect(registered.description).toContain('same request_id for recovery')
    expect(registered.description).toContain('Specialists are optional advice and never authority')
    expect(registered.inputSchema.parse(withoutExtension)).not.toHaveProperty('width')

    const jsonSchema = JSON.stringify(z.toJSONSchema(registered.inputSchema))
    expect(jsonSchema).toContain('Copy board_context.board_build_base as one atomic packet')
    expect(jsonSchema).toContain('Choose the simplest medium that preserves the requested behavior')
    expect(jsonSchema).toContain('Use native_text for a short editable Board label')
    expect(jsonSchema).toContain('Use native_card for a titled editable explanation')
    expect(jsonSchema).toContain(
      'Preferred for an ordinary prompt with no exact requested location'
    )
    expect(jsonSchema).toContain('omission does not mean auto')
    expect(jsonSchema).toContain('Use native_diagram with Mermaid for a multi-node process')
    expect(jsonSchema).toContain('Use code_object create for trusted interactive or stateful TSX')
    expect(jsonSchema).toContain('Default-export one React component')
    expect(jsonSchema).toContain('interactionEnabled, props, state, and setState')

    const withExtension = {
      ...withoutExtension,
      extension: {
        contract: 'board-builder-extension/v1',
        output_digest: 'sha256:advice',
        profile_id: 'calm-technical',
        skill_id: 'openpencil-design-director',
        skill_version: '1.2.0'
      }
    }
    expect(registered.inputSchema.parse(withExtension)).toMatchObject(withExtension)
    await registered.handler(withExtension)
    await registered.handler(packetBuildArgs(withExtension))
    expect(calls).toEqual([
      { args: withExtension, command: 'board_build' },
      { args: withExtension, command: 'board_build' }
    ])

    expect(() =>
      registered?.inputSchema.parse({
        ...withExtension,
        extension: { contract: 'unknown', skill_id: 'untrusted' }
      })
    ).toThrow()
  })

  test('accepts only bounded guarded TSX Code Object create and refine recipes', () => {
    const codeObject = {
      ...exactBuildArgs(),
      recipe: {
        height: 520,
        initial_state: { count: 0 },
        kind: 'code_object',
        name: 'Idea dashboard',
        object_key: 'idea-dashboard',
        operation: 'create',
        placement: {
          clearance: 48,
          preferred_directions: ['right', 'below', 'left', 'above']
        },
        props: { accent: 'violet' },
        source: 'export default function Dashboard() { return <main>Idea</main> }',
        source_format: 'tsx',
        width: 720
      }
    }
    expect(boardBuildInputSchema.parse(codeObject)).toMatchObject(codeObject)
    expect(
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: { ...codeObject.recipe, source: 'x'.repeat(100_000) }
      })
    ).toMatchObject({ recipe: { source: expect.stringMatching(/^x{100000}$/u) } })
    expect(() =>
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: { ...codeObject.recipe, source: 'x'.repeat(100_001) }
      })
    ).toThrow()
    expect(() => boardBuildInputSchema.parse({ ...codeObject, anchor_id: undefined })).toThrow(
      'exactly one of anchor_id or placement.target'
    )
    expect(
      boardBuildInputSchema.parse({
        ...codeObject,
        anchor_id: undefined,
        recipe: {
          ...codeObject.recipe,
          placement: { ...codeObject.recipe.placement, target: { kind: 'auto' } }
        }
      })
    ).toMatchObject({
      anchor_id: undefined,
      recipe: { placement: { target: { kind: 'auto' } } }
    })
    expect(() =>
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: {
          ...codeObject.recipe,
          placement: { ...codeObject.recipe.placement, target: { kind: 'auto' } }
        }
      })
    ).toThrow('exactly one of anchor_id or placement.target')

    for (const unsupported of [
      'connections',
      'owner',
      'permissions',
      'persist',
      'update',
      'x',
      'y'
    ]) {
      expect(() =>
        boardBuildInputSchema.parse({
          ...codeObject,
          recipe: { ...codeObject.recipe, [unsupported]: true }
        })
      ).toThrow()
    }
    expect(() =>
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: { ...codeObject.recipe, operation: 'update' }
      })
    ).toThrow()
    expect(() =>
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: { ...codeObject.recipe, source_format: 'javascript' }
      })
    ).toThrow()
    expect(() =>
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: { ...codeObject.recipe, initial_state: { invalid: undefined } }
      })
    ).toThrow()
    expect(() =>
      boardBuildInputSchema.parse({
        ...codeObject,
        recipe: { ...codeObject.recipe, width: 1_601 }
      })
    ).toThrow()

    const { anchor_id: _anchorId, ...withoutAnchor } = codeObject
    const refinement = {
      ...withoutAnchor,
      recipe: {
        expected_source_hash: `sha256:${'a'.repeat(64)}`,
        kind: 'code_object',
        object_key: 'idea-dashboard',
        operation: 'refine',
        owner_id: 'node:idea-dashboard',
        source: 'export default function Dashboard() { return <main>Refined</main> }',
        source_format: 'tsx'
      }
    }
    expect(boardBuildInputSchema.parse(refinement)).toMatchObject(refinement)
    expect(() =>
      boardBuildInputSchema.parse({
        ...refinement,
        recipe: { ...refinement.recipe, expected_source_hash: undefined }
      })
    ).toThrow()
    expect(() => boardBuildInputSchema.parse({ ...refinement, anchor_id: 'node:anchor' })).toThrow(
      'uses recipe.owner_id'
    )
  })
})
