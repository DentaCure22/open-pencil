import { afterEach, describe, expect, test } from 'bun:test'

import { createMermaidSvgSpec, type MermaidDiagram } from '@open-pencil/core/diagram'

import { createAutomationBoardBuildHandler } from '@/app/automation/bridge/board-build'
import { parseBoardBuildInput } from '@/app/automation/bridge/board-build/parse'
import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import {
  createAutomationMermaidHandler,
  createAutomationMermaidSourceHandler
} from '@/app/automation/bridge/mermaid-handler'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const ANCHOR_ID = 'node:anchor'
const BOARD_REVISION = 7

type HandlerCall = {
  args: unknown
  target: AutomationTarget
}

type HarnessCalls = {
  changes: HandlerCall[]
  contexts: AutomationTarget[]
  mermaid: HandlerCall[]
  mermaidSources: HandlerCall[]
  persistence: number[]
  presentations: HandlerCall[]
  reads: HandlerCall[]
}

type HarnessOptions = {
  changeResult?: unknown
  contextError?: Error
  contextResult?: unknown
  mermaidResult?: unknown
  mermaidSourceError?: Error
  mermaidSourceResult?: unknown
  presentationError?: Error
  presentationResult?: unknown
  persistenceResult?: {
    duration_ms: number
    reason?: string
    requested_scene_revision: number
    status: 'durable' | 'unknown'
    target?: 'browser_local' | 'local_workspace_authority'
  }
  readResult?: unknown
}

function automationTarget(store = createEditorStore()): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    contentDocumentId: 'content-document:board-build',
    documentId: 'document-tab:board-build',
    documentName: 'Board build document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: 'runtime:board-build',
    store,
    workspaceId: 'workspace:board-build'
  }
}

function installBrowserFixture(): void {
  let frameId = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value(callback: FrameRequestCallback) {
      const id = ++frameId
      queueMicrotask(() => callback(performance.now()))
      return id
    }
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: () => undefined
  })
}

function mermaidFixture(source: string): Promise<MermaidDiagram> {
  return Promise.resolve(createMermaidSvgSpec(source, { appearance: 'light' }))
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'window')
})

function buildArgs(recipe: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    anchor_id: ANCHOR_ID,
    context_token: 'context:board-build',
    contract: 'board-build/v1',
    expected_revision: BOARD_REVISION,
    intent: 'Create one useful Board artifact',
    recipe,
    request_id: 'request:board-build',
    ...extra
  }
}

function createHarness(options: HarnessOptions = {}) {
  const calls: HarnessCalls = {
    changes: [],
    contexts: [],
    mermaid: [],
    mermaidSources: [],
    persistence: [],
    presentations: [],
    reads: []
  }
  const handler = createAutomationBoardBuildHandler({
    board: {
      async change(target, args) {
        calls.changes.push({ args, target })
        return (
          options.changeResult ?? {
            readback: { graph: { id: 'node:created-text', type: 'TEXT' } },
            receipt: { requestId: 'request:board-build', status: 'applied' },
            status: { attention_required: false, command: 'completed', mutation: 'applied' }
          }
        )
      },
      async context(target) {
        calls.contexts.push(target)
        if (options.contextError) throw options.contextError
        return options.contextResult ?? { context_token: 'context:fresh' }
      },
      async present(target, args) {
        calls.presentations.push({ args, target })
        if (options.presentationError) throw options.presentationError
        return (
          options.presentationResult ?? {
            presentation: {
              acknowledged: true,
              intersection: [],
              selected_ids: ['node:diagram-owner'],
              viewport: { pan_x: 0, pan_y: 0, zoom: 1 }
            },
            status: { command: 'completed', mutation: 'not_applicable' }
          }
        )
      },
      async read(target, args) {
        calls.reads.push({ args, target })
        return (
          options.readResult ?? {
            board_revision: BOARD_REVISION,
            nodes: [{ id: ANCHOR_ID }],
            scope: 'selection'
          }
        )
      }
    },
    canWrite: () => true,
    async mermaid(target, args) {
      calls.mermaid.push({ args, target })
      return (
        options.mermaidResult ?? {
          ok: true,
          result: {
            mutation_receipt: {
              idempotentReplay: false,
              requestId: 'request:board-build',
              status: 'applied'
            },
            owner_id: 'node:diagram-owner'
          }
        }
      )
    },
    async mermaidSource(target, args) {
      calls.mermaidSources.push({ args, target })
      if (options.mermaidSourceError) throw options.mermaidSourceError
      return (
        options.mermaidSourceResult ?? {
          ok: true,
          result: {
            bounds: { height: 160, width: 320, x: 240, y: 80 },
            editable_layers: 5,
            node_ids: ['node:diagram-part'],
            owner_id: 'node:diagram-owner',
            reconciliation: { message: 'Current', revision: 1, status: 'current' },
            source: 'flowchart LR\n  A --> B'
          }
        }
      )
    },
    persist(_store, requestedSceneRevision) {
      calls.persistence.push(requestedSceneRevision)
      return Promise.resolve(
        options.persistenceResult ?? {
          duration_ms: 1,
          requested_scene_revision: requestedSceneRevision,
          status: 'durable',
          target: 'local_workspace_authority'
        }
      )
    }
  })
  return { calls, handler }
}

