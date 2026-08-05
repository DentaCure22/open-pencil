import { describe, expect, test } from 'bun:test'

import { buildWithFreshContext, exactFreshContextTarget } from '#cli/board-build/fresh-context'
import {
  boardBuildReleaseEnvelope,
  boardBuildReleaseSummary,
  withBoardBuildReleaseSummary
} from '#cli/board-build/release'

const target = {
  boardRevision: 42,
  contentDocumentId: 'content:1',
  documentId: 'tab:1',
  documentName: 'Product work',
  pageId: 'page:1',
  pageName: 'Launch map',
  runtimeInstanceId: 'runtime:1',
  workspaceId: 'workspace:1'
}

describe('straight-through Board build release', () => {
  test('returns one deterministic final from the durable receipt and built-in readback', () => {
    const result = {
      owner_ids: { brief: 'node:1', control: 'node:2' },
      persistence: {
        authority_id: 'authority:1',
        authority_revision: 42,
        status: 'durable'
      },
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      proof: {
        durable_readback: 'passed',
        normal_editor_undo: 'unavailable',
        pixels: 'not_evaluated'
      },
      readback: { nodes: [{ id: 'node:1' }, { id: 'node:2' }] },
      receipt: {
        appliedRevision: 42,
        connection_ids: ['connection:1'],
        requestId: 'request:1',
        status: 'applied'
      },
      status: { attention_required: false, command: 'completed', mutation: 'applied' },
      timing: { total_ms: 120 }
    }

    const first = boardBuildReleaseSummary(result, target)
    const second = boardBuildReleaseSummary(result, target)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      artifact_count: 2,
      connection_count: 1,
      contract: 'board-build-release/v1',
      next_build_target: {
        content_document_id: 'content:1',
        document_id: 'tab:1',
        page_id: 'page:1',
        runtime_instance_id: 'local-authority:authority:1',
        workspace_id: 'workspace:1'
      },
      request_id: 'request:1',
      revision: 42,
      status: 'ready',
      target: {
        content_document_id: 'content:1',
        document_id: 'tab:1',
        page_id: 'page:1',
        runtime_instance_id: 'runtime:1',
        workspace_id: 'workspace:1'
      }
    })
    expect(first.message).toContain('2 artifacts and 1 connection at revision 42')
    expect(first.proof_limitations).toEqual([])
    expect(first).not.toHaveProperty('timing')
    expect(first).not.toHaveProperty('callback')
  })

  test('adds the releasable final without a post-durable RPC or callback', async () => {
    const commands: string[] = []
    const execution = await buildWithFreshContext(
      exactFreshContextTarget({
        'content-document-id': 'content:1',
        'document-id': 'tab:1',
        'page-id': 'page:1',
        'runtime-instance-id': 'runtime:1',
        'workspace-id': 'workspace:1'
      }),
      {
        intent: 'Create one card',
        recipe: {
          body: 'The receipt is the finalization input.',
          kind: 'native_card',
          placement: { target: { kind: 'auto' } },
          title: 'Straight through'
        },
        request_id: 'request:straight-through'
      },
      {
        send: async (command) => {
          commands.push(command)
          if (command === 'board_context') {
            return {
              result: {
                board_build_base: {
                  content_document_id: 'content:1',
                  context_token: 'context:1',
                  contract: 'board-build/v1',
                  document_id: 'tab:1',
                  expected_revision: 41,
                  page_id: 'page:1',
                  runtime_instance_id: 'runtime:1',
                  workspace_id: 'workspace:1'
                }
              },
              target: { ...target, boardRevision: 41 }
            }
          }
          return {
            result: {
              owner_id: 'node:1',
              persistence: { status: 'durable', target: 'browser_local' },
              readback: { card: { id: 'node:1' } },
              receipt: { appliedRevision: 42, requestId: 'request:straight-through' },
              status: { command: 'completed', mutation: 'applied' }
            },
            target
          }
        }
      }
    )
    const output = withBoardBuildReleaseSummary(
      execution.response.result,
      execution.response.target
    )

    expect(commands).toEqual(['board_context', 'board_build'])
    expect(output.release_summary.status).toBe('ready')
    expect(output.release_summary.message).toContain('1 artifact and 0 connections')
  })

  test('preserves authority commit ownership in the compact release envelope', () => {
    const compact = boardBuildReleaseEnvelope(
      {
        owner_id: 'node:authority-card',
        persistence: {
          authority_id: 'authority:1',
          authority_revision: 42,
          status: 'durable'
        },
        proof: { durable_readback: 'passed' },
        readback: { card: { owner: { id: 'node:authority-card' } } },
        receipt: {
          appliedRevision: 42,
          requestId: 'request:authority-card',
          status: 'committed'
        },
        status: { command: 'completed', mutation: 'applied' }
      },
      target
    )

    expect(compact).toMatchObject({
      next_build_target: {
        content_document_id: 'content:1',
        document_id: 'tab:1',
        page_id: 'page:1',
        runtime_instance_id: 'local-authority:authority:1',
        workspace_id: 'workspace:1'
      },
      receipt: {
        owner_ids: { artifact: 'node:authority-card' },
        requestId: 'request:authority-card',
        status: 'committed'
      },
      release_summary: {
        artifact_count: 1,
        request_id: 'request:authority-card',
        status: 'ready'
      }
    })
  })

  test('keeps persisted target identities distinct across release continuation', () => {
    const compact = boardBuildReleaseEnvelope(
      {
        owner_id: 'node:distinct-target',
        persistence: {
          authority_id: 'authority:distinct',
          authority_revision: 42,
          status: 'durable'
        },
        readback: { card: { id: 'node:distinct-target' } },
        receipt: {
          appliedRevision: 42,
          requestId: 'request:distinct-target',
          status: 'committed'
        },
        status: { command: 'completed', mutation: 'applied' }
      },
      {
        ...target,
        contentDocumentId: 'content:distinct',
        documentId: 'document:distinct',
        pageId: 'page:distinct',
        workspaceId: 'workspace:distinct'
      }
    )

    expect(compact.next_build_target).toEqual({
      content_document_id: 'content:distinct',
      document_id: 'document:distinct',
      page_id: 'page:distinct',
      runtime_instance_id: 'local-authority:authority:distinct',
      workspace_id: 'workspace:distinct'
    })
    expect(compact.release_summary.next_build_target).toEqual(compact.next_build_target)
  })

  test('keeps an existing persisted-authority runtime exact for the next build', () => {
    const authorityTarget = {
      ...target,
      documentId: 'content:1',
      runtimeInstanceId: 'local-authority:authority:1'
    }
    const compact = boardBuildReleaseEnvelope(
      {
        owner_id: 'node:authority-card',
        persistence: {
          authority_id: 'local-authority:authority:1',
          authority_revision: 42,
          status: 'durable'
        },
        readback: { card: { id: 'node:authority-card' } },
        receipt: { appliedRevision: 42, requestId: 'request:authority', status: 'committed' },
        status: { command: 'completed', mutation: 'applied' }
      },
      authorityTarget
    )

    expect(compact.next_build_target).toEqual({
      content_document_id: 'content:1',
      document_id: 'content:1',
      page_id: 'page:1',
      runtime_instance_id: 'local-authority:authority:1',
      workspace_id: 'workspace:1'
    })
  })

  test('does not invent a next build target without persisted authority', () => {
    const compact = boardBuildReleaseEnvelope(
      {
        owner_id: 'node:browser-card',
        persistence: { authority_revision: 42, status: 'durable' },
        readback: { card: { id: 'node:browser-card' } },
        receipt: { appliedRevision: 42, requestId: 'request:browser', status: 'committed' },
        status: { command: 'completed', mutation: 'applied' }
      },
      target
    )

    expect(compact.next_build_target).toBeNull()
    expect(compact.release_summary.next_build_target).toBeNull()
  })

  test('keeps deterministic recipe compilation metadata in the compact envelope', () => {
    const recipeCompilation = {
      artifact_aliases: ['heading', 'card_01'],
      expanded_plan_digest: `sha256:${'a'.repeat(64)}`,
      recipe_id: 'structured_cards',
      recipe_version: 1,
      registry_version: 1
    }
    const intentCompilation = {
      capability_results: [
        {
          authority: 'none',
          capability_id: 'document_synthesis',
          effect: 'compute',
          provider_id: 'builtin.board-recipe.structured-cards'
        }
      ],
      contract: 'board-build-intent-compilation/v1',
      representation_plan: { dominant_representation: 'structured_brief' }
    }
    const compact = boardBuildReleaseEnvelope(
      {
        intent_compilation: intentCompilation,
        owner_ids: { card_01: 'node:card', heading: 'node:heading' },
        persistence: { authority_revision: 42, status: 'durable' },
        proof: { durable_readback: 'passed' },
        readback: { nodes: [{ id: 'node:heading' }, { id: 'node:card' }] },
        receipt: { appliedRevision: 42, requestId: 'request:recipe', status: 'committed' },
        recipe_compilation: recipeCompilation,
        status: { command: 'completed', mutation: 'applied' }
      },
      target
    )

    expect(compact.intent_compilation).toEqual(intentCompilation)
    expect(compact.recipe_compilation).toEqual(recipeCompilation)
    expect(compact.release_summary).toMatchObject({ artifact_count: 2, status: 'ready' })
  })

  test('compacts stdout only after deriving release truth from the full authoritative result', () => {
    const receipt = {
      appliedRevision: 42,
      baseRevision: 41,
      connection_ids: ['connection:1'],
      input_digest: 'sha256:receipt',
      owner_ids: { brief: 'node:1', control: 'node:2' },
      requestId: 'request:compact',
      status: 'applied'
    }
    const result = {
      context: {
        neighborhood: {
          nodes: Array.from({ length: 100 }, (_, index) => ({
            bounds: { height: 168, width: 320, x: index * 24, y: index * 16 },
            id: `context-node:${index}`,
            name: `Existing Board artifact ${index}`,
            type: 'FRAME',
            visible: true
          }))
        }
      },
      fresh_context_handshake: {
        handshake_elapsed_ms: { board_build: 80, board_context: 20, total: 100 },
        semantic_rpc_calls: { board_build: 1, board_context: 1, total: 2 }
      },
      owner_ids: receipt.owner_ids,
      persistence: { authority_revision: 42, content_hash: 'sha256:board', status: 'durable' },
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      proof: {
        durable_readback: 'passed',
        normal_editor_undo: 'unavailable',
        pixels: 'not_evaluated'
      },
      readback: {
        plan: {
          aliases: Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [
              `artifact-${index}`,
              {
                bounds: { height: 168, width: 320, x: index * 24, y: index * 16 },
                id: `node:${index}`,
                name: `Created Board artifact ${index}`,
                visible: true
              }
            ])
          )
        }
      },
      receipt,
      status: { attention_required: false, command: 'completed', mutation: 'applied' },
      timing: { commit_ms: 40, compile_ms: 20, readback_ms: 40, total_ms: 100 }
    }

    const compact = boardBuildReleaseEnvelope(result, target)
    const full = withBoardBuildReleaseSummary(result, target)

    expect(compact).toMatchObject({
      fresh_context_handshake: result.fresh_context_handshake,
      persistence: result.persistence,
      proof: { durable_readback: 'passed' },
      receipt,
      release_summary: {
        artifact_count: 2,
        connection_count: 1,
        request_id: 'request:compact',
        revision: 42,
        status: 'ready'
      },
      status: result.status,
      target: {
        content_document_id: 'content:1',
        document_id: 'tab:1',
        page_id: 'page:1',
        runtime_instance_id: 'runtime:1',
        workspace_id: 'workspace:1'
      },
      timing: result.timing
    })
    expect(compact.receipt).toEqual(receipt)
    expect(compact).not.toHaveProperty('context')
    expect(compact).not.toHaveProperty('readback')
    expect(compact).not.toHaveProperty('presentation')
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 2)
  })

  test('stops honestly when the builder conclusively refused before mutation', () => {
    const summary = boardBuildReleaseSummary(
      {
        receipt: { requestId: 'request:refused', status: 'rejected' },
        status: {
          attention_required: true,
          command: 'refused',
          mutation: 'not_applied',
          reason: 'no_collision_free_placement'
        }
      },
      target
    )

    expect(summary).toMatchObject({
      artifact_count: 0,
      connection_count: 0,
      request_id: 'request:refused',
      revision: 42,
      status: 'stop'
    })
    expect(summary.message).toContain('stopped without mutation')
    expect(summary.message).toContain('no_collision_free_placement')
  })

  test('treats a scoped pre-mutation validation failure as a terminal stop', () => {
    const summary = boardBuildReleaseSummary(
      {
        error: { message: '--plan-file must be a JSON object.' },
        failure_scope: 'pre_mutation',
        next_action: { request_id: 'request:invalid-plan', retry_mutation: false },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'not_applied',
          reason: 'board_command_failed'
        }
      },
      target
    )

    expect(summary).toMatchObject({
      artifact_count: 0,
      connection_count: 0,
      request_id: 'request:invalid-plan',
      status: 'stop'
    })
    expect(summary.message).toContain('stopped without mutation')
    expect(summary.message).not.toContain('Recover the same request ID')
  })

  test('keeps compact pre-mutation failures exact and terminal', () => {
    const result = {
      error: { code: 'board_command_failed', message: '--release-summary requires --json.' },
      failure_scope: 'pre_mutation',
      next_action: { request_id: 'request:compact-error', retry_mutation: false },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'not_applied',
        reason: 'board_command_failed'
      },
      target: {
        content_document_id: 'content:1',
        document_id: 'tab:1',
        page_id: 'page:1',
        runtime_instance_id: 'runtime:1',
        workspace_id: 'workspace:1'
      }
    }

    const compact = boardBuildReleaseEnvelope(result, undefined)

    expect(compact).toMatchObject({
      error: result.error,
      failure_scope: 'pre_mutation',
      next_action: result.next_action,
      persistence: null,
      proof: null,
      receipt: null,
      release_summary: {
        message: expect.stringContaining('--release-summary requires --json.'),
        request_id: 'request:compact-error',
        status: 'stop'
      },
      status: result.status,
      timing: null
    })
  })

  test('retains pre-mutation authority and Trace context without requiring proof', () => {
    const compact = boardBuildReleaseEnvelope(
      {
        current_revision: 42,
        error: { code: 'board_preflight_refused', message: 'Unsupported plan.' },
        failure_scope: 'pre_mutation',
        status: {
          attention_required: true,
          command: 'refused',
          mutation: 'not_applied',
          reason: 'board_preflight_refused'
        },
        trace: { gesture_id: 'gesture:42' }
      },
      target
    )

    expect(compact).toMatchObject({
      current_revision: 42,
      failure_scope: 'pre_mutation',
      proof: null,
      release_summary: {
        proof_limitations: [],
        revision: 42,
        status: 'stop',
        target: {
          content_document_id: 'content:1',
          document_id: 'tab:1',
          page_id: 'page:1',
          page_name: 'Launch map',
          runtime_instance_id: 'runtime:1',
          workspace_id: 'workspace:1'
        }
      },
      trace: { gesture_id: 'gesture:42' }
    })
    expect(JSON.stringify(compact)).not.toContain('unknown Board')
    expect(JSON.stringify(compact)).not.toContain('proof:not_reported')
  })

  test('does not claim success when persistence or readback is inconclusive', () => {
    const summary = boardBuildReleaseSummary(
      {
        owner_id: 'node:1',
        persistence: { status: 'unknown' },
        receipt: { requestId: 'request:unknown', status: 'applied' },
        status: { attention_required: true, command: 'unavailable', mutation: 'applied' }
      },
      target
    )

    expect(summary).toMatchObject({ artifact_count: 1, status: 'unknown' })
    expect(summary.message).toContain('do not claim success')
    expect(summary.message).toContain('Recover the same request ID')
  })

  test('does not turn an unavailable transport outcome into a no-mutation claim', () => {
    const summary = boardBuildReleaseSummary(
      {
        error: { message: 'RPC connection closed before a response.' },
        next_action: { request_id: 'request:transport' },
        status: { command: 'unavailable', mutation: 'not_applied' },
        target: {
          content_document_id: 'content:1',
          document_id: 'tab:1',
          page_id: 'page:1',
          runtime_instance_id: 'runtime:1',
          workspace_id: 'workspace:1'
        }
      },
      undefined
    )

    expect(summary).toMatchObject({
      request_id: 'request:transport',
      status: 'unknown',
      target: { page_id: 'page:1', workspace_id: 'workspace:1' }
    })
    expect(summary.message).toContain('do not claim success')
  })
})
