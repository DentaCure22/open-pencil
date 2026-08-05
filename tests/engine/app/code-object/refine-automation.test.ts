import { describe, expect, test } from 'bun:test'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'
import {
  objectGraphConnectionsOnPage,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection
} from '@open-pencil/scene-graph'

import { createAutomationCodeObjectRefineHandler } from '@/app/automation/bridge/code-object-handler'
import { codeObjectSourceHash } from '@/app/automation/bridge/code-object/source'
import {
  mutationRequestLedgerSnapshot,
  mutationRequestLedgerState
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  codeObjectDocument,
  createCodeObject,
  createUserCodeObjectDocument,
  updateCodeObjectState
} from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import { setSmylrProductionDocumentWriteGuard } from '@/app/smylr-production/document-authority'

const OBJECT_KEY = 'decision-lens'
const ORIGINAL_SOURCE =
  'export default function DecisionLens() { return <main>Original decision</main> }'
const REFINED_SOURCE =
  'export default function DecisionLens() { return <main>Refined decision</main> }'

function target(): AutomationTarget {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Missing test Board')
  setSmylrProductionDocumentWriteGuard(store, () => true)
  return {
    contentDocumentId: 'content-document:refine',
    documentId: 'document-tab:refine',
    documentName: 'Refine test document',
    pageId: page.id,
    pageName: page.name,
    runtimeInstanceId: 'runtime:refine',
    store,
    workspaceId: 'workspace:refine'
  }
}

function fixture() {
  const automationTarget = target()
  const { store } = automationTarget
  const document = createUserCodeObjectDocument({
    boardPermissions: ['shape.create', 'target.state.write'],
    connections: [
      {
        id: 'legacy:decision-output',
        label: 'Decision output',
        permissions: ['state.write'],
        targetFrameId: 'node:legacy-target'
      }
    ],
    definitionId: OBJECT_KEY,
    name: 'Decision lens',
    props: { accent: 'amber', density: 'comfortable' },
    source: ORIGINAL_SOURCE,
    state: { activeChoice: 'A', visits: 3 }
  })
  const owner = createCodeObject(store, {
    document,
    height: 480,
    name: document.name,
    width: 680,
    x: 144,
    y: 96
  })
  const targetId = store.createShape('RECTANGLE', 940, 120, 180, 120, automationTarget.pageId)
  const connection: ObjectGraphConnection = {
    automatic: false,
    id: 'connection:decision-output',
    kind: 'data',
    label: 'Decision output',
    permissions: ['target.data.write'],
    schemaVersion: 1,
    sourceNodeId: owner.id,
    sourcePort: 'right',
    targetNodeId: targetId,
    targetPort: 'left'
  }
  setObjectGraphConnectionsOnPage(store.graph, automationTarget.pageId, [connection])
  const currentOwner = store.graph.getNode(owner.id)
  if (!currentOwner) throw new Error('Missing Code Object owner')
  store.graph.updateNode(owner.id, {
    pluginData: [
      ...currentOwner.pluginData,
      { key: 'audit', pluginId: 'test-preservation', value: 'keep-me' }
    ],
    rotation: 7
  })
  store.select([owner.id])
  store.undo.clear()
  const beforeDocument = codeObjectDocument(store.graph.getNode(owner.id))
  if (beforeDocument?.component !== 'user-code') throw new Error('Missing Code Object document')
  return {
    automationTarget,
    beforeDocument: structuredClone(beforeDocument),
    connection,
    ownerId: owner.id
  }
}

async function refineArgs(targetValue: AutomationTarget, ownerId: string, requestId: string) {
  return {
    expected_source_hash: await codeObjectSourceHash(ORIGINAL_SOURCE),
    mutation: {
      expected_revision: targetValue.store.state.sceneVersion,
      request_id: requestId
    },
    name: 'Decision lens v2',
    object_key: OBJECT_KEY,
    owner_id: ownerId,
    persist: false as const,
    props: { accent: 'violet', density: 'compact' },
    source: REFINED_SOURCE,
    zoom: false as const
  }
}

