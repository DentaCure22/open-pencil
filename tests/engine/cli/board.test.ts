import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BOARD_BUILD_REQUEST_CONTRACT,
  buildWithFreshContext,
  exactFreshContextTarget,
  exactFreshContextTargetSource,
  normalizeFreshContextRecipe,
  parseBoardBuildRequest,
  resolveExactVisibleTopLevelObjectId,
  type BoardBuildRpcSender
} from '#cli/board-build/fresh-context'
import { editWithFreshContext } from '#cli/board-edit/fresh-context'
import {
  normalizeFreshBoardPresentLogical,
  presentWithFreshContext
} from '#cli/board-present/fresh-context'
import { parseBoardReadCliArgs } from '#cli/board-read/arguments'
import { readWithFreshContext } from '#cli/board-read/fresh-context'
import boardCommand, {
  boardBuildUsesAutomaticContext,
  boardBuildCommandErrorResult,
  boardBuildRpcArgs,
  boardBuildPlanSource,
  boardBuildRecipeSource,
  boardBuildRequestSource,
  boardCommandErrorResult,
  boardConnectRpcArgs,
  boardContextRpcArgs,
  boardEditRpcArgs,
  boardPresentFreshTarget,
  boardPresentLogicalRpcArgs,
  boardPresentRpcArgs,
  boardReadRpcArgs,
  boardVerifyRpcArgs,
  boardInternalCommand,
  resolveBoardBuildPlanSource,
  resolveBoardBuildRequest,
  withBoardBuildRecipeCompilation
} from '#cli/commands/board'

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

const persistedTarget = {
  content_document_id: 'content-document:1',
  document_id: 'document:1',
  page_id: 'page:1',
  workspace_id: 'workspace:1'
}

function canonicalBuildRequest() {
  return {
    contract: BOARD_BUILD_REQUEST_CONTRACT,
    intent: 'Build one status card',
    plan: {
      artifacts: [
        {
          alias: 'status',
          recipe: {
            body: 'Ready',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Status'
          }
        }
      ],
      contract: 'board-build-plan/v1'
    },
    request_id: 'request:canonical-build',
    target: persistedTarget
  }
}

async function* planInput(...chunks: string[]) {
  for (const chunk of chunks) yield Buffer.from(chunk)
}

function rpcTarget() {
  return {
    boardRevision: 12,
    contentDocumentId: 'content-document:1',
    documentId: 'document:1',
    documentName: 'Board document',
    pageId: 'page:1',
    pageName: 'Page 1',
    runtimeInstanceId: 'runtime:1',
    workspaceId: 'workspace:1'
  }
}