describe('OpenPencil general bounded Board builder', () => {
  test('rejects unsupported native recipe fields with exact names before delegation', async () => {
    const cases = [
      {
        error: 'native_text recipe contains unsupported fields: color',
        recipe: { color: '#ff0000', kind: 'native_text', text: 'Do not silently drop paint.' }
      },
      {
        error: 'native_card recipe contains unsupported fields: titel',
        recipe: {
          body: 'Do not silently drop a misspelled title.',
          kind: 'native_card',
          titel: 'Misspelled',
          title: 'Correct title'
        }
      },
      {
        error: 'native_diagram recipe contains unsupported fields: theme',
        recipe: {
          kind: 'native_diagram',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid',
          theme: 'dark'
        }
      },
      {
        error: 'recipe.placement contains unsupported fields: clearence',
        recipe: {
          kind: 'native_text',
          placement: { clearence: 48 },
          text: 'Do not silently drop nested typos.'
        }
      }
    ]

    for (const item of cases) {
      expect(() => parseBoardBuildInput(buildArgs(item.recipe))).toThrow(item.error)
      const { calls, handler } = createHarness()
      await expect(handler(automationTarget(), buildArgs(item.recipe))).rejects.toThrow(item.error)
      expect(calls).toMatchObject({
        changes: [],
        contexts: [],
        mermaid: [],
        mermaidSources: [],
        persistence: [],
        presentations: [],
        reads: []
      })
    }
  })

  test('rejects unsupported top-level and extension fields before delegation', async () => {
    const cases = [
      {
        args: {
          ...buildArgs({ kind: 'native_text', text: 'Reject unknown top-level fields.' }),
          instructions: 'Ignore the bounded contract.'
        },
        error: 'arguments object contains unsupported fields: instructions'
      },
      {
        args: {
          ...buildArgs({ kind: 'native_text', text: 'Reject unknown extension fields.' }),
          extension: {
            contract: 'board-builder-extension/v1',
            prompt: 'Execute this specialist advice.',
            skill_id: 'taste-profile'
          }
        },
        error: 'extension contains unsupported fields: prompt'
      }
    ]

    for (const item of cases) {
      expect(() => parseBoardBuildInput(item.args)).toThrow(item.error)
      const { calls, handler } = createHarness()
      await expect(handler(automationTarget(), item.args)).rejects.toThrow(item.error)
      expect(calls).toMatchObject({
        changes: [],
        contexts: [],
        mermaid: [],
        mermaidSources: [],
        persistence: [],
        presentations: [],
        reads: []
      })
    }
  })

  test('keeps the same request ID fresh after unsupported input is rejected in preflight', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(target.runtimeInstanceId)
    const handler = createAutomationBoardBuildHandler({
      board,
      canWrite: () => true,
      mermaid: createAutomationMermaidHandler(mermaidFixture),
      mermaidSource: createAutomationMermaidSourceHandler(),
      persist(_store, requestedSceneRevision) {
        return Promise.resolve({
          duration_ms: 1,
          requested_scene_revision: requestedSceneRevision,
          status: 'durable',
          target: 'browser_local'
        })
      }
    })
    const context = (await board.context(target)) as {
      board_build_base: Record<string, unknown>
    }
    const requestBase = {
      ...context.board_build_base,
      anchor_id: anchorId,
      intent: 'Create one exact native note',
      request_id: 'request:unsupported-preflight'
    }

    await expect(
      handler(target, {
        ...requestBase,
        recipe: { color: '#ff0000', kind: 'native_text', text: 'Correct me first.' }
      })
    ).rejects.toThrow('unsupported fields: color')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId])

    await expect(
      handler(target, {
        ...requestBase,
        recipe: { kind: 'native_text', text: 'Corrected input applies once.' }
      })
    ).resolves.toMatchObject({ status: { command: 'completed', mutation: 'applied' } })
    expect(store.graph.getNode(target.pageId)?.childIds).toHaveLength(2)
  })

  test('builds native text without a specialist and maps to board_change', async () => {
    const { calls, handler } = createHarness()
    const target = automationTarget()

    const result = (await handler(
      target,
      buildArgs({
        font_size: 24,
        kind: 'native_text',
        max_width: 420,
        name: 'Decision note',
        placement: {
          clearance: 48,
          preferred_directions: ['right', 'below', 'left', 'above']
        },
        text: 'Ship the bounded builder first.'
      })
    )) as Record<string, unknown>

    expect(calls.reads.map(({ args }) => args)).toEqual([
      { context_token: 'context:board-build', scope: 'selection' }
    ])
    expect(calls.changes.map(({ args }) => args)).toEqual([
      {
        context_token: 'context:board-build',
        expected_revision: BOARD_REVISION,
        operation: {
          anchor_id: ANCHOR_ID,
          artifact: {
            font_size: 24,
            kind: 'native_text',
            max_width: 420,
            name: 'Decision note',
            text: 'Ship the bounded builder first.'
          },
          kind: 'artifact.create',
          placement: {
            clearance: 48,
            preferred_directions: ['right', 'below', 'left', 'above']
          }
        },
        request_id: 'request:board-build',
        visual: { profile: 'local-legible-text-v1' }
      }
    ])
    expect(calls.mermaid).toHaveLength(0)
    expect(result).toMatchObject({
      build: {
        contract: 'board-build/v1',
        extension: { authority: 'none', used: false },
        recipe_kind: 'native_text',
        route: { id: 'native-text/v1', semantic_owner: 'board_change' }
      },
      status: { command: 'completed', mutation: 'applied' }
    })
  })

  test('chains several builds from each fresh returned base without an intermediate context call', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(target.runtimeInstanceId)
    const handler = createAutomationBoardBuildHandler({
      board,
      canWrite: () => true,
      mermaid: createAutomationMermaidHandler(mermaidFixture),
      mermaidSource: createAutomationMermaidSourceHandler(),
      persist(_store, requestedSceneRevision) {
        return Promise.resolve({
          duration_ms: 1,
          requested_scene_revision: requestedSceneRevision,
          status: 'durable',
          target: 'browser_local'
        })
      }
    })
    const initial = (await board.context(target)) as {
      board_build_base: Record<string, unknown>
    }
    const first = (await handler(target, {
      ...initial.board_build_base,
      anchor_id: anchorId,
      intent: 'Create the first concise idea note',
      recipe: { kind: 'native_text', text: 'Signal' },
      request_id: 'request:chained-build:first'
    })) as {
      context: {
        board_build_base: Record<string, unknown>
        selection: Array<{ id: string }>
      }
      readback: { graph: { id: string } }
      status: { command: string }
    }
    const firstOwnerId = first.readback.graph.id
    expect(first).toMatchObject({
      context: { selection: [{ id: firstOwnerId }] },
      status: { command: 'completed' }
    })

    const second = (await handler(target, {
      ...first.context.board_build_base,
      anchor_id: firstOwnerId,
      intent: 'Create the next concise idea note',
      recipe: { kind: 'native_text', text: 'Evidence' },
      request_id: 'request:chained-build:second'
    })) as {
      context: {
        board_build_base: { expected_revision: number }
        selection: Array<{ id: string }>
      }
      readback: { graph: { id: string } }
      status: { command: string }
    }
    const secondOwnerId = second.readback.graph.id
    expect(second).toMatchObject({
      context: { selection: [{ id: secondOwnerId }] },
      status: { command: 'completed' }
    })
    expect(second.context.board_build_base.expected_revision).toBe(store.state.sceneVersion)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([
      anchorId,
      firstOwnerId,
      secondOwnerId
    ])
    expect(store.undo.canUndo).toBe(true)
    store.undo.undo()
    expect(store.graph.getNode(secondOwnerId)).toBeUndefined()
    expect(store.graph.getNode(firstOwnerId)).toBeDefined()
  })

  test('replays stored anchored native builds from the original stale base without duplicates', async () => {
    installBrowserFixture()
    const scenarios = [
      {
        changedRecipe: { kind: 'native_text', text: 'Changed payload' },
        recipe: { kind: 'native_text', text: 'Original text' }
      },
      {
        changedRecipe: {
          body: 'Changed payload',
          kind: 'native_card',
          title: 'Original card'
        },
        recipe: {
          body: 'Original body',
          kind: 'native_card',
          title: 'Original card'
        }
      }
    ]

    for (const [index, scenario] of scenarios.entries()) {
      const store = createEditorStore()
      const target = automationTarget(store)
      const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
      store.select([anchorId])
      const board = createAutomationBoardHandlers(target.runtimeInstanceId)
      const handler = createAutomationBoardBuildHandler({
        board,
        canWrite: () => true,
        mermaid: createAutomationMermaidHandler(mermaidFixture),
        mermaidSource: createAutomationMermaidSourceHandler(),
        persist(_store, requestedSceneRevision) {
          return Promise.resolve({
            duration_ms: 1,
            requested_scene_revision: requestedSceneRevision,
            status: 'durable',
            target: 'browser_local'
          })
        }
      })
      const context = (await board.context(target)) as {
        board_build_base: Record<string, unknown>
      }
      const request = {
        ...context.board_build_base,
        anchor_id: anchorId,
        intent: 'Create one exact anchored artifact',
        recipe: scenario.recipe,
        request_id: `request:stored-native-replay:${index}`
      }

      const first = (await handler(target, request)) as {
        owner_id: string
        readback: { card?: { owner: { id: string } }; graph?: { id: string } }
        status: { mutation: string }
      }
      const ownerId = first.readback.graph?.id ?? first.readback.card?.owner.id
      if (!ownerId) throw new Error('Expected the native build to return its owner ID.')
      const childrenAfterApply = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]
      expect(first.status.mutation).toBe('applied')
      expect(first.owner_id).toBe(ownerId)

      const replay = (await handler(target, request)) as {
        owner_id: string
        readback: { card?: { owner: { id: string } }; graph?: { id: string } }
        status: { command: string; mutation: string }
      }
      expect(replay).toMatchObject({ status: { command: 'completed', mutation: 'replayed' } })
      expect(replay.owner_id).toBe(ownerId)
      expect(replay.readback.graph?.id ?? replay.readback.card?.owner.id).toBe(ownerId)
      expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childrenAfterApply)

      await expect(handler(target, { ...request, recipe: scenario.changedRecipe })).rejects.toThrow(
        'different mutation'
      )
      expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childrenAfterApply)

      expect(store.undo.undo()).toBeTruthy()
      expect(store.graph.getNode(ownerId)).toBeUndefined()
      await expect(handler(target, request)).resolves.toMatchObject({
        owner_id: ownerId,
        status: {
          command: 'unavailable',
          mutation: 'replayed',
          reason: 'historical_receipt_only'
        }
      })
    }
  })

  test('replays a stored anchored Mermaid build from the original stale base', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(target.runtimeInstanceId)
    const handler = createAutomationBoardBuildHandler({
      board,
      canWrite: () => true,
      mermaid: createAutomationMermaidHandler(mermaidFixture),
      mermaidSource: createAutomationMermaidSourceHandler(),
      persist(_store, requestedSceneRevision) {
        return Promise.resolve({
          duration_ms: 1,
          requested_scene_revision: requestedSceneRevision,
          status: 'durable',
          target: 'browser_local'
        })
      }
    })
    const context = (await board.context(target)) as {
      board_build_base: Record<string, unknown>
    }
    const request = {
      ...context.board_build_base,
      anchor_id: anchorId,
      intent: 'Create one exact anchored diagram',
      recipe: {
        kind: 'native_diagram',
        source: 'flowchart LR\n  Intent --> Artifact',
        source_format: 'mermaid',
        zoom_to_selection: false
      },
      request_id: 'request:stored-mermaid-replay'
    }

    const first = (await handler(target, request)) as {
      owner_id: string
      readback: { mermaid: { owner_id: string } }
      status: { mutation: string }
    }
    const ownerId = first.readback.mermaid.owner_id
    const childrenAfterApply = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]
    expect(first.status.mutation).toBe('applied')
    expect(first.owner_id).toBe(ownerId)

    await expect(handler(target, request)).resolves.toMatchObject({
      owner_id: ownerId,
      readback: { mermaid: { owner_id: ownerId } },
      status: { command: 'completed', mutation: 'replayed' }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childrenAfterApply)

    await expect(
      handler(target, {
        ...request,
        recipe: { ...request.recipe, source: 'flowchart LR\n  Changed --> Payload' }
      })
    ).rejects.toThrow('different mutation')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childrenAfterApply)

    expect(store.undo.undo()).toBeTruthy()
    expect(store.graph.getNode(ownerId)).toBeUndefined()
    await expect(handler(target, request)).resolves.toMatchObject({
      owner_id: ownerId,
      status: {
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'historical_receipt_only'
      }
    })
  })

  test('keeps the exact native owner ID on partial presentation results', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1_200 }
    })
    const recipes = [
      { kind: 'native_text', text: 'Presentation may be unavailable.' },
      {
        body: 'The semantic owner must remain directly usable.',
        kind: 'native_card',
        title: 'Partial presentation'
      }
    ]

    for (const [index, recipe] of recipes.entries()) {
      const store = createEditorStore()
      const target = automationTarget(store)
      const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
      store.select([anchorId])
      const board = createAutomationBoardHandlers(target.runtimeInstanceId)
      const handler = createAutomationBoardBuildHandler({
        board,
        canWrite: () => true,
        mermaid: createAutomationMermaidHandler(mermaidFixture),
        mermaidSource: createAutomationMermaidSourceHandler(),
        persist(_store, requestedSceneRevision) {
          return Promise.resolve({
            duration_ms: 1,
            requested_scene_revision: requestedSceneRevision,
            status: 'durable',
            target: 'browser_local'
          })
        }
      })
      const context = (await board.context(target)) as {
        board_build_base: Record<string, unknown>
      }
      const result = (await handler(target, {
        ...context.board_build_base,
        anchor_id: anchorId,
        intent: 'Create one artifact with honest presentation state',
        recipe,
        request_id: `request:partial-native-owner:${index}`
      })) as {
        owner_id: string
        receipt: { semantic_owner: { owner_id: string } }
      }
      const receiptOwnerId = result.receipt.semantic_owner.owner_id

      expect(result).toMatchObject({
        owner_id: receiptOwnerId,
        status: {
          command: 'unavailable',
          mutation: 'applied',
          reason: 'presentation_not_acknowledged'
        }
      })
      expect(result.owner_id).toBe(receiptOwnerId)
    }
  })

  test('refuses completed native owner proof when owner evidence is missing or inconsistent', async () => {
    const scenarios = [
      {
        changeResult: {
          receipt: { requestId: 'request:board-build', status: 'applied' },
          status: { attention_required: false, command: 'completed', mutation: 'applied' }
        },
        reason: 'semantic_owner_id_missing'
      },
      {
        changeResult: {
          readback: { graph: { id: 'node:readback-owner' } },
          receipt: {
            requestId: 'request:board-build',
            semantic_owner: { owner_id: 'node:receipt-owner' },
            status: 'applied'
          },
          status: { attention_required: false, command: 'completed', mutation: 'applied' }
        },
        reason: 'semantic_owner_id_conflict'
      }
    ]

    for (const scenario of scenarios) {
      const { handler } = createHarness({ changeResult: scenario.changeResult })
      await expect(
        handler(
          automationTarget(),
          buildArgs({ kind: 'native_text', text: 'Require one exact owner.' })
        )
      ).resolves.toMatchObject({
        next_action: {
          command: 'board_verify',
          request_id: 'request:board-build',
          requires_fresh_context: true,
          retry_mutation: false
        },
        proof: { reason: scenario.reason, stage: 'readback', status: 'error' },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: scenario.reason
        }
      })
    }
  })

  test('builds a bounded native card while keeping specialist provenance out of mutation', async () => {
    const { calls, handler } = createHarness()
    const result = await handler(
      automationTarget(),
      buildArgs(
        {
          body: 'A useful editable composition.',
          kind: 'native_card',
          placement: {
            clearance: 40,
            preferred_directions: ['right', 'below', 'left', 'above']
          },
          title: 'Idea card',
          width: 360
        },
        {
          extension: {
            contract: 'board-builder-extension/v1',
            skill_id: 'optional-taste'
          }
        }
      )
    )

    expect(calls.changes.map(({ args }) => args)).toEqual([
      {
        context_token: 'context:board-build',
        expected_revision: BOARD_REVISION,
        operation: {
          anchor_id: ANCHOR_ID,
          artifact: {
            body: 'A useful editable composition.',
            kind: 'native_card',
            title: 'Idea card',
            width: 360
          },
          kind: 'artifact.create',
          placement: {
            clearance: 40,
            preferred_directions: ['right', 'below', 'left', 'above']
          }
        },
        request_id: 'request:board-build',
        visual: { profile: 'local-legible-card-v1' }
      }
    ])
    expect(JSON.stringify(calls.changes.map(({ args }) => args))).not.toContain('optional-taste')
    expect(result).toMatchObject({
      build: {
        extension: { authority: 'none', skill_id: 'optional-taste', used: true },
        recipe_kind: 'native_card',
        route: { id: 'native-card/v1', semantic_owner: 'board_change' }
      },
      status: { command: 'completed', mutation: 'applied' }
    })
  })

  test('builds a native card from an exact Trace point without a temporary anchor', async () => {
    const { calls, handler } = createHarness()
    const result = await handler(
      automationTarget(),
      buildArgs(
        {
          body: 'A direct Trace-to-Board artifact.',
          kind: 'native_card',
          placement: { target: { kind: 'point', x: -240, y: 480 } },
          title: 'Trace focus'
        },
        { anchor_id: undefined, trace_id: 'trace:focus' }
      )
    )

    expect(calls.changes.map(({ args }) => args)).toEqual([
      {
        context_token: 'context:board-build',
        expected_revision: BOARD_REVISION,
        operation: {
          artifact: {
            body: 'A direct Trace-to-Board artifact.',
            kind: 'native_card',
            title: 'Trace focus'
          },
          kind: 'artifact.create',
          placement: { target: { kind: 'point', x: -240, y: 480 } }
        },
        request_id: 'request:board-build',
        trace_id: 'trace:focus',
        visual: { profile: 'local-legible-card-v1' }
      }
    ])
    expect(result).toMatchObject({ status: { command: 'completed', mutation: 'applied' } })
  })

  test('builds an ordinary native card with explicit bounded auto placement', async () => {
    const { calls, handler } = createHarness()
    const result = await handler(
      automationTarget(),
      buildArgs(
        {
          body: 'The caller supplies no geometry math.',
          kind: 'native_card',
          placement: { target: { kind: 'auto' } },
          title: 'Automatic placement'
        },
        { anchor_id: undefined }
      )
    )

    expect(calls.changes.map(({ args }) => args)).toEqual([
      {
        context_token: 'context:board-build',
        expected_revision: BOARD_REVISION,
        operation: {
          artifact: {
            body: 'The caller supplies no geometry math.',
            kind: 'native_card',
            title: 'Automatic placement'
          },
          kind: 'artifact.create',
          placement: { target: { kind: 'auto' } }
        },
        request_id: 'request:board-build',
        visual: { profile: 'local-legible-card-v1' }
      }
    ])
    expect(result).toMatchObject({ status: { command: 'completed', mutation: 'applied' } })
  })

  test('keeps every applied recipe explicit when persistence is not acknowledged', async () => {
    const recipes = [
      { kind: 'native_text', text: 'Durability must be explicit.' },
      { body: 'Durability must be explicit.', kind: 'native_card', title: 'Card' },
      {
        kind: 'native_diagram',
        source: 'flowchart LR\n  Idea --> Artifact',
        source_format: 'mermaid'
      }
    ]
    for (const recipe of recipes) {
      const { calls, handler } = createHarness({
        persistenceResult: {
          duration_ms: 2_500,
          reason: 'persistence_timeout',
          requested_scene_revision: BOARD_REVISION + 1,
          status: 'unknown'
        }
      })

      const result = await handler(automationTarget(), buildArgs(recipe))

      expect(result).toMatchObject({
        next_action: {
          command: 'board_build',
          request_id: 'request:board-build',
          requires_fresh_context: true,
          retry_mutation: true
        },
        persistence: { reason: 'persistence_timeout', status: 'unknown' },
        proof: { reason: 'persistence_not_acknowledged', stage: 'persistence' },
        receipt: { requestId: 'request:board-build', status: 'applied' },
        status: {
          command: 'unavailable',
          mutation: 'applied',
          reason: 'persistence_not_acknowledged'
        }
      })
      expect(calls.persistence).toHaveLength(1)
    }
  })

  test('preserves a native-text receipt and recovery action after post-apply proof failure', async () => {
    const { handler } = createHarness({
      changeResult: {
        proof: { error: 'Font loading unavailable', stage: 'font', status: 'error' },
        receipt: {
          idempotent_replay: false,
          requestId: 'request:board-build',
          semantic_owner: { owner_id: 'node:created-text' },
          status: 'applied'
        },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: 'post_apply_proof_failed'
        }
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs({ kind: 'native_text', text: 'Receipt survives proof failure.' })
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      build: { route: { id: 'native-text/v1', semantic_owner: 'board_change' } },
      next_action: {
        command: 'board_verify',
        request_id: 'request:board-build',
        retry_mutation: false
      },
      proof: { error: 'Font loading unavailable', stage: 'font', status: 'error' },
      receipt: { requestId: 'request:board-build', status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'post_apply_proof_failed'
      }
    })
  })

  test('does not label an unacknowledged native-text presentation completed', async () => {
    const { handler } = createHarness({
      changeResult: {
        presentation: { acknowledged: false },
        receipt: {
          requestId: 'request:board-build',
          semantic_owner: { owner_id: 'node:created-text' },
          status: 'applied'
        },
        status: { attention_required: true, command: 'completed', mutation: 'applied' }
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs({ kind: 'native_text', text: 'Presentation must be honest.' })
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      next_action: { command: 'board_verify', request_id: 'request:board-build' },
      proof: {
        reason: 'presentation_not_acknowledged',
        stage: 'presentation',
        status: 'partial'
      },
      receipt: { requestId: 'request:board-build' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'presentation_not_acknowledged'
      }
    })
  })

  test('builds a native diagram, presents its owner, and requires current reconciliation', async () => {
    const { calls, handler } = createHarness()
    const target = automationTarget()

    const result = (await handler(
      target,
      buildArgs({
        kind: 'native_diagram',
        source: 'flowchart LR\n  A --> B',
        source_format: 'mermaid',
        zoom_to_selection: false
      })
    )) as Record<string, unknown>

    expect(calls.mermaid.map(({ args }) => args)).toEqual([
      {
        anchor_id: ANCHOR_ID,
        mutation: {
          expectedRevision: BOARD_REVISION,
          requestId: 'request:board-build'
        },
        source: 'flowchart LR\n  A --> B',
        zoom_to_selection: false
      }
    ])
    expect(calls.mermaidSources.map(({ args }) => args)).toEqual([
      { owner_id: 'node:diagram-owner' }
    ])
    expect(calls.presentations.map(({ args }) => args)).toEqual([
      { context_token: 'context:fresh', object_ids: ['node:diagram-owner'] }
    ])
    expect(result).toMatchObject({
      build: {
        recipe_kind: 'native_diagram',
        route: {
          id: 'native-diagram/mermaid/v1',
          semantic_owner: 'insert_mermaid_diagram'
        }
      },
      owner_id: 'node:diagram-owner',
      presentation: { acknowledged: true },
      readback: {
        mermaid: {
          owner_id: 'node:diagram-owner',
          reconciliation: { status: 'current' }
        }
      },
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
  })

  test('returns explicit recovery when diagram reconciliation or presentation is incomplete', async () => {
    const scenarios: Array<{
      options: HarnessOptions
      reason: string
      stage: 'presentation' | 'source_readback'
    }> = [
      {
        options: {
          mermaidSourceResult: {
            ok: true,
            result: {
              owner_id: 'node:diagram-owner',
              reconciliation: { message: 'Diverged', revision: 2, status: 'diverged' }
            }
          }
        },
        reason: 'source_reconciliation_not_current',
        stage: 'source_readback'
      },
      {
        options: {
          presentationResult: {
            presentation: {
              acknowledged: false,
              selected_ids: ['node:diagram-owner']
            }
          }
        },
        reason: 'presentation_not_acknowledged',
        stage: 'presentation'
      }
    ]

    for (const scenario of scenarios) {
      const { handler } = createHarness(scenario.options)
      const result = (await handler(
        automationTarget(),
        buildArgs({
          kind: 'native_diagram',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid'
        })
      )) as Record<string, unknown>

      expect(result).toMatchObject({
        next_action: {
          command: 'board_verify',
          request_id: 'request:board-build',
          retry_mutation: false
        },
        owner_id: 'node:diagram-owner',
        proof: { reason: scenario.reason, stage: scenario.stage, status: 'partial' },
        receipt: { requestId: 'request:board-build', status: 'applied' },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: scenario.reason
        }
      })
    }
  })

  test('builds an unanchored native diagram only after proving the page is empty', async () => {
    const { calls, handler } = createHarness({
      readResult: {
        board_revision: BOARD_REVISION,
        nodes: [],
        scope: 'page',
        truncated: false
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs(
        {
          kind: 'native_diagram',
          source: 'flowchart LR\n  Idea --> Artifact',
          source_format: 'mermaid'
        },
        { anchor_id: undefined }
      )
    )) as Record<string, unknown>

    expect(calls.reads.map(({ args }) => args)).toEqual([
      { context_token: 'context:board-build', scope: 'page' }
    ])
    expect(calls.mermaid).toHaveLength(1)
    expect(result).toMatchObject({
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
  })

  test('forwards the exact deterministic empty-page diagram position', async () => {
    const { calls, handler } = createHarness({
      readResult: {
        board_revision: BOARD_REVISION,
        nodes: [],
        scope: 'page',
        truncated: false
      }
    })

    await handler(
      automationTarget(),
      buildArgs(
        {
          kind: 'native_diagram',
          source: 'flowchart LR\n  Idea --> Artifact',
          source_format: 'mermaid',
          zoom_to_selection: false
        },
        { anchor_id: undefined }
      )
    )

    expect(calls.mermaid.map(({ args }) => args)).toEqual([
      {
        mutation: {
          expectedRevision: BOARD_REVISION,
          requestId: 'request:board-build'
        },
        source: 'flowchart LR\n  Idea --> Artifact',
        x: 320,
        y: 180,
        zoom_to_selection: false
      }
    ])
  })

  test('replays the same unanchored request after unknown durability without duplicating it', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const board = createAutomationBoardHandlers(target.runtimeInstanceId)
    const persistenceAttempts: number[] = []
    const handler = createAutomationBoardBuildHandler({
      board,
      canWrite: () => true,
      mermaid: createAutomationMermaidHandler(mermaidFixture),
      mermaidSource: createAutomationMermaidSourceHandler(),
      persist(_store, requestedSceneRevision) {
        persistenceAttempts.push(requestedSceneRevision)
        if (persistenceAttempts.length === 1) {
          return Promise.resolve({
            duration_ms: 2_500,
            reason: 'persistence_timeout',
            requested_scene_revision: requestedSceneRevision,
            status: 'unknown'
          })
        }
        return Promise.resolve({
          duration_ms: 1,
          requested_scene_revision: requestedSceneRevision,
          status: 'durable',
          target: 'browser_local'
        })
      }
    })
    const firstContext = (await board.context(target)) as {
      context_token: string
      revisions: { board: number }
    }
    const request = {
      context_token: firstContext.context_token,
      contract: 'board-build/v1',
      expected_revision: firstContext.revisions.board,
      intent: 'Turn this idea into one native diagram',
      recipe: {
        kind: 'native_diagram',
        source: 'flowchart LR\n  Idea --> Artifact',
        source_format: 'mermaid',
        zoom_to_selection: false
      },
      request_id: 'request:board-build-integrated-replay'
    }

    const first = (await handler(target, request)) as {
      next_action: { base: { context_token: string }; command: string }
      readback: { mermaid: { owner_id: string } }
      receipt: { status: string }
      status: { command: string; mutation: string; reason: string }
    }
    const ownerId = first.readback.mermaid.owner_id
    expect(first).toMatchObject({
      next_action: {
        base: { context_token: expect.any(String) },
        command: 'board_build',
        requires_fresh_context: false,
        retry_mutation: true
      },
      persistence: { reason: 'persistence_timeout', status: 'unknown' },
      receipt: { status: 'applied' },
      status: {
        command: 'unavailable',
        mutation: 'applied',
        reason: 'persistence_not_acknowledged'
      }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([ownerId])
    expect(store.graph.getNode(ownerId)).toMatchObject({ x: 320, y: 180 })

    const replayContext = (await board.context(target)) as {
      context_token: string
      revisions: { board: number }
    }
    const replay = (await handler(target, {
      ...request,
      context_token: replayContext.context_token,
      expected_revision: replayContext.revisions.board
    })) as {
      readback: { mermaid: { owner_id: string } }
      receipt: { idempotentReplay: boolean }
      status: { mutation: string }
    }

    expect(replay).toMatchObject({
      persistence: { status: 'durable', target: 'browser_local' },
      readback: { mermaid: { owner_id: ownerId } },
      receipt: { idempotentReplay: true },
      status: { command: 'completed', mutation: 'replayed' }
    })
    expect(persistenceAttempts).toHaveLength(2)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([ownerId])
  })

  test('asks for an anchor instead of placing an unanchored diagram on a non-empty page', async () => {
    const { calls, handler } = createHarness({
      readResult: {
        board_revision: BOARD_REVISION,
        nodes: [{ id: 'node:existing' }],
        scope: 'page',
        truncated: false
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs(
        {
          kind: 'native_diagram',
          source: 'flowchart LR\n  Idea --> Artifact',
          source_format: 'mermaid'
        },
        { anchor_id: undefined }
      )
    )) as Record<string, unknown>

    expect(calls.mermaid).toHaveLength(0)
    expect(calls.mermaidSources).toHaveLength(0)
    expect(calls.contexts).toHaveLength(0)
    expect(calls.persistence).toHaveLength(0)
    expect(calls.presentations).toHaveLength(0)
    expect(result).toMatchObject({
      next_action: {
        command: 'board_context',
        request_id: 'request:board-build',
        required_input: 'anchor_id',
        requires_fresh_context: true
      },
      page_check: { empty: false, observed_node_count: 1, scope: 'page' },
      status: {
        attention_required: true,
        command: 'needs_input',
        mutation: 'not_applied',
        reason: 'non_empty_page_requires_anchor'
      }
    })
  })

  test('keeps optional specialist extension metadata provenance-only', async () => {
    const { calls, handler } = createHarness()

    const result = (await handler(
      automationTarget(),
      buildArgs(
        { kind: 'native_text', text: 'Specialist taste, ordinary Board authority.' },
        {
          extension: {
            contract: 'board-builder-extension/v1',
            output_digest: 'sha256:design-advice',
            profile_id: 'calm-technical',
            skill_id: 'openpencil-design-director',
            skill_version: '1.2.0'
          }
        }
      )
    )) as Record<string, unknown>

    expect(JSON.stringify(calls.changes.map(({ args }) => args))).not.toContain(
      'openpencil-design-director'
    )
    expect(result).toMatchObject({
      build: {
        extension: {
          authority: 'none',
          contract: 'board-builder-extension/v1',
          output_digest: 'sha256:design-advice',
          profile_id: 'calm-technical',
          skill_id: 'openpencil-design-director',
          skill_version: '1.2.0'
        },
        route: { semantic_owner: 'board_change' }
      }
    })
  })

  test('refuses stale revision and changed anchor selection before mutation', async () => {
    const stale = createHarness({
      readResult: { board_revision: BOARD_REVISION + 1, nodes: [{ id: ANCHOR_ID }] }
    })
    await expect(
      stale.handler(
        automationTarget(),
        buildArgs({ kind: 'native_text', text: 'Must not be created.' })
      )
    ).rejects.toThrow('Board revision is stale')
    expect(stale.calls.changes).toHaveLength(0)
    expect(stale.calls.mermaid).toHaveLength(0)

    const changedSelection = createHarness({
      readResult: { board_revision: BOARD_REVISION, nodes: [{ id: 'node:other' }] }
    })
    await expect(
      changedSelection.handler(
        automationTarget(),
        buildArgs({
          kind: 'native_diagram',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid'
        })
      )
    ).rejects.toThrow('must remain the singleton Board selection')
    expect(changedSelection.calls.changes).toHaveLength(0)
    expect(changedSelection.calls.mermaid).toHaveLength(0)
  })

  test('routes an unchanged refinement through the durable Mermaid ledger', async () => {
    const { calls, handler } = createHarness()

    const result = (await handler(
      automationTarget(),
      buildArgs(
        {
          kind: 'native_diagram',
          owner_id: 'node:diagram-owner',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid'
        },
        { anchor_id: undefined }
      )
    )) as Record<string, unknown>

    expect(calls.mermaid.map(({ args }) => args)).toEqual([
      {
        mutation: {
          expectedRevision: BOARD_REVISION,
          requestId: 'request:board-build'
        },
        owner_id: 'node:diagram-owner',
        source: 'flowchart LR\n  A --> B',
        zoom_to_selection: true
      }
    ])
    expect(calls.mermaidSources.map(({ args }) => args)).toEqual([
      { owner_id: 'node:diagram-owner' }
    ])
    expect(calls.presentations.map(({ args }) => args)).toEqual([
      { context_token: 'context:fresh', object_ids: ['node:diagram-owner'] }
    ])
    expect(result).toMatchObject({
      presentation: { acknowledged: true },
      readback: {
        mermaid: {
          owner_id: 'node:diagram-owner',
          reconciliation: { status: 'current' }
        }
      },
      status: {
        attention_required: false,
        command: 'completed',
        mutation: 'applied'
      }
    })
  })

  test('preserves an initial durable Mermaid no-change result', async () => {
    const exactTarget = automationTarget()
    const { calls, handler } = createHarness({
      contextResult: {
        board_build_base: {
          content_document_id: exactTarget.contentDocumentId,
          context_token: 'context:fresh',
          contract: 'board-build/v1',
          document_id: exactTarget.documentId,
          expected_revision: BOARD_REVISION,
          page_id: exactTarget.pageId,
          runtime_instance_id: exactTarget.runtimeInstanceId,
          workspace_id: exactTarget.workspaceId
        },
        context_token: 'context:fresh'
      },
      mermaidResult: {
        ok: true,
        result: {
          applied: false,
          mutation_receipt: {
            appliedRevision: BOARD_REVISION,
            idempotentReplay: false,
            outcome: 'no_change',
            requestId: 'request:board-build',
            status: 'no_change'
          },
          operation: 'no_change',
          owner_id: 'node:diagram-owner',
          status: {
            attention_required: false,
            command: 'completed',
            mutation: 'no_change'
          }
        }
      }
    })

    const result = (await handler(
      exactTarget,
      buildArgs(
        {
          kind: 'native_diagram',
          owner_id: 'node:diagram-owner',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid'
        },
        { anchor_id: undefined }
      )
    )) as Record<string, unknown>

    expect(calls.mermaidSources).toHaveLength(0)
    expect(calls.contexts).toHaveLength(1)
    expect(calls.presentations).toHaveLength(0)
    expect(result).toMatchObject({
      build: { route: { semantic_owner: 'insert_mermaid_diagram' } },
      operation: 'no_change',
      receipt: {
        appliedRevision: BOARD_REVISION,
        idempotentReplay: false,
        outcome: 'no_change',
        status: 'no_change'
      },
      status: {
        attention_required: false,
        command: 'completed',
        mutation: 'no_change'
      },
      connect_objects_base: {
        context_token: 'context:fresh',
        expected_revision: BOARD_REVISION
      }
    })
  })

  test('preserves a replayed durable Mermaid no-change result', async () => {
    const exactTarget = automationTarget()
    const { calls, handler } = createHarness({
      contextResult: {
        board_build_base: {
          content_document_id: exactTarget.contentDocumentId,
          context_token: 'context:fresh',
          contract: 'board-build/v1',
          document_id: exactTarget.documentId,
          expected_revision: BOARD_REVISION,
          page_id: exactTarget.pageId,
          runtime_instance_id: exactTarget.runtimeInstanceId,
          workspace_id: exactTarget.workspaceId
        },
        context_token: 'context:fresh'
      },
      mermaidResult: {
        ok: true,
        result: {
          applied: false,
          mutation_receipt: {
            appliedRevision: BOARD_REVISION,
            idempotentReplay: true,
            outcome: 'no_change',
            requestId: 'request:board-build',
            status: 'no_change'
          },
          operation: 'no_change',
          owner_id: 'node:diagram-owner',
          status: {
            attention_required: false,
            command: 'completed',
            mutation: 'no_change'
          }
        }
      }
    })

    const result = (await handler(
      exactTarget,
      buildArgs(
        {
          kind: 'native_diagram',
          owner_id: 'node:diagram-owner',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid'
        },
        { anchor_id: undefined }
      )
    )) as Record<string, unknown>

    expect(calls.mermaidSources).toHaveLength(0)
    expect(calls.contexts).toHaveLength(1)
    expect(calls.presentations).toHaveLength(0)
    expect(result).toMatchObject({
      operation: 'no_change',
      receipt: {
        appliedRevision: BOARD_REVISION,
        idempotentReplay: true,
        outcome: 'no_change',
        status: 'no_change'
      },
      status: {
        attention_required: false,
        command: 'completed',
        mutation: 'no_change'
      },
      connect_objects_base: {
        context_token: 'context:fresh',
        expected_revision: BOARD_REVISION
      }
    })
  })

  test('reports the Mermaid handler camelCase idempotent replay honestly', async () => {
    const { handler } = createHarness({
      mermaidResult: {
        ok: true,
        result: {
          applied: true,
          mutation_receipt: {
            idempotentReplay: true,
            liveStatus: 'present',
            requestId: 'request:board-build',
            status: 'applied'
          },
          owner_id: 'node:diagram-owner'
        }
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs({
        kind: 'native_diagram',
        source: 'flowchart LR\n  A --> B',
        source_format: 'mermaid'
      })
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      receipt: { idempotentReplay: true, liveStatus: 'present' },
      status: { attention_required: false, command: 'completed', mutation: 'replayed' }
    })
  })

  test('preserves historical replay and missing live-state status', async () => {
    const { calls, handler } = createHarness({
      mermaidResult: {
        ok: true,
        result: {
          applied: false,
          mutation_receipt: {
            historicalStatus: 'applied',
            idempotentReplay: true,
            liveStatus: 'missing',
            requestId: 'request:board-build'
          },
          mutation_replay: { historical: 'applied', live: 'missing' },
          owner_id: 'node:diagram-owner',
          readback: { missing: true, owner_id: 'node:diagram-owner' },
          status: {
            attention_required: true,
            command: 'unavailable',
            mutation: 'replayed',
            reason: 'historical_receipt_only'
          }
        }
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs({
        kind: 'native_diagram',
        source: 'flowchart LR\n  A --> B',
        source_format: 'mermaid'
      })
    )) as Record<string, unknown>

    expect(calls.mermaidSources).toHaveLength(0)
    expect(calls.contexts).toHaveLength(0)
    expect(calls.presentations).toHaveLength(0)
    expect(result).toMatchObject({
      next_action: {
        command: 'board_verify',
        request_id: 'request:board-build',
        retry_mutation: false
      },
      receipt: { idempotentReplay: true, liveStatus: 'missing' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'historical_receipt_only'
      }
    })
  })

  test('keeps the applied receipt visible when a post-apply proof step fails', async () => {
    const scenarios: Array<{
      options: HarnessOptions
      stage: 'context' | 'presentation' | 'source_readback'
    }> = [
      {
        options: { mermaidSourceError: new Error('Source readback unavailable') },
        stage: 'source_readback'
      },
      { options: { contextError: new Error('Context refresh unavailable') }, stage: 'context' },
      {
        options: { presentationError: new Error('Presentation unavailable') },
        stage: 'presentation'
      }
    ]

    for (const scenario of scenarios) {
      const { handler } = createHarness(scenario.options)
      const result = (await handler(
        automationTarget(),
        buildArgs({
          kind: 'native_diagram',
          source: 'flowchart LR\n  A --> B',
          source_format: 'mermaid'
        })
      )) as Record<string, unknown>

      expect(result).toMatchObject({
        next_action: {
          command: 'board_verify',
          request_id: 'request:board-build',
          requires_fresh_context: true,
          retry_mutation: false
        },
        proof: { stage: scenario.stage, status: 'error' },
        receipt: { idempotentReplay: false, requestId: 'request:board-build' },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: 'post_apply_proof_failed'
        }
      })
    }
  })

  test('preserves a Mermaid child post-finish failure without rerunning proof', async () => {
    const { calls, handler } = createHarness({
      mermaidResult: {
        ok: true,
        result: {
          applied: true,
          mutation_receipt: {
            idempotentReplay: false,
            requestId: 'request:board-build',
            status: 'applied'
          },
          next_action: {
            command: 'board_verify',
            request_id: 'request:board-build',
            retry_mutation: false
          },
          owner_id: 'node:diagram-owner',
          proof: { error: 'Font finish unavailable', stage: 'finish', status: 'error' },
          status: {
            attention_required: true,
            command: 'unavailable',
            mutation: 'applied',
            reason: 'post_apply_finish_failed'
          }
        }
      }
    })

    const result = (await handler(
      automationTarget(),
      buildArgs({
        kind: 'native_diagram',
        source: 'flowchart LR\n  A --> B',
        source_format: 'mermaid'
      })
    )) as Record<string, unknown>

    expect(calls.mermaidSources).toHaveLength(0)
    expect(calls.contexts).toHaveLength(0)
    expect(calls.presentations).toHaveLength(0)
    expect(result).toMatchObject({
      next_action: {
        command: 'board_verify',
        request_id: 'request:board-build',
        retry_mutation: false
      },
      proof: { stage: 'finish', status: 'error' },
      receipt: { requestId: 'request:board-build', status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'post_apply_finish_failed'
      }
    })
  })
})