describe('guarded Code Object refinement', () => {
  test('updates the exact owner in one Undo step and preserves protected fields', async () => {
    const { automationTarget, beforeDocument, connection, ownerId } = fixture()
    const refine = createAutomationCodeObjectRefineHandler()
    const args = await refineArgs(automationTarget, ownerId, 'request:refine-decision-lens')

    const result = await refine(automationTarget, args)

    expect(result).toMatchObject({
      owner_id: ownerId,
      preservation: {
        board_permissions: true,
        geometry: true,
        legacy_connections: true,
        object_graph_connections: true,
        other_plugin_data: true,
        state: true
      },
      readback: { code_object: { reconciliation: { reasons: [], status: 'current' } } },
      receipt: { history_label: 'Refine code object', idempotent_replay: false },
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
    const refined = codeObjectDocument(automationTarget.store.graph.getNode(ownerId))
    expect(refined).toMatchObject({
      boardPermissions: beforeDocument.boardPermissions,
      connections: [{ id: 'legacy:decision-output' }],
      name: 'Decision lens v2',
      props: { accent: 'violet', density: 'compact' },
      source: REFINED_SOURCE,
      state: { activeChoice: 'A', visits: 3 }
    })
    expect(automationTarget.store.graph.getNode(ownerId)).toMatchObject({
      height: 480,
      rotation: 7,
      width: 680,
      x: 144,
      y: 96
    })
    expect(
      automationTarget.store.graph
        .getNode(ownerId)
        ?.pluginData.find((entry) => entry.pluginId === 'test-preservation')
    ).toEqual({ key: 'audit', pluginId: 'test-preservation', value: 'keep-me' })
    expect(
      objectGraphConnectionsOnPage(automationTarget.store.graph, automationTarget.pageId)
    ).toEqual([connection])

    expect(automationTarget.store.undo.undo()).toBe('Refine code object')
    expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
      ORIGINAL_SOURCE
    )
    expect(automationTarget.store.undo.redo()).toBe('Refine code object')
    expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
      REFINED_SOURCE
    )
  })

  test('replays across interactive state changes and reload without reapplying', async () => {
    const { automationTarget, ownerId } = fixture()
    const refine = createAutomationCodeObjectRefineHandler()
    const args = await refineArgs(automationTarget, ownerId, 'request:refine-replay')
    await refine(automationTarget, args)
    expect(
      updateCodeObjectState(automationTarget.store, ownerId, { activeChoice: 'B', visits: 4 })
    ).toBe(true)

    const reloadedStore = createEditorStore(
      deserializeSceneGraph(structuredClone(serializeSceneGraph(automationTarget.store.graph)))
    )
    setSmylrProductionDocumentWriteGuard(reloadedStore, () => true)
    reloadedStore.select([ownerId])
    const reloadedTarget: AutomationTarget = { ...automationTarget, store: reloadedStore }
    const replayed = await refine(reloadedTarget, args)

    expect(replayed).toMatchObject({
      owner_id: ownerId,
      preservation: { state: true },
      receipt: { historical_only: false, idempotent_replay: true },
      status: { attention_required: false, command: 'completed', mutation: 'replayed' }
    })
    expect(codeObjectDocument(reloadedStore.graph.getNode(ownerId))?.state).toEqual({
      activeChoice: 'B',
      visits: 4
    })
    await expect(refine(reloadedTarget, { ...args, name: 'Different payload' })).rejects.toThrow(
      'different mutation'
    )
  })

  test('keeps an undone refinement historical and never reapplies it', async () => {
    const { automationTarget, ownerId } = fixture()
    const refine = createAutomationCodeObjectRefineHandler()
    const args = await refineArgs(automationTarget, ownerId, 'request:refine-then-undo')
    await refine(automationTarget, args)

    expect(automationTarget.store.undo.undo()).toBe('Refine code object')
    const replayed = await refine(automationTarget, args)

    expect(replayed).toMatchObject({
      owner_id: ownerId,
      receipt: { historical_only: true, idempotent_replay: true },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'code_object_reconciliation_failed'
      }
    })
    expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
      ORIGINAL_SOURCE
    )
  })

  test('stores and reloads a stable no-change receipt without adding Undo history', async () => {
    const { automationTarget, ownerId } = fixture()
    const refine = createAutomationCodeObjectRefineHandler()
    const changedArgs = await refineArgs(automationTarget, ownerId, 'request:refine-no-change')
    const { name: _name, props: _props, ...base } = changedArgs
    const args = { ...base, source: ORIGINAL_SOURCE }
    const undoLabel = automationTarget.store.undo.undoLabel

    const result = await refine(automationTarget, args)
    expect(result).toMatchObject({
      receipt: { idempotent_replay: false, no_history: true, outcome: 'no_change' },
      status: { attention_required: false, command: 'completed', mutation: 'no_change' }
    })
    expect(automationTarget.store.undo.undoLabel).toBe(undoLabel)
    expect(mutationRequestLedgerState(automationTarget, args.mutation.request_id).status).toBe(
      'stored'
    )

    const reloadedStore = createEditorStore(
      deserializeSceneGraph(structuredClone(serializeSceneGraph(automationTarget.store.graph)))
    )
    setSmylrProductionDocumentWriteGuard(reloadedStore, () => true)
    reloadedStore.select([ownerId])
    const replayed = await refine({ ...automationTarget, store: reloadedStore }, args)
    expect(replayed).toMatchObject({
      receipt: { idempotent_replay: true, no_history: true, outcome: 'no_change' },
      status: { attention_required: false, command: 'completed', mutation: 'no_change' }
    })
    await expect(
      refine({ ...automationTarget, store: reloadedStore }, { ...args, source: REFINED_SOURCE })
    ).rejects.toThrow('different mutation')
  })

  test('rejects an aliased ambient capability before refinement state changes', async () => {
    const { automationTarget, ownerId } = fixture()
    const refine = createAutomationCodeObjectRefineHandler()
    const requestId = 'request:refine-aliased-capability'
    const args = await refineArgs(automationTarget, ownerId, requestId)
    const page = automationTarget.store.graph.getNode(automationTarget.pageId)
    if (!page) throw new Error('Missing refinement capability test Board')
    const originalLedger = mutationRequestLedgerSnapshot(page)
    const originalRevision = automationTarget.store.state.sceneVersion
    const originalUndo = {
      canUndo: automationTarget.store.undo.canUndo,
      label: automationTarget.store.undo.undoLabel
    }

    await expect(
      refine(automationTarget, {
        ...args,
        source:
          'const send = fetch; export default function BlockedRefinement() { return <main>{String(send)}</main> }'
      })
    ).rejects.toThrow('blocked ambient capability "fetch"')

    expect(mutationRequestLedgerState(automationTarget, requestId)).toEqual({ status: 'missing' })
    expect(
      mutationRequestLedgerSnapshot(automationTarget.store.graph.getNode(automationTarget.pageId))
    ).toEqual(originalLedger)
    expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
      ORIGINAL_SOURCE
    )
    expect(automationTarget.store.state.sceneVersion).toBe(originalRevision)
    expect(automationTarget.store.undo.canUndo).toBe(originalUndo.canUndo)
    expect(automationTarget.store.undo.undoLabel).toBe(originalUndo.label)
  })

  test('rejects stale source, unsafe source, and wrong identity before reservation', async () => {
    const { automationTarget, ownerId } = fixture()
    const refine = createAutomationCodeObjectRefineHandler()
    const base = await refineArgs(automationTarget, ownerId, 'request:refine-stale-source')
    const originalRevision = automationTarget.store.state.sceneVersion
    const originalUndoLabel = automationTarget.store.undo.undoLabel

    await expect(
      refine(automationTarget, { ...base, expected_source_hash: `sha256:${'0'.repeat(64)}` })
    ).rejects.toThrow('source changed before refinement')
    expect(mutationRequestLedgerState(automationTarget, base.mutation.request_id)).toEqual({
      status: 'missing'
    })
    expect(automationTarget.store.state.sceneVersion).toBe(originalRevision)
    expect(automationTarget.store.undo.undoLabel).toBe(originalUndoLabel)
    expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
      ORIGINAL_SOURCE
    )

    for (const tamper of [
      {
        expectedError: 'is missing from the exact Board',
        patch: { owner_id: 'node:wrong-owner' },
        requestId: 'request:refine-wrong-owner'
      },
      {
        expectedError: 'does not match immutable object key',
        patch: { object_key: 'wrong-object-key' },
        requestId: 'request:refine-wrong-object-key'
      }
    ]) {
      await expect(
        refine(automationTarget, {
          ...base,
          ...tamper.patch,
          mutation: { ...base.mutation, request_id: tamper.requestId }
        })
      ).rejects.toThrow(tamper.expectedError)
      expect(mutationRequestLedgerState(automationTarget, tamper.requestId)).toEqual({
        status: 'missing'
      })
      expect(automationTarget.store.state.sceneVersion).toBe(originalRevision)
      expect(automationTarget.store.undo.undoLabel).toBe(originalUndoLabel)
      expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
        ORIGINAL_SOURCE
      )
    }

    const unsafeRequestId = 'request:refine-unsafe-source'
    await expect(
      refine(automationTarget, {
        ...base,
        mutation: { ...base.mutation, request_id: unsafeRequestId },
        source: 'fetch("https://example.com"); export default function Bad() { return <div /> }'
      })
    ).rejects.toThrow('blocked ambient capability')
    expect(mutationRequestLedgerState(automationTarget, unsafeRequestId)).toEqual({
      status: 'missing'
    })

    const compileRequestId = 'request:refine-compile-error'
    await expect(
      refine(automationTarget, {
        ...base,
        mutation: { ...base.mutation, request_id: compileRequestId },
        source: 'export default function Broken( { return <div /> }'
      })
    ).rejects.toThrow('trusted compile preflight')
    expect(mutationRequestLedgerState(automationTarget, compileRequestId)).toEqual({
      status: 'missing'
    })
  })

  test('refines the exact owner while an unrelated Board object is selected', async () => {
    const { automationTarget, ownerId } = fixture()
    const unrelated = automationTarget.store.graph
      .getChildren(automationTarget.pageId)
      .find((node) => node.id !== ownerId)
    if (!unrelated) throw new Error('Missing unrelated refinement selection fixture')
    automationTarget.store.select([unrelated.id])
    const refine = createAutomationCodeObjectRefineHandler()
    const args = await refineArgs(
      automationTarget,
      ownerId,
      'request:refine-with-unrelated-selection'
    )

    const result = await refine(automationTarget, args)

    expect(result).toMatchObject({
      owner_id: ownerId,
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
    expect(automationTarget.store.state.selectedIds).toEqual(new Set([unrelated.id]))
    expect(codeObjectDocument(automationTarget.store.graph.getNode(ownerId))?.source).toBe(
      REFINED_SOURCE
    )
  })
})
