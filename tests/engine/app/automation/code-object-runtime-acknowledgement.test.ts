import { afterEach, describe, expect, test } from 'bun:test'

import { buildPersistentCodeObject } from '@/app/automation/bridge/board-build/code-object'
import type {
  BoardBuildInput,
  CodeObjectCreateBuildRecipe,
  CodeObjectRefineBuildRecipe
} from '@/app/automation/bridge/board-build/types'
import {
  createAutomationCodeObjectCreateHandler,
  createAutomationCodeObjectRefineHandler,
  type AutomationCodeObjectCreateArgs,
  type AutomationCodeObjectRefineArgs
} from '@/app/automation/bridge/code-object-handler'
import { codeObjectSourceHash } from '@/app/automation/bridge/code-object/source'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  acknowledgeCodeObjectRuntimeMount,
  acknowledgeCodeObjectRuntimeRender,
  beginCodeObjectRuntimeRender,
  clearCodeObjectRuntimeRender,
  currentCodeObjectRuntimeRenderGeneration,
  waitForCodeObjectRuntimeRender
} from '@/app/code-object/compiler'
import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

const ACKNOWLEDGEMENT_FRAME_ID = 'frame:runtime-acknowledgement'

function targetWithAnchor(): { anchorId: string; target: AutomationTarget } {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  if (!page) throw new Error('Missing test page.')
  const anchorId = store.createShape('RECTANGLE', 100, 100, 160, 120, pageId)
  store.select([anchorId])
  store.undo.clear()
  return {
    anchorId,
    target: {
      documentId: 'document:runtime-acknowledgement',
      documentName: 'Runtime acknowledgement',
      pageId,
      pageName: page.name,
      store
    }
  }
}

function createArgs(target: AutomationTarget, anchorId: string): AutomationCodeObjectCreateArgs {
  return {
    anchor_id: anchorId,
    height: 520,
    mutation: {
      expected_revision: target.store.state.sceneVersion,
      request_id: 'request:render-throwing-code-object'
    },
    name: 'Render-throwing Code Object',
    object_key: 'render-throwing-code-object',
    persist: false,
    placement: {
      clearance: 48,
      preferred_directions: ['right', 'below', 'left', 'above']
    },
    props: {},
    source:
      'export default function RenderCrash() { throw new Error("Readiness cockpit render crash") }',
    state: {},
    width: 720,
    zoom: false
  }
}

async function propsRefinementFixture(requestId: string): Promise<{
  args: AutomationCodeObjectRefineArgs
  ownerId: string
  target: AutomationTarget
}> {
  const fixture = targetWithAnchor()
  const source =
    'export default function PropsOnly({ props }) { return <main>{String(props.title)}</main> }'
  const create = createAutomationCodeObjectCreateHandler()
  const created = await create(fixture.target, {
    ...createArgs(fixture.target, fixture.anchorId),
    object_key: `props-only-${requestId}`,
    source
  })
  fixture.target.store.select([created.owner_id])
  fixture.target.store.undo.clear()
  return {
    args: {
      expected_source_hash: await codeObjectSourceHash(source),
      mutation: {
        expected_revision: fixture.target.store.state.sceneVersion,
        request_id: requestId
      },
      object_key: `props-only-${requestId}`,
      owner_id: created.owner_id,
      persist: false,
      props: { title: 'Refined with the same source' },
      source,
      zoom: false
    },
    ownerId: created.owner_id,
    target: fixture.target
  }
}

afterEach(() => {
  clearCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID)
  Reflect.deleteProperty(globalThis, 'document')
})