describe('semantic Board CLI arguments', () => {
  test('keeps guarded JSON refusals machine-readable without claiming mutation', () => {
    expect(
      boardCommandErrorResult(new Error('No collision-free placement was found.'), {
        ...exactTarget,
        json: true,
        'request-id': 'request:placement'
      })
    ).toMatchObject({
      error: { code: 'no_collision_free_placement' },
      next_action: { request_id: 'request:placement', retry_mutation: false },
      status: { command: 'needs_choice', mutation: 'not_applied' },
      target: exactRpcTarget
    })
  })

  test('releases local build validation as not applied while preserving unknown execution', () => {
    const args = {
      ...exactTarget,
      json: true,
      'request-id': 'request:invalid-plan'
    }
    expect(
      boardBuildCommandErrorResult(new Error('--plan-file must be a JSON object.'), args, false)
    ).toMatchObject({
      failure_scope: 'pre_mutation',
      release_summary: {
        artifact_count: 0,
        request_id: 'request:invalid-plan',
        status: 'stop'
      },
      status: { command: 'unavailable', mutation: 'not_applied' }
    })
    expect(
      boardBuildCommandErrorResult(new Error('RPC connection closed.'), args, true)
    ).toMatchObject({
      release_summary: { request_id: 'request:invalid-plan', status: 'unknown' },
      status: { command: 'unavailable', mutation: 'not_applied' }
    })
  })

  test('preserves an exact authority target on a traced pre-mutation refusal', () => {
    const error = Object.assign(new Error('No collision-free placement was found.'), {
      result: {
        current_revision: 12,
        error: {
          code: 'no_collision_free_placement',
          message: 'No collision-free placement was found.'
        },
        failure_scope: 'pre_mutation',
        next_action: { request_id: 'request:traced-refusal', retry_mutation: false },
        status: {
          attention_required: true,
          command: 'refused',
          mutation: 'not_applied',
          reason: 'no_collision_free_placement'
        },
        trace: { gesture_id: 'gesture:latest' }
      },
      target: rpcTarget()
    })

    const result = boardBuildCommandErrorResult(
      error,
      {
        intent: 'Replace traced cards',
        json: true,
        'latest-gesture': true,
        'request-id': 'request:traced-refusal'
      },
      true
    )

    expect(result).toMatchObject({
      current_revision: 12,
      failure_scope: 'pre_mutation',
      release_summary: {
        proof_limitations: [],
        revision: 12,
        status: 'stop',
        target: {
          content_document_id: 'content-document:1',
          document_id: 'document:1',
          page_id: 'page:1',
          page_name: 'Page 1',
          runtime_instance_id: 'runtime:1',
          workspace_id: 'workspace:1'
        }
      },
      status: { command: 'refused', mutation: 'not_applied' },
      trace: { gesture_id: 'gesture:latest' }
    })
    expect(JSON.stringify(result)).not.toContain('unknown Board')
    expect(JSON.stringify(result)).not.toContain('proof:not_reported')
  })

  test('acquires context from exact durable Board identity', () => {
    expect(boardContextRpcArgs({ current: true })).toEqual({ target: 'current_visible' })
    expect(
      boardContextRpcArgs({ current: true, 'runtime-instance-id': 'runtime:visible' })
    ).toEqual({ runtime_instance_id: 'runtime:visible', target: 'current_visible' })
    expect(
      boardContextRpcArgs({
        'page-id': 'page:1',
        'workspace-id': 'workspace:1'
      })
    ).toMatchObject({ page_id: 'page:1', workspace_id: 'workspace:1' })
    expect(
      boardContextRpcArgs({
        'page-id': 'page:1',
        'runtime-instance-id': 'runtime:1',
        'workspace-id': 'workspace:1'
      })
    ).toMatchObject({
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    })
    expect(() => boardContextRpcArgs({ 'page-id': 'page:1' })).toThrow(
      'workspace-id or --document-id'
    )
    expect(() => boardContextRpcArgs({ current: true, 'workspace-id': 'workspace:1' })).toThrow(
      '--current cannot be combined'
    )
  })

  test('maps strict guarded native object edits without raw eval', () => {
    const base = {
      ...exactTarget,
      'context-token': 'context:edit',
      'expected-revision': '12',
      'object-id': 'node:1',
      'request-id': 'request:edit'
    }
    expect(
      boardEditRpcArgs({
        ...base,
        operation: 'update',
        patch: JSON.stringify({ name: 'Renamed', opacity: 0.75, visible: true })
      })
    ).toMatchObject({
      context_token: 'context:edit',
      expected_revision: 12,
      operation: {
        kind: 'object.update',
        object_id: 'node:1',
        patch: { name: 'Renamed', opacity: 0.75, visible: true }
      },
      request_id: 'request:edit'
    })
    expect(boardEditRpcArgs({ ...base, operation: 'move', x: '-20', y: '340' })).toMatchObject({
      operation: { kind: 'object.move', object_id: 'node:1', x: -20, y: 340 }
    })
    expect(
      boardEditRpcArgs({ ...base, height: '90', operation: 'resize', width: '240' })
    ).toMatchObject({ operation: { height: 90, kind: 'object.resize', width: 240 } })
    expect(boardEditRpcArgs({ ...base, 'offset-x': '30', operation: 'duplicate' })).toMatchObject({
      operation: { kind: 'object.duplicate', object_id: 'node:1', offset_x: 30 }
    })
    expect(boardEditRpcArgs({ ...base, operation: 'delete' })).toMatchObject({
      operation: { kind: 'object.delete', object_id: 'node:1' }
    })
    expect(() => boardEditRpcArgs({ ...base, operation: 'move', x: '1' })).toThrow(
      'move requires --x and --y'
    )
    expect(() => boardEditRpcArgs({ ...base, operation: 'update' })).toThrow('--patch is required')
    expect(boardInternalCommand.subCommands?.edit).toBeDefined()
    expect(boardCommand.subCommands?.change).toBeUndefined()
  })

  test('runs one exact fresh-context edit handshake with capability and revision checks', async () => {
    const target = exactFreshContextTarget(exactTarget)
    const base = {
      ...exactRpcTarget,
      context_token: 'context:edit-fresh',
      contract: 'board-build/v1',
      expected_revision: 12
    }
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const ticks = [100, 103.5, 109.25]
    const execution = await editWithFreshContext(
      target,
      {
        operation: { kind: 'object.move', object_id: 'node:1', x: 40, y: 80 },
        request_id: 'request:fresh-edit'
      },
      {
        now: () => ticks.shift() ?? 109.25,
        send: async (command, args) => {
          calls.push({ args, command })
          if (command === 'board_context') {
            return {
              result: {
                board_build_base: base,
                capabilities: ['board.change.object.move']
              },
              target: rpcTarget()
            }
          }
          return {
            result: { owner_id: 'node:1', status: { mutation: 'applied' } },
            target: { ...rpcTarget(), boardRevision: 13 }
          }
        }
      }
    )
    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_change'])
    expect(calls[1]).toMatchObject({
      args: {
        context_token: 'context:edit-fresh',
        expected_revision: 12,
        operation: { kind: 'object.move', object_id: 'node:1', x: 40, y: 80 },
        request_id: 'request:fresh-edit'
      }
    })
    expect(execution.handshake).toEqual({
      contract: 'board-edit-fresh-context/v1',
      handshake_elapsed_ms: { board_change: 5.75, board_context: 3.5, total: 9.25 },
      semantic_rpc_calls: { board_change: 1, board_context: 1, total: 2 }
    })
    await expect(
      editWithFreshContext(
        target,
        {
          operation: { kind: 'object.delete', object_id: 'node:1' },
          request_id: 'request:no-capability'
        },
        {
          send: async () => ({
            result: { board_build_base: base, capabilities: [] },
            target: rpcTarget()
          })
        }
      )
    ).rejects.toThrow('lacks writer board.change.object.delete capability')
    expect(boardInternalCommand.subCommands?.edit?.args?.['fresh-context']?.description).toContain(
      'one CLI process'
    )
  })

  test('maps the self-sufficient general builder with optional specialist provenance', () => {
    expect(
      boardBuildRpcArgs({
        ...exactTarget,
        'anchor-id': 'node:anchor',
        'context-token': 'context:1',
        'expected-revision': '12',
        extension: JSON.stringify({
          contract: 'board-builder-extension/v1',
          profile_id: 'editorial-calm',
          skill_id: 'visual-taste'
        }),
        intent: 'Map the recovery path',
        recipe: JSON.stringify({
          kind: 'native_diagram',
          source: 'flowchart LR\n A --> B',
          source_format: 'mermaid'
        }),
        'request-id': 'request:build'
      })
    ).toMatchObject({
      anchor_id: 'node:anchor',
      content_document_id: 'content-document:1',
      context_token: 'context:1',
      contract: 'board-build/v1',
      document_id: 'document:1',
      expected_revision: 12,
      extension: {
        contract: 'board-builder-extension/v1',
        profile_id: 'editorial-calm',
        skill_id: 'visual-taste'
      },
      recipe: { kind: 'native_diagram', source_format: 'mermaid' },
      request_id: 'request:build'
    })
    const base = {
      content_document_id: 'content-document:1',
      context_token: 'context:1',
      contract: 'board-build/v1',
      document_id: 'document:1',
      expected_revision: 12,
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    }
    expect(
      boardBuildRpcArgs({
        base: JSON.stringify(base),
        intent: 'Map the recovery path',
        recipe: JSON.stringify({
          kind: 'native_diagram',
          source: 'flowchart LR\n A --> B',
          source_format: 'mermaid'
        }),
        'request-id': 'request:packet-build'
      })
    ).toMatchObject({ base, request_id: 'request:packet-build' })
    expect(() =>
      boardBuildRpcArgs({
        base: JSON.stringify(base),
        'context-token': 'context:duplicate',
        intent: 'Reject mixed bases',
        recipe: JSON.stringify({ kind: 'native_card', title: 'No', body: 'Mixed' }),
        'request-id': 'request:mixed-build'
      })
    ).toThrow('cannot be combined')
  })

  test('automatically acquires current authority for normal exact-target builds', () => {
    expect(boardBuildUsesAutomaticContext(exactTarget)).toBe(true)
    expect(boardBuildUsesAutomaticContext({ ...exactTarget, 'anchor-id': 'node:anchor' })).toBe(
      true
    )
    expect(boardBuildUsesAutomaticContext({ ...exactTarget, 'auto-place': true })).toBe(true)
    expect(boardBuildUsesAutomaticContext({ 'target-file': '/tmp/target.json' })).toBe(true)
    expect(
      boardBuildUsesAutomaticContext({
        ...exactTarget,
        'context-token': 'context:1',
        'expected-revision': '12'
      })
    ).toBe(false)
    expect(boardBuildUsesAutomaticContext({ 'gesture-id': 'gesture:1' })).toBe(false)
  })

  test('exposes one canonical agent-facing Board build input', () => {
    expect(Object.keys(boardCommand.subCommands ?? {})).toEqual([
      'search',
      'get',
      'ls',
      'nearby',
      'pages',
      'open',
      'where',
      'create',
      'build',
      'present'
    ])
    const args = boardCommand.subCommands?.build?.args ?? {}
    expect(Object.keys(args).sort()).toEqual(
      ['gesture-id', 'json', 'latest-gesture', 'release-summary', 'request', 'request-file'].sort()
    )
    expect(boardCommand.subCommands?.build?.meta?.description).toContain(
      BOARD_BUILD_REQUEST_CONTRACT
    )
    expect(args.request?.description).toContain('exact persisted target')
    expect(args['request-file']?.description).toContain('exceeds practical shell size')
    for (const removed of [
      'anchor-id',
      'base',
      'context-token',
      'expected-revision',
      'fresh-context',
      'plan',
      'plan-file',
      'recipe',
      'runtime-instance-id',
      'target-file'
    ]) {
      expect(args).not.toHaveProperty(removed)
    }
  })

  test('parses one inline canonical request and keeps authority internals out', async () => {
    const value = canonicalBuildRequest()
    const resolved = await resolveBoardBuildRequest({ request: JSON.stringify(value) })
    expect(resolved).toEqual(value)
    expect(resolved.target).not.toHaveProperty('runtime_instance_id')

    expect(() =>
      parseBoardBuildRequest({
        ...value,
        target: { ...value.target, runtime_instance_id: 'runtime:leaked' }
      })
    ).toThrow('unexpected or authority fields: runtime_instance_id')
    expect(() => parseBoardBuildRequest({ ...value, expected_revision: 12 })).toThrow(
      'unexpected or authority fields: expected_revision'
    )
    expect(() => parseBoardBuildRequest({ ...value, plan: null })).toThrow(
      'request.plan must be one board-build-plan/v1 JSON object'
    )
  })

  test('uses request files only as the shell-size escape hatch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-request-'))
    try {
      const requestPath = join(directory, 'request.json')
      const source = JSON.stringify(canonicalBuildRequest())
      await writeFile(requestPath, source)
      await expect(resolveBoardBuildRequest({ 'request-file': requestPath })).resolves.toEqual(
        canonicalBuildRequest()
      )
      await expect(
        resolveBoardBuildRequest({ 'request-file': '-' }, planInput(source))
      ).resolves.toEqual(canonicalBuildRequest())
      await expect(boardBuildRequestSource({})).rejects.toThrow(
        'Provide exactly one of --request or --request-file'
      )
      await expect(
        boardBuildRequestSource({ request: source, 'request-file': requestPath })
      ).rejects.toThrow('Provide exactly one of --request or --request-file')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('resolves runtime authority internally from the persisted request target', async () => {
    const request = canonicalBuildRequest()
    const base = {
      ...exactRpcTarget,
      context_token: 'context:canonical',
      contract: 'board-build/v1',
      expected_revision: 12
    }
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const execution = await buildWithFreshContext(
      request.target,
      { intent: request.intent, plan: request.plan, request_id: request.request_id },
      {
        send: async (command, args) => {
          calls.push({ args, command })
          if (command === 'board_context') {
            return {
              result: { board_build_base: base, capabilities: ['board.build.plan.v1'] },
              target: rpcTarget()
            }
          }
          return {
            result: { owner_ids: { status: 'node:status' } },
            target: { ...rpcTarget(), boardRevision: 13 }
          }
        }
      }
    )

    expect(calls[0]).toEqual({ args: persistedTarget, command: 'board_context' })
    expect(calls[0]?.args).not.toHaveProperty('runtime_instance_id')
    expect(calls[1]).toMatchObject({
      args: {
        base,
        intent: request.intent,
        plan: request.plan,
        request_id: request.request_id
      },
      command: 'board_build'
    })
    expect(execution.handshake.semantic_rpc_calls).toEqual({
      board_build: 1,
      board_context: 1,
      total: 2
    })
  })

  test('loads one recipe or direct TSX source file and keeps inputs exclusive', async () => {
    const packagePath = fileURLToPath(new URL('../../../package.json', import.meta.url))
    const source = await boardBuildRecipeSource({
      ...exactTarget,
      'recipe-file': packagePath
    })
    expect(JSON.parse(source)).toMatchObject({ name: 'open-pencil-app' })
    expect(
      boardBuildRecipeSource({ ...exactTarget, recipe: '{}', 'recipe-file': packagePath })
    ).rejects.toThrow('exactly one of --recipe, --recipe-file, or --source-file')
    expect(boardBuildRecipeSource(exactTarget)).rejects.toThrow(
      'exactly one of --recipe, --recipe-file, or --source-file'
    )
    const tsxPath = fileURLToPath(new URL('../../../src/main.ts', import.meta.url))
    const directSource = JSON.parse(
      await boardBuildRecipeSource({
        ...exactTarget,
        'auto-place': true,
        'fresh-context': true,
        height: '240',
        'initial-state': '{"count":2}',
        'object-key': 'counter-v1',
        'object-name': 'Counter',
        props: '{"label":"Tasks"}',
        'source-file': tsxPath,
        width: '360'
      })
    )
    expect(directSource).toMatchObject({
      height: 240,
      initial_state: { count: 2 },
      kind: 'code_object',
      name: 'Counter',
      object_key: 'counter-v1',
      operation: 'create',
      props: { label: 'Tasks' },
      source_format: 'tsx',
      width: 360
    })
    expect(directSource).not.toHaveProperty('placement')
    expect(directSource.source).toContain('createApp')
    const placedSource = JSON.parse(
      await boardBuildRecipeSource({
        ...exactTarget,
        base: '{"context_token":"context:1"}',
        'object-key': 'counter-v1',
        'object-name': 'Counter',
        placement: '{"kind":"point","x":640,"y":920}',
        'source-file': tsxPath
      })
    )
    expect(placedSource).toMatchObject({
      placement: { target: { kind: 'point', x: 640, y: 920 } }
    })
    const relativeSource = JSON.parse(
      await boardBuildRecipeSource({
        ...exactTarget,
        base: '{"context_token":"context:1"}',
        'object-key': 'counter-v1',
        'object-name': 'Counter',
        placement: '{"kind":"relative","object_id":"node:release-readiness"}',
        'source-file': tsxPath
      })
    )
    expect(relativeSource).toMatchObject({
      placement: {
        target: { kind: 'relative', object_id: 'node:release-readiness' }
      }
    })
    const relativeNamedSource = JSON.parse(
      await boardBuildRecipeSource({
        ...exactTarget,
        'fresh-context': true,
        'object-key': 'counter-v1',
        'object-name': 'Counter',
        'relative-to-name': 'Launch checklist',
        'source-file': tsxPath
      })
    )
    expect(relativeNamedSource).not.toHaveProperty('placement')
    await expect(
      boardBuildRecipeSource({
        ...exactTarget,
        'object-key': 'counter-v1',
        'object-name': 'Counter',
        'source-file': tsxPath
      })
    ).rejects.toThrow('exactly one of --auto-place, --placement, or --relative-to-name')
    await expect(
      boardBuildRecipeSource({
        ...exactTarget,
        'auto-place': true,
        'object-key': 'counter-v1',
        'object-name': 'Counter',
        placement: '{"kind":"point","x":640,"y":920}',
        'source-file': tsxPath
      })
    ).rejects.toThrow('exactly one of --auto-place, --placement, or --relative-to-name')
  })

  test('keeps mixed compositions under the universal board build command', async () => {
    const plan = {
      artifacts: [
        {
          alias: 'first',
          recipe: {
            body: 'One guarded transaction.',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 240, y: 320 } },
            title: 'Atomic plan'
          }
        }
      ],
      contract: 'board-build-plan/v1'
    }
    expect(
      boardBuildRpcArgs({
        ...exactTarget,
        'context-token': 'context:plan',
        'expected-revision': '12',
        intent: 'Build one mixed display',
        plan: JSON.stringify(plan),
        'request-id': 'request:plan'
      })
    ).toMatchObject({ intent: 'Build one mixed display', plan, request_id: 'request:plan' })
    expect(() =>
      boardBuildRpcArgs({
        ...exactTarget,
        'anchor-id': 'node:anchor',
        'context-token': 'context:plan',
        'expected-revision': '12',
        intent: 'Reject split targeting',
        plan: JSON.stringify(plan),
        'request-id': 'request:plan-anchor'
      })
    ).toThrow('--plan/--plan-file cannot be combined with --anchor-id')
    await expect(
      boardBuildPlanSource({
        ...exactTarget,
        'plan-file': fileURLToPath(new URL('../../../package.json', import.meta.url)),
        recipe: '{}'
      })
    ).rejects.toThrow('--plan/--plan-file is exclusive')
    expect(
      await boardBuildPlanSource(
        { 'auto-place': true, 'fresh-context': true, 'plan-file': '-' },
        planInput(JSON.stringify(plan))
      )
    ).toBe(JSON.stringify(plan))
    await expect(
      boardBuildPlanSource(
        { 'fresh-context': true, 'plan-file': '-', 'relative-to-name': 'Anchor' },
        planInput(JSON.stringify(plan))
      )
    ).rejects.toThrow('--plan/--plan-file is exclusive')
  })

  test('reads one strict mixed plan from --plan-file - stdin', async () => {
    const plan = {
      artifacts: [
        {
          alias: 'status',
          recipe: {
            body: 'Ready',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 240, y: 320 } },
            title: 'Status'
          }
        }
      ],
      contract: 'board-build-plan/v1'
    }
    const source = await boardBuildPlanSource(
      { 'plan-file': '-' },
      planInput(
        '{"contract":"board-build-plan/v1",',
        '"artifacts":',
        JSON.stringify(plan.artifacts),
        '}'
      )
    )
    expect(
      boardBuildRpcArgs({
        ...exactTarget,
        'context-token': 'context:stdin-plan',
        'expected-revision': '12',
        intent: 'Build from stdin',
        plan: source,
        'request-id': 'request:stdin-plan'
      })
    ).toMatchObject({ intent: 'Build from stdin', plan, request_id: 'request:stdin-plan' })
  })

  test('accepts one strict mixed plan inline without creating a file', async () => {
    const plan = {
      artifacts: [
        {
          alias: 'next',
          recipe: {
            body: 'Continue the work.',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Next step'
          }
        }
      ],
      contract: 'board-build-plan/v1'
    }
    const inline = JSON.stringify(plan)

    expect(await boardBuildPlanSource({ plan: inline })).toBe(inline)
    await expect(boardBuildPlanSource({ plan: inline, 'plan-file': 'plan.json' })).rejects.toThrow(
      'Provide only one of --plan or --plan-file'
    )
  })

  test('compiles one registered recipe through the existing plan-file path', async () => {
    const request = {
      contract: 'board-build-recipe-request/v1',
      params: {
        cards: [
          { body: 'Choose the smallest useful artifact.', title: 'Build' },
          { body: 'Trust the durable receipt.', title: 'Verify' }
        ],
        direction: 'horizontal',
        heading: 'Delivery loop'
      },
      recipe_id: 'structured_cards',
      recipe_version: 1
    }
    const resolved = await resolveBoardBuildPlanSource(JSON.stringify(request))
    const plan = JSON.parse(resolved.source)

    expect(resolved.compilation).toMatchObject({
      artifact_aliases: ['heading', 'card_01', 'card_02'],
      expanded_plan_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      recipe_id: 'structured_cards',
      recipe_version: 1,
      registry_version: 1
    })
    expect(plan).toMatchObject({
      artifacts: [
        { alias: 'heading', recipe: { kind: 'native_text' } },
        { alias: 'card_01', recipe: { kind: 'native_card' } },
        { alias: 'card_02', recipe: { kind: 'native_card' } }
      ],
      contract: 'board-build-plan/v1',
      composition: {
        anchor: { alias: 'heading' },
        members: [{ alias: 'card_01' }, { alias: 'card_02' }]
      }
    })
    expect(
      boardBuildRpcArgs({
        ...exactTarget,
        'context-token': 'context:registered-recipe',
        'expected-revision': '12',
        intent: 'Build one registered brief grid',
        plan: resolved.source,
        'request-id': 'request:registered-recipe'
      })
    ).toMatchObject({ plan, request_id: 'request:registered-recipe' })
    expect(
      withBoardBuildRecipeCompilation(
        { receipt: { requestId: 'request:registered-recipe', status: 'applied' } },
        resolved.compilation
      )
    ).toMatchObject({
      recipe_compilation: resolved.compilation,
      receipt: { recipe_compilation: resolved.compilation }
    })
  })

  test('routes one intent request through the existing plan-file and receipt path', async () => {
    const request = {
      contract: 'board-build-intent-request/v1',
      heading: 'Delivery workflow',
      intent: 'Show this workflow as connected process steps',
      items: [
        { body: 'Confirm the request.', title: 'Discover' },
        { body: 'Create the artifact.', title: 'Build' },
        { body: 'Check the durable result.', title: 'Verify' }
      ]
    }
    const resolved = await resolveBoardBuildPlanSource(JSON.stringify(request))
    const plan = JSON.parse(resolved.source)

    expect(resolved.intentCompilation).toMatchObject({
      capability_results: [
        {
          authority: 'none',
          capability_id: 'process_modeling',
          effect: 'compute',
          provider_id: 'builtin.board-recipe.process-flow'
        }
      ],
      contract: 'board-build-intent-compilation/v1',
      representation_plan: {
        dominant_representation: 'process_flow',
        outcome: 'process'
      }
    })
    expect(resolved.compilation).toMatchObject({ recipe_id: 'process_flow' })
    expect(plan).toMatchObject({
      composition: {
        members: [{ alias: 'step_01' }, { alias: 'step_02' }, { alias: 'step_03' }]
      },
      contract: 'board-build-plan/v1'
    })
    expect(
      withBoardBuildRecipeCompilation(
        { receipt: { requestId: 'request:intent-route', status: 'applied' } },
        resolved.compilation,
        resolved.intentCompilation
      )
    ).toMatchObject({
      intent_compilation: resolved.intentCompilation,
      recipe_compilation: resolved.compilation,
      receipt: {
        intent_compilation: resolved.intentCompilation,
        recipe_compilation: resolved.compilation
      }
    })
  })

  test('fails closed for empty or malformed --plan-file - stdin', async () => {
    await expect(boardBuildPlanSource({ 'plan-file': '-' }, planInput('', '  \n'))).rejects.toThrow(
      'requires a non-empty board-build-plan/v1, board-build-recipe-request/v1, or board-build-intent-request/v1 JSON value on stdin'
    )
    const malformed = await boardBuildPlanSource(
      { 'plan-file': '-' },
      planInput('{"contract":"board-build-plan/v1"')
    )
    expect(() =>
      boardBuildRpcArgs({
        ...exactTarget,
        'context-token': 'context:malformed-stdin-plan',
        'expected-revision': '12',
        intent: 'Reject malformed stdin',
        plan: malformed,
        'request-id': 'request:malformed-stdin-plan'
      })
    ).toThrow('--plan-file must be a JSON object')
  })

  test('runs a capable mixed plan through the existing fresh-context handshake', async () => {
    const base = {
      ...exactRpcTarget,
      context_token: 'context:plan',
      contract: 'board-build/v1',
      expected_revision: 12
    }
    const logical = {
      intent: 'Build a connected status display',
      plan: {
        artifacts: [
          {
            alias: 'status',
            recipe: {
              body: 'Ready',
              kind: 'native_card',
              placement: { target: { kind: 'point', x: 100, y: 100 } },
              title: 'Status'
            }
          }
        ],
        contract: 'board-build-plan/v1'
      },
      request_id: 'request:fresh-plan'
    }
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const startedCalls: string[] = []
    const execution = await buildWithFreshContext(exactFreshContextTarget(exactTarget), logical, {
      onSemanticCall: (command) => startedCalls.push(command),
      send: async (command, args) => {
        calls.push({ args, command })
        if (command === 'board_context') {
          return {
            result: { board_build_base: base, capabilities: ['board.build.plan.v1'] },
            target: rpcTarget()
          }
        }
        return {
          result: { owner_ids: { status: 'node:status' } },
          target: { ...rpcTarget(), boardRevision: 13 }
        }
      }
    })
    expect(startedCalls).toEqual(['board_context', 'board_build'])
    expect(calls.map(({ command }) => command)).toEqual(['board_context', 'board_build'])
    expect(calls[1]?.args).toMatchObject({ base, plan: logical.plan })
    expect(execution.handshake.semantic_rpc_calls).toEqual({
      board_build: 1,
      board_context: 1,
      total: 2
    })

    await expect(
      buildWithFreshContext(exactFreshContextTarget(exactTarget), logical, {
        send: async () => ({
          result: { board_build_base: base, capabilities: [] },
          target: rpcTarget()
        })
      })
    ).rejects.toThrow('lacks writer board.build.plan.v1 capability')
  })

  test('runs one exact fresh-context handshake and normalizes auto placement', async () => {
    const base = {
      ...exactRpcTarget,
      context_token: 'context:fresh',
      contract: 'board-build/v1',
      expected_revision: 12
    }
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardBuildRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        return { result: { board_build_base: base }, target: rpcTarget() }
      }
      return {
        result: { owner_id: 'card:1', status: 'completed' },
        target: { ...rpcTarget(), boardRevision: 13 }
      }
    }
    const ticks = [100, 104.25, 112.75]
    const result = await buildWithFreshContext(
      exactFreshContextTarget(exactTarget),
      {
        intent: 'Create a decision card',
        recipe: {
          body: 'Ship the bounded path.',
          kind: 'native_card',
          title: 'Decision'
        },
        request_id: 'request:fresh-card'
      },
      { autoPlace: true, now: () => ticks.shift() ?? 112.75, send }
    )

    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_build'])
    expect(calls[0]?.args).toEqual(exactRpcTarget)
    expect(calls[1]?.args.base).toBe(base)
    expect(calls[1]).toMatchObject({
      args: {
        intent: 'Create a decision card',
        recipe: { kind: 'native_card', placement: { target: { kind: 'auto' } } },
        request_id: 'request:fresh-card'
      },
      command: 'board_build'
    })
    expect(result.response.result).toEqual({ owner_id: 'card:1', status: 'completed' })
    expect(result.handshake).toEqual({
      contract: 'board-build-fresh-context/v2',
      handshake_elapsed_ms: { board_build: 8.5, board_context: 4.25, total: 12.75 },
      semantic_rpc_calls: { board_build: 1, board_context: 1, total: 2 },
      stale_recovery_count: 0
    })
    expect(result.handshake).not.toHaveProperty('calls')
    expect(result.handshake).not.toHaveProperty('timing_ms')
  })

  test('resolves one exact relative object name and recovers two conclusive stale races', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    let contextRevision = 12
    const send: BoardBuildRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        const revision = contextRevision
        contextRevision += 1
        return {
          result: {
            board_build_base: {
              ...exactRpcTarget,
              context_token: `context:${revision}`,
              contract: 'board-build/v1',
              expected_revision: revision
            },
            neighborhood: {
              nodes: [
                {
                  id: 'node:launch',
                  name: 'Launch checklist',
                  parent_id: 'page:1',
                  visible: true
                }
              ],
              truncated: false
            }
          },
          target: { ...rpcTarget(), boardRevision: revision }
        }
      }
      const buildCallCount = calls.filter((call) => call.command === 'board_build').length
      if (buildCallCount <= 2) {
        throw new Error(
          `Expected revision ${11 + buildCallCount}, current revision is ${12 + buildCallCount}`
        )
      }
      return {
        result: { owner_id: 'card:relative', status: 'completed' },
        target: { ...rpcTarget(), boardRevision: 14 }
      }
    }

    const result = await buildWithFreshContext(
      exactFreshContextTarget(exactTarget),
      {
        intent: 'Place beside launch',
        recipe: {
          body: 'Confirm owner',
          clearance: 24,
          kind: 'native_card',
          preferred_directions: ['right', 'below', 'above', 'left'],
          title: 'Next move'
        },
        request_id: 'request:relative-name'
      },
      { relativeToName: 'Launch checklist', send }
    )

    expect(calls.map(({ command }) => command)).toEqual([
      'board_context',
      'board_build',
      'board_context',
      'board_build',
      'board_context',
      'board_build'
    ])
    expect(calls[1]).toMatchObject({
      args: {
        recipe: {
          placement: {
            clearance: 24,
            preferred_directions: ['right', 'below', 'above', 'left'],
            target: { kind: 'relative', object_id: 'node:launch' }
          }
        },
        request_id: 'request:relative-name'
      }
    })
    expect(calls[5]).toMatchObject({
      args: {
        recipe: {
          placement: {
            clearance: 24,
            preferred_directions: ['right', 'below', 'above', 'left'],
            target: { kind: 'relative', object_id: 'node:launch' }
          }
        },
        request_id: 'request:relative-name'
      }
    })
    expect(result.handshake).toMatchObject({
      resolved_relative_object_id: 'node:launch',
      semantic_rpc_calls: { board_build: 3, board_context: 3, total: 6 },
      stale_recovery_count: 2
    })
  })

  test('resolves exact top-level names when only nested detail is truncated', () => {
    const completeTopLevelContext = {
      neighborhood: {
        nodes: [
          {
            child_ids_omitted: 2,
            id: 'node:launch',
            name: 'Launch checklist',
            name_scan_truncated: false,
            name_truncated: false,
            parent_id: 'page:1',
            visible: true
          }
        ],
        omitted: {
          child_ids: 2,
          name_code_units: 0,
          nodes: 0,
          text_code_units: 0,
          unscanned_page_root_children: 0
        },
        page_owned_candidate_count: 1,
        page_owned_candidate_count_exact: true,
        page_root_scan: { unscanned: 0 },
        returned: 1,
        truncated: true
      }
    }

    expect(
      resolveExactVisibleTopLevelObjectId(completeTopLevelContext, 'page:1', 'Launch checklist')
    ).toBe('node:launch')
    expect(() =>
      resolveExactVisibleTopLevelObjectId(
        {
          neighborhood: {
            ...completeTopLevelContext.neighborhood,
            omitted: {
              ...completeTopLevelContext.neighborhood.omitted,
              unscanned_page_root_children: 1
            },
            page_owned_candidate_count_exact: false,
            page_root_scan: { unscanned: 1 }
          }
        },
        'page:1',
        'Launch checklist'
      )
    ).toThrow('incomplete top-level name coverage')
  })

  test('uses a resolved named object as the persisted-authority Code Object anchor', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardBuildRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        return {
          result: {
            board_build_base: {
              ...exactRpcTarget,
              context_token: 'context:authority',
              contract: 'board-build/v1',
              expected_revision: 12
            },
            execution_surface: 'local_workspace_authority',
            neighborhood: {
              nodes: [
                {
                  id: 'node:launch',
                  name: 'Launch checklist',
                  parent_id: 'page:1',
                  visible: true
                }
              ],
              truncated: false
            }
          },
          target: rpcTarget()
        }
      }
      return {
        result: { owner_id: 'code:1', status: 'completed' },
        target: { ...rpcTarget(), boardRevision: 13 }
      }
    }
    await buildWithFreshContext(
      exactFreshContextTarget(exactTarget),
      {
        intent: 'Create checklist',
        recipe: {
          initial_state: {},
          kind: 'code_object',
          name: 'Checklist',
          object_key: 'checklist',
          operation: 'create',
          props: {},
          source: 'export default function Checklist(){return <main>Ready</main>}',
          source_format: 'tsx'
        },
        request_id: 'request:authority-code'
      },
      { relativeToName: 'Launch checklist', send }
    )
    expect(calls[1]).toMatchObject({
      args: {
        anchor_id: 'node:launch',
        recipe: { kind: 'code_object' }
      },
      command: 'board_build'
    })
    expect(calls[1]?.args).not.toHaveProperty('recipe.placement')
  })

  test('auto-places native text on an empty fresh-context Board', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const send: BoardBuildRpcSender = async (command, args) => {
      calls.push({ args, command })
      if (command === 'board_context') {
        return {
          result: {
            board_build_base: {
              ...exactRpcTarget,
              context_token: 'context:text-auto',
              contract: 'board-build/v1',
              expected_revision: 12
            },
            execution_surface: 'local_workspace_authority',
            neighborhood: { nodes: [], truncated: false }
          },
          target: rpcTarget()
        }
      }
      return {
        result: { owner_id: 'text:1', status: 'completed' },
        target: { ...rpcTarget(), boardRevision: 13 }
      }
    }

    const result = await buildWithFreshContext(
      exactFreshContextTarget(exactTarget),
      {
        intent: 'Create one field note',
        recipe: { kind: 'native_text', text: 'Relay check at 14:30.' },
        request_id: 'request:text-auto'
      },
      { autoPlace: true, send }
    )

    expect(calls.map(({ command }) => command)).toEqual(['board_context', 'board_build'])
    expect(calls[1]).toMatchObject({
      args: {
        recipe: {
          kind: 'native_text',
          placement: { target: { kind: 'auto' } },
          text: 'Relay check at 14:30.'
        },
        request_id: 'request:text-auto'
      },
      command: 'board_build'
    })
    expect(result.handshake).toMatchObject({
      semantic_rpc_calls: { board_build: 1, board_context: 1, total: 2 },
      stale_recovery_count: 0
    })
  })

  test('normalizes missing text, card, and Code Object placement for --auto-place', () => {
    const recipe = { body: 'Body', kind: 'native_card', title: 'Title' }
    expect(normalizeFreshContextRecipe(recipe, true)).toEqual({
      ...recipe,
      placement: { target: { kind: 'auto' } }
    })
    expect(normalizeFreshContextRecipe({ ...recipe, size: 'compact' }, true)).toMatchObject({
      placement: { target: { kind: 'auto' } },
      width: 240
    })
    expect(recipe).not.toHaveProperty('placement')
    expect(
      normalizeFreshContextRecipe({
        ...recipe,
        placement: { target: { kind: 'point', x: 120, y: 240 } }
      })
    ).toMatchObject({ placement: { target: { kind: 'point', x: 120, y: 240 } } })
    expect(
      normalizeFreshContextRecipe({
        ...recipe,
        placement: { target: { height: 600, kind: 'region', width: 800, x: 0, y: 0 } }
      })
    ).toMatchObject({ placement: { target: { kind: 'region', width: 800 } } })
    expect(() =>
      normalizeFreshContextRecipe(
        { ...recipe, placement: { target: { kind: 'point', x: 10, y: 20 } } },
        true
      )
    ).toThrow('--auto-place cannot be combined with a non-auto recipe.placement target')
    expect(
      normalizeFreshContextRecipe(
        { ...recipe, placement: { target: { kind: 'auto' } }, width: 600 },
        true
      )
    ).toMatchObject({ placement: { target: { kind: 'auto' } }, width: 600 })
    const diagramRewrite = {
      kind: 'native_diagram',
      owner_id: '0:42',
      source: 'flowchart LR\n  A --> B',
      source_format: 'mermaid'
    }
    expect(normalizeFreshContextRecipe(diagramRewrite)).toEqual(diagramRewrite)
    expect(() => normalizeFreshContextRecipe(diagramRewrite, true)).toThrow(
      '--auto-place is not used for native_diagram'
    )

    expect(
      normalizeFreshContextRecipe({
        kind: 'native_text',
        placement: {
          clearance: 32,
          preferred_directions: ['below', 'right', 'left', 'above']
        },
        text: 'Owner handoff happens before launch.'
      })
    ).toMatchObject({ kind: 'native_text', placement: { clearance: 32 } })
    expect(
      normalizeFreshContextRecipe({ kind: 'native_text', text: 'Auto-placed field note' }, true)
    ).toEqual({
      kind: 'native_text',
      placement: { target: { kind: 'auto' } },
      text: 'Auto-placed field note'
    })
    expect(() =>
      normalizeFreshContextRecipe(
        {
          kind: 'native_text',
          placement: { target: { kind: 'point', x: 10, y: 20 } },
          text: 'Already placed'
        },
        true
      )
    ).toThrow('--auto-place cannot be combined with a non-auto recipe.placement target')
    expect(
      normalizeFreshContextRecipe({
        kind: 'native_text',
        placement: { preferred_directions: ['below'] },
        text: 'One preferred direction'
      })
    ).toMatchObject({
      placement: { preferred_directions: ['below', 'right', 'left', 'above'] }
    })

    const codeObject = {
      initial_state: { count: 0 },
      kind: 'code_object',
      name: 'Counter',
      object_key: 'counter',
      operation: 'create',
      props: {},
      source: 'export default function Counter() { return <main>0</main> }',
      source_format: 'tsx'
    }
    expect(normalizeFreshContextRecipe(codeObject, true)).toMatchObject({
      placement: { target: { kind: 'auto' } }
    })
    expect(
      normalizeFreshContextRecipe({
        ...codeObject,
        placement: { target: { kind: 'point', x: 320, y: 240 } }
      })
    ).toMatchObject({ placement: { target: { kind: 'point', x: 320, y: 240 } } })
  })

  test('keeps fresh context exclusive and fails closed without exact writer capability', async () => {
    for (const conflict of [
      { base: '{}' },
      { 'base-file': 'base.json' },
      { 'context-token': 'context:old' },
      { 'expected-revision': '12' }
    ]) {
      expect(() => exactFreshContextTarget({ ...exactTarget, ...conflict })).toThrow(
        '--fresh-context cannot be combined'
      )
    }
    expect(() =>
      exactFreshContextTarget({ ...exactTarget, 'content-document-id': undefined })
    ).toThrow('--content-document-id is required with --fresh-context')
    expect(exactFreshContextTarget({ ...exactTarget, 'anchor-id': 'node:selected' })).toEqual(
      exactRpcTarget
    )

    const calls: string[] = []
    const send: BoardBuildRpcSender = async (command) => {
      calls.push(command)
      return { result: { capabilities: ['read'] }, target: rpcTarget() }
    }
    await expect(
      buildWithFreshContext(
        exactFreshContextTarget(exactTarget),
        {
          intent: 'Create a card',
          recipe: {
            body: 'Unavailable',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'No writer'
          },
          request_id: 'request:no-writer'
        },
        { send }
      )
    ).rejects.toThrow('lacks writer board_build capability')
    expect(calls).toEqual(['board_context'])
  })

  test('loads one identity-only fresh-context target file without stale authority state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-target-'))
    try {
      const targetPath = join(directory, 'target.json')
      await writeFile(
        targetPath,
        JSON.stringify({
          content_document_id: 'content-document:1',
          document_id: 'document:1',
          page_id: 'page:1',
          runtime_instance_id: 'local-authority:workspace:1',
          workspace_id: 'workspace:1'
        })
      )
      await expect(exactFreshContextTargetSource({ 'target-file': targetPath })).resolves.toEqual({
        content_document_id: 'content-document:1',
        document_id: 'document:1',
        page_id: 'page:1',
        runtime_instance_id: 'local-authority:workspace:1',
        workspace_id: 'workspace:1'
      })

      await writeFile(
        targetPath,
        JSON.stringify({
          target: {
            contentDocumentId: 'content-document:1',
            documentId: 'document:1',
            pageId: 'page:1',
            runtimeInstanceId: 'runtime:1',
            workspaceId: 'workspace:1'
          }
        })
      )
      await expect(exactFreshContextTargetSource({ 'target-file': targetPath })).resolves.toEqual(
        exactRpcTarget
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('accepts a target file with all identical flattened exact target flags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-target-identical-'))
    try {
      const targetPath = join(directory, 'target.json')
      await writeFile(targetPath, JSON.stringify(exactRpcTarget))
      await expect(
        exactFreshContextTargetSource({ ...exactTarget, 'target-file': targetPath })
      ).resolves.toEqual(exactRpcTarget)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('accepts a target file with a partial identical flattened exact target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-target-partial-'))
    try {
      const targetPath = join(directory, 'target.json')
      await writeFile(targetPath, JSON.stringify(exactRpcTarget))
      await expect(
        exactFreshContextTargetSource({
          'page-id': exactTarget['page-id'],
          'target-file': targetPath,
          'workspace-id': exactTarget['workspace-id']
        })
      ).resolves.toEqual(exactRpcTarget)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('rejects a target file when any flattened exact target flag differs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-target-mismatch-'))
    try {
      const targetPath = join(directory, 'target.json')
      await writeFile(targetPath, JSON.stringify(exactRpcTarget))
      await expect(
        exactFreshContextTargetSource({
          'page-id': 'page:wrong',
          'target-file': targetPath,
          'workspace-id': exactTarget['workspace-id']
        })
      ).rejects.toThrow('--target-file target does not match --page-id')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('rejects mixed, incomplete, stale, and conflicting target files locally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-board-target-invalid-'))
    try {
      const targetPath = join(directory, 'target.json')
      for (const invalidTarget of [
        { ...exactRpcTarget, boardRevision: 12 },
        { ...exactRpcTarget, workspaceId: 'workspace:wrong' },
        {
          contentDocumentId: 'content-document:1',
          documentId: 'document:1',
          runtimeInstanceId: 'runtime:1',
          workspaceId: 'workspace:1'
        }
      ]) {
        await writeFile(targetPath, JSON.stringify(invalidTarget))
        await expect(exactFreshContextTargetSource({ 'target-file': targetPath })).rejects.toThrow(
          'must contain exactly'
        )
      }
      await writeFile(targetPath, JSON.stringify(exactRpcTarget))
      await expect(
        exactFreshContextTargetSource({
          'target-file': targetPath,
          'workspace-id': 'workspace:wrong'
        })
      ).rejects.toThrow('--target-file target does not match --workspace-id')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('refuses non-self-contained and adversarial logical payloads before any RPC', async () => {
    const calls: string[] = []
    const send: BoardBuildRpcSender = async (command) => {
      calls.push(command)
      throw new Error('RPC must not run')
    }

    await expect(
      buildWithFreshContext(
        exactFreshContextTarget(exactTarget),
        {
          intent: 'Create a selected note',
          recipe: { kind: 'native_text', text: 'Needs context inspection' },
          request_id: 'request:needs-anchor'
        },
        { send }
      )
    ).rejects.toThrow(
      'native_text requires --auto-place, --relative-to-name, anchor_id, or recipe.placement.target'
    )
    expect(calls).toEqual([])

    await expect(
      buildWithFreshContext(
        exactFreshContextTarget(exactTarget),
        {
          intent: 'Missing placement',
          recipe: { body: 'No implicit target', kind: 'native_card', title: 'Refuse' },
          request_id: 'request:missing-placement'
        },
        { send }
      )
    ).rejects.toThrow('requires explicit recipe.placement.target')
    expect(calls).toEqual([])

    await expect(
      buildWithFreshContext(
        exactFreshContextTarget(exactTarget),
        {
          base: { context_token: 'attacker' },
          intent: 'Override authority',
          recipe: {
            body: 'No override',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Adversarial'
          },
          request_id: 'request:adversarial'
        } as never,
        { send }
      )
    ).rejects.toThrow('unexpected or authority fields: base')
    expect(calls).toEqual([])
  })

  test('stops after context when target and atomic-base revisions disagree', async () => {
    const calls: string[] = []
    const send: BoardBuildRpcSender = async (command) => {
      calls.push(command)
      return {
        result: {
          board_build_base: {
            ...exactRpcTarget,
            context_token: 'context:fresh',
            contract: 'board-build/v1',
            expected_revision: 13
          }
        },
        target: rpcTarget()
      }
    }

    await expect(
      buildWithFreshContext(
        exactFreshContextTarget(exactTarget),
        {
          intent: 'Create a card',
          recipe: {
            body: 'Stale context',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Refuse'
          },
          request_id: 'request:stale-context'
        },
        { send }
      )
    ).rejects.toThrow('target revision does not match board_build_base.expected_revision')
    expect(calls).toEqual(['board_context'])

    const invalidRevisionCalls: string[] = []
    const invalidRevisionSend: BoardBuildRpcSender = async (command) => {
      invalidRevisionCalls.push(command)
      return {
        result: {
          board_build_base: {
            ...exactRpcTarget,
            context_token: 'context:fresh',
            contract: 'board-build/v1',
            expected_revision: 12
          }
        },
        target: { ...rpcTarget(), boardRevision: 12.5 }
      }
    }
    await expect(
      buildWithFreshContext(
        exactFreshContextTarget(exactTarget),
        {
          intent: 'Create a card',
          recipe: {
            body: 'Invalid revision',
            kind: 'native_card',
            placement: { target: { kind: 'auto' } },
            title: 'Refuse'
          },
          request_id: 'request:invalid-revision'
        },
        { send: invalidRevisionSend }
      )
    ).rejects.toThrow('valid integer Board revision')
    expect(invalidRevisionCalls).toEqual(['board_context'])
  })

  test('maps bounded read, presentation, and verification requests', () => {
    expect(
      boardReadRpcArgs({
        ...exactTarget,
        'context-token': 'context:1',
        limit: '25',
        scope: 'page'
      })
    ).toMatchObject({ limit: 25, scope: 'page' })
    expect(parseBoardReadCliArgs({ 'object-ids': 'node:1, node:2' })).toEqual({
      object_ids: ['node:1', 'node:2'],
      scope: 'objects'
    })
    expect(
      parseBoardReadCliArgs({
        projection: 'summary',
        query: '{"name":"target","types":["FRAME"]}',
        sort: 'x',
        'token-budget': '1500'
      })
    ).toEqual({
      projection: 'summary',
      query: { name: 'target', types: ['FRAME'] },
      scope: 'query',
      sort: 'x',
      token_budget: 1_500
    })
    expect(() => parseBoardReadCliArgs({ projection: 'summary', scope: 'page' })).toThrow(
      'require query scope'
    )
    expect(() => parseBoardReadCliArgs({ 'object-ids': 'node:1,node:1' })).toThrow('unique IDs')
    expect(
      boardPresentRpcArgs({
        ...exactTarget,
        'context-token': 'context:1',
        'object-ids': 'node:1, node:2'
      })
    ).toMatchObject({ object_ids: ['node:1', 'node:2'] })
    expect(boardPresentLogicalRpcArgs({ 'object-ids': 'node:1, node:2' })).toEqual({
      object_ids: ['node:1', 'node:2']
    })
    expect(boardPresentFreshTarget(exactTarget)).toEqual({
      content_document_id: 'content-document:1',
      document_id: 'document:1',
      page_id: 'page:1',
      workspace_id: 'workspace:1'
    })
    expect(() => boardPresentLogicalRpcArgs({ 'object-ids': 'node:1,node:1' })).toThrow(
      'unique IDs'
    )
    expect(
      boardVerifyRpcArgs({
        ...exactTarget,
        'context-token': 'context:1',
        'request-id': 'request:1'
      })
    ).toMatchObject({ request_id: 'request:1' })
  })

  test('runs one exact read-only context and targeted read handshake', async () => {
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const ticks = [100, 102, 109]
    const execution = await readWithFreshContext(
      exactFreshContextTarget(exactTarget),
      { object_ids: ['node:1', 'node:2'], scope: 'objects' },
      {
        now: () => ticks.shift() ?? 109,
        send: async (command, args) => {
          calls.push({ args, command })
          if (command === 'board_context') {
            return {
              result: { context_token: 'context:read-fresh' },
              target: rpcTarget()
            }
          }
          return { result: { count: 4, nodes: [] }, target: rpcTarget() }
        }
      }
    )
    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_read'])
    expect(calls[1]).toMatchObject({
      args: {
        ...exactRpcTarget,
        context_token: 'context:read-fresh',
        object_ids: ['node:1', 'node:2'],
        scope: 'objects'
      }
    })
    expect(execution.handshake).toEqual({
      contract: 'board-read-fresh-context/v1',
      handshake_elapsed_ms: { board_context: 2, board_read: 7, total: 9 },
      semantic_rpc_calls: { board_context: 1, board_read: 1, total: 2 }
    })
    expect(boardCommand.subCommands?.read?.args?.['context-token']?.required).not.toBe(true)
  })

  test('runs one exact fresh-context group presentation handshake', async () => {
    expect(normalizeFreshBoardPresentLogical({ object_ids: ['node:1', 'node:2'] })).toEqual({
      object_ids: ['node:1', 'node:2']
    })
    const calls: Array<{ args: Record<string, unknown>; command: string }> = []
    const ticks = [100, 102.25, 108.5]
    const execution = await presentWithFreshContext(
      boardPresentFreshTarget(exactTarget),
      { object_ids: ['node:1', 'node:2'] },
      {
        now: () => ticks.shift() ?? 108.5,
        send: async (command, args) => {
          calls.push({ args, command })
          if (command === 'board_context') {
            return {
              result: {
                capabilities: ['board.present'],
                context_token: 'context:present-fresh'
              },
              target: rpcTarget()
            }
          }
          return {
            result: { presentation: { acknowledged: true } },
            target: rpcTarget()
          }
        }
      }
    )
    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_present'])
    expect(calls[0]).toEqual({
      args: {
        content_document_id: 'content-document:1',
        document_id: 'document:1',
        page_id: 'page:1',
        workspace_id: 'workspace:1'
      },
      command: 'board_context'
    })
    expect(calls[1]).toMatchObject({
      args: {
        ...exactRpcTarget,
        context_token: 'context:present-fresh',
        object_ids: ['node:1', 'node:2']
      }
    })
    expect(execution.handshake).toEqual({
      contract: 'board-present-fresh-context/v2',
      handshake_elapsed_ms: { board_context: 2.25, board_present: 6.25, total: 8.5 },
      semantic_rpc_calls: { board_context: 1, board_present: 1, total: 2 }
    })
    expect(boardCommand.subCommands?.present?.args?.['runtime-instance-id']?.required).not.toBe(
      true
    )
    expect(boardCommand.subCommands?.present?.args?.['fresh-context']?.description).toContain(
      'automatically'
    )
  })

  test('maps one guarded Object Graph connection with Trace attribution', () => {
    expect(
      boardConnectRpcArgs({
        ...exactTarget,
        automatic: false,
        'context-token': 'context:1',
        'expected-revision': '12',
        kind: 'visual',
        label: 'Trace flow',
        'request-id': 'request:connect',
        'source-id': 'node:source',
        'source-port': 'right',
        'target-id': 'node:target',
        'target-port': 'left',
        'trace-id': 'trace:connect'
      })
    ).toMatchObject({
      automatic: false,
      context_token: 'context:1',
      expected_revision: 12,
      kind: 'visual',
      label: 'Trace flow',
      page_id: 'page:1',
      request_id: 'request:connect',
      runtime_instance_id: 'runtime:1',
      source_id: 'node:source',
      source_port: 'right',
      target_id: 'node:target',
      target_port: 'left',
      trace_id: 'trace:connect',
      workspace_id: 'workspace:1'
    })
    const base = {
      content_document_id: 'content-document:1',
      context_token: 'context:1',
      document_id: 'document:1',
      expected_revision: 12,
      page_id: 'page:1',
      runtime_instance_id: 'runtime:1',
      workspace_id: 'workspace:1'
    }
    expect(
      boardConnectRpcArgs({
        base: JSON.stringify(base),
        kind: 'visual',
        'request-id': 'request:packet-connect',
        'source-id': 'node:source',
        'target-id': 'node:target'
      })
    ).toMatchObject({ base, request_id: 'request:packet-connect' })
  })

  test('requires explicit automatic behavior for executable connection kinds', () => {
    const connection = {
      ...exactTarget,
      'context-token': 'context:1',
      'expected-revision': '12',
      'request-id': 'request:connect',
      'source-id': 'node:source',
      'target-id': 'node:target'
    }

    expect(boardConnectRpcArgs({ ...connection, kind: 'visual' })).not.toHaveProperty('automatic')
    expect(() => boardConnectRpcArgs({ ...connection, automatic: true, kind: 'visual' })).toThrow(
      'Visual connections cannot use --automatic'
    )
    for (const kind of ['data', 'action']) {
      expect(() => boardConnectRpcArgs({ ...connection, kind })).toThrow(
        'require --automatic or --no-automatic explicitly'
      )
      expect(boardConnectRpcArgs({ ...connection, automatic: false, kind })).toMatchObject({
        automatic: false,
        kind
      })
      expect(boardConnectRpcArgs({ ...connection, automatic: true, kind })).toMatchObject({
        automatic: true,
        kind
      })
    }
  })

  test('requires the runtime pin and rejects invalid revisions', () => {
    expect(() =>
      boardReadRpcArgs({
        'content-document-id': 'content-document:1',
        'context-token': 'context:1',
        'document-id': 'document:1',
        'page-id': 'page:1',
        'workspace-id': 'workspace:1'
      })
    ).toThrow('runtime-instance-id')
    expect(() =>
      boardReadRpcArgs({
        'context-token': 'context:1',
        'document-id': 'document:1',
        'page-id': 'page:1',
        'runtime-instance-id': 'runtime:1',
        'workspace-id': 'workspace:1'
      })
    ).toThrow('content-document-id')
    expect(() =>
      boardReadRpcArgs({
        'content-document-id': 'content-document:1',
        'context-token': 'context:1',
        'page-id': 'page:1',
        'runtime-instance-id': 'runtime:1',
        'workspace-id': 'workspace:1'
      })
    ).toThrow('document-id')
    expect(() =>
      boardReadRpcArgs({
        'content-document-id': 'content-document:1',
        'context-token': 'context:1',
        'document-id': 'document:1',
        'page-id': 'page:1',
        'runtime-instance-id': 'runtime:1'
      })
    ).toThrow('workspace-id')
  })
})