describe('Code Object runtime acknowledgement', () => {
  test('ignores stale same-source generations and accepts the current render only', async () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({}) }
    })
    const source = 'export default function Stable() { return <main>Stable</main> }'
    const firstGeneration = beginCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source, true)
    acknowledgeCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, firstGeneration, source)
    const secondGeneration = beginCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source, true)
    expect(secondGeneration).toBeGreaterThan(firstGeneration)
    expect(currentCodeObjectRuntimeRenderGeneration(ACKNOWLEDGEMENT_FRAME_ID)).toBe(
      secondGeneration
    )
    const current = waitForCodeObjectRuntimeRender(
      ACKNOWLEDGEMENT_FRAME_ID,
      source,
      firstGeneration
    )

    acknowledgeCodeObjectRuntimeRender(
      ACKNOWLEDGEMENT_FRAME_ID,
      firstGeneration,
      source,
      'stale render crash'
    )
    acknowledgeCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, secondGeneration, source)
    expect(await current).toEqual({
      generation: secondGeneration,
      mounted: true,
      status: 'rendered'
    })

    acknowledgeCodeObjectRuntimeRender(
      ACKNOWLEDGEMENT_FRAME_ID,
      secondGeneration,
      source,
      'later render crash'
    )
    expect(await waitForCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source)).toEqual({
      error: 'later render crash',
      generation: secondGeneration,
      mounted: true,
      status: 'error'
    })
  })

  test('acknowledges both attach-before-render and render-before-attach order', async () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({}) }
    })
    const source = 'export default function Mounted() { return <main>Mounted</main> }'

    const attachedGeneration = beginCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source, true)
    acknowledgeCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, attachedGeneration, source)
    expect(await waitForCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source)).toEqual({
      generation: attachedGeneration,
      mounted: true,
      status: 'rendered'
    })

    clearCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID)
    const renderedGeneration = beginCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source, false)
    expect(renderedGeneration).toBeGreaterThan(attachedGeneration)
    acknowledgeCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, renderedGeneration, source)
    const pending = waitForCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source)
    acknowledgeCodeObjectRuntimeMount(ACKNOWLEDGEMENT_FRAME_ID, true)
    expect(await pending).toEqual({
      generation: renderedGeneration,
      mounted: true,
      status: 'rendered'
    })
  })

  test('reports the existing mounted runtime render-error signal', async () => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => ({}) }
    })
    const source = 'export default function Crash() { throw new Error("render crash") }'
    const generation = beginCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source)
    acknowledgeCodeObjectRuntimeMount(ACKNOWLEDGEMENT_FRAME_ID, true)
    acknowledgeCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, generation, source, 'render crash')

    expect(await waitForCodeObjectRuntimeRender(ACKNOWLEDGEMENT_FRAME_ID, source)).toEqual({
      error: 'render crash',
      generation,
      mounted: true,
      status: 'error'
    })
  })

  test('keeps an applied create receipt and owner when runtime rendering fails', async () => {
    const fixture = targetWithAnchor()
    const create = createAutomationCodeObjectCreateHandler({
      waitForRuntimeRender: () =>
        Promise.resolve({
          error: 'Readiness cockpit render crash',
          generation: 1,
          mounted: true,
          status: 'error'
        })
    })
    const args = createArgs(fixture.target, fixture.anchorId)

    const created = await create(fixture.target, args)

    expect(created).toMatchObject({
      proof: {
        error: 'Readiness cockpit render crash',
        reason: 'runtime_render_failed',
        stage: 'runtime_render',
        status: 'error'
      },
      readback: {
        code_object: {
          reconciliation: {
            reasons: ['runtime_render_failed'],
            status: 'diverged'
          },
          runtime: {
            error: 'Readiness cockpit render crash',
            mounted: true,
            status: 'error'
          }
        }
      },
      receipt: {
        idempotent_replay: false,
        status: 'applied'
      },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'runtime_render_failed'
      }
    })
    expect(fixture.target.store.graph.getNode(created.owner_id)?.type).toBe('FRAME')
    expect(codeObjectDocument(fixture.target.store.graph.getNode(created.owner_id))?.source).toBe(
      args.source
    )
    expect(fixture.target.store.undo.undoLabel).toBe('Create code object')

    const replayed = await create(fixture.target, args)
    expect(replayed).toMatchObject({
      owner_id: created.owner_id,
      receipt: { historical_only: false, idempotent_replay: true },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'runtime_render_failed'
      }
    })
    expect(
      fixture.target.store.graph
        .getChildren(fixture.target.pageId)
        .filter((node) => codeObjectDocument(node)?.definitionId === 'render-throwing-code-object')
    ).toHaveLength(1)
  })

  test('does not let the general builder overwrite a semantic runtime failure', async () => {
    const fixture = targetWithAnchor()
    const recipe: CodeObjectCreateBuildRecipe = {
      initialState: {},
      kind: 'code_object',
      name: 'Render-throwing Code Object',
      objectKey: 'render-throwing-code-object',
      operation: 'create',
      props: {},
      source:
        'export default function RenderCrash() { throw new Error("Readiness cockpit render crash") }',
      sourceFormat: 'tsx'
    }
    const input: BoardBuildInput = {
      anchorId: fixture.anchorId,
      contextToken: 'context:runtime-acknowledgement',
      expectedRevision: fixture.target.store.state.sceneVersion,
      intent: 'Prove a render failure stays explicit',
      recipe,
      requestId: 'request:builder-render-throwing-code-object'
    }
    let postFailureProofCalls = 0

    const result = await buildPersistentCodeObject(
      {
        context: () => {
          postFailureProofCalls += 1
          return Promise.reject(new Error('Unexpected context proof.'))
        },
        create: () =>
          Promise.resolve({
            next_action: { command: 'board_verify' },
            owner_id: 'frame:applied-render-failure',
            proof: {
              error: 'Readiness cockpit render crash',
              reason: 'runtime_render_failed',
              stage: 'runtime_render',
              status: 'error'
            },
            readback: {
              code_object: {
                reconciliation: {
                  reasons: ['runtime_render_failed'],
                  status: 'diverged'
                }
              }
            },
            receipt: { requestId: input.requestId, status: 'applied' },
            status: {
              attention_required: true,
              command: 'unavailable',
              mutation: 'applied',
              reason: 'runtime_render_failed'
            }
          }),
        persist: (_store, requestedSceneRevision) =>
          Promise.resolve({
            duration_ms: 1,
            requested_scene_revision: requestedSceneRevision,
            status: 'durable',
            target: 'browser_local'
          }),
        present: () => {
          postFailureProofCalls += 1
          return Promise.reject(new Error('Unexpected presentation proof.'))
        },
        read: () => {
          postFailureProofCalls += 1
          return Promise.reject(new Error('Unexpected owner read.'))
        }
      },
      fixture.target,
      input,
      recipe
    )

    expect(result).toMatchObject({
      build: { route: { id: 'code-object/tsx-create/v1' } },
      persistence: { status: 'durable' },
      proof: {
        error: 'Readiness cockpit render crash',
        reason: 'runtime_render_failed',
        stage: 'runtime_render',
        status: 'error'
      },
      receipt: { requestId: input.requestId, status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'runtime_render_failed'
      }
    })
    expect(postFailureProofCalls).toBe(0)
  })

  test('does not let the general builder overwrite a refinement runtime failure', async () => {
    const fixture = targetWithAnchor()
    const recipe: CodeObjectRefineBuildRecipe = {
      expectedSourceHash: `sha256:${'1'.repeat(64)}`,
      kind: 'code_object',
      objectKey: 'refined-render-failure',
      operation: 'refine',
      ownerId: 'frame:refined-render-failure',
      source: 'export default function RefinedCrash() { throw new Error("refined crash") }',
      sourceFormat: 'tsx'
    }
    const input: BoardBuildInput = {
      contextToken: 'context:refined-runtime-acknowledgement',
      expectedRevision: fixture.target.store.state.sceneVersion,
      intent: 'Keep a refinement render failure explicit',
      recipe,
      requestId: 'request:builder-refined-render-failure'
    }
    let postFailureProofCalls = 0

    const result = await buildPersistentCodeObject(
      {
        context: () => {
          postFailureProofCalls += 1
          return Promise.reject(new Error('Unexpected context proof.'))
        },
        persist: (_store, requestedSceneRevision) =>
          Promise.resolve({
            duration_ms: 1,
            requested_scene_revision: requestedSceneRevision,
            status: 'durable',
            target: 'browser_local'
          }),
        present: () => {
          postFailureProofCalls += 1
          return Promise.reject(new Error('Unexpected presentation proof.'))
        },
        read: () => {
          postFailureProofCalls += 1
          return Promise.reject(new Error('Unexpected owner read.'))
        },
        refine: () =>
          Promise.resolve({
            next_action: { command: 'board_verify' },
            owner_id: recipe.ownerId,
            preservation: {
              board_permissions: true,
              geometry: true,
              legacy_connections: true,
              object_graph_connections: true,
              other_plugin_data: true,
              state: true
            },
            proof: {
              error: 'refined crash',
              reason: 'runtime_render_failed',
              stage: 'runtime_render',
              status: 'error'
            },
            receipt: { requestId: input.requestId, status: 'applied' },
            status: {
              attention_required: true,
              command: 'unavailable',
              mutation: 'applied',
              reason: 'runtime_render_failed'
            }
          })
      },
      fixture.target,
      input,
      recipe
    )

    expect(result).toMatchObject({
      build: { route: { id: 'code-object/tsx-refine/v1' } },
      persistence: { status: 'durable' },
      proof: {
        error: 'refined crash',
        reason: 'runtime_render_failed',
        stage: 'runtime_render',
        status: 'error'
      },
      receipt: { requestId: input.requestId, status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'runtime_render_failed'
      }
    })
    expect(postFailureProofCalls).toBe(0)
  })

  test('requires a newer generation for props-only refinement and replays from current proof', async () => {
    const fixture = await propsRefinementFixture('request:props-only-generation-success')
    const observedBaselines: Array<number | undefined> = []
    const refine = createAutomationCodeObjectRefineHandler({
      currentRuntimeGeneration: () => 41,
      waitForRuntimeRender: (_frameId, _source, afterGeneration) => {
        observedBaselines.push(afterGeneration)
        return Promise.resolve({ generation: 42, mounted: true, status: 'rendered' })
      }
    })

    const refined = await refine(fixture.target, fixture.args)
    expect(refined).toMatchObject({
      owner_id: fixture.ownerId,
      readback: {
        code_object: {
          component: { props: { title: 'Refined with the same source' } },
          reconciliation: { reasons: [], status: 'current' },
          runtime: { generation: 42, mounted: true, status: 'rendered' }
        }
      },
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
    expect(observedBaselines).toEqual([41])
    expect(fixture.target.store.undo.undoLabel).toBe('Refine code object')

    const replayed = await refine(fixture.target, fixture.args)
    expect(replayed).toMatchObject({
      owner_id: fixture.ownerId,
      receipt: { historical_only: false, idempotent_replay: true },
      status: { attention_required: false, command: 'completed', mutation: 'replayed' }
    })
    expect(observedBaselines).toEqual([41, undefined])
  })

  test('keeps props-only refinement applied when its newer generation renders an error', async () => {
    const fixture = await propsRefinementFixture('request:props-only-generation-error')
    const refine = createAutomationCodeObjectRefineHandler({
      currentRuntimeGeneration: () => 7,
      waitForRuntimeRender: (_frameId, _source, afterGeneration) => {
        expect(afterGeneration).toBe(7)
        return Promise.resolve({
          error: 'Props-only render crash',
          generation: 8,
          mounted: true,
          status: 'error'
        })
      }
    })

    const refined = await refine(fixture.target, fixture.args)
    expect(refined).toMatchObject({
      owner_id: fixture.ownerId,
      proof: {
        error: 'Props-only render crash',
        reason: 'runtime_render_failed',
        stage: 'runtime_render',
        status: 'error'
      },
      receipt: { idempotent_replay: false, status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'runtime_render_failed'
      }
    })
    expect(codeObjectDocument(fixture.target.store.graph.getNode(fixture.ownerId))?.props).toEqual({
      title: 'Refined with the same source'
    })
    expect(fixture.target.store.undo.undoLabel).toBe('Refine code object')
  })

  test('accepts current runtime proof for a true no-change refinement', async () => {
    const fixture = await propsRefinementFixture('request:props-only-no-change-setup')
    const apply = createAutomationCodeObjectRefineHandler({
      currentRuntimeGeneration: () => 2,
      waitForRuntimeRender: () =>
        Promise.resolve({ generation: 3, mounted: true, status: 'rendered' })
    })
    await apply(fixture.target, fixture.args)
    fixture.target.store.undo.clear()
    let generationReads = 0
    let observedAfterGeneration: number | undefined = -1
    const noChange = createAutomationCodeObjectRefineHandler({
      currentRuntimeGeneration: () => {
        generationReads += 1
        return 3
      },
      waitForRuntimeRender: (_frameId, _source, afterGeneration) => {
        observedAfterGeneration = afterGeneration
        return Promise.resolve({ generation: 3, mounted: true, status: 'rendered' })
      }
    })
    const result = await noChange(fixture.target, {
      ...fixture.args,
      mutation: {
        expected_revision: fixture.target.store.state.sceneVersion,
        request_id: 'request:props-only-no-change'
      }
    })

    expect(result).toMatchObject({
      receipt: { no_history: true, outcome: 'no_change' },
      status: { attention_required: false, command: 'completed', mutation: 'no_change' }
    })
    expect(generationReads).toBe(0)
    expect(observedAfterGeneration).toBeUndefined()
    expect(fixture.target.store.undo.canUndo).toBe(false)
  })
})
