import { describe, expect, test } from 'bun:test'

import {
  LocalStorageWorkspacePersistence,
  MemoryWorkspacePersistence,
  WorkspaceRegistry,
  WorkspaceRepository,
  applyWorkspaceMutation,
  createCanvasObject,
  createKnowledgeWorkspace,
  createLiveAppBlock,
  createReviewObject,
  createWorkspaceContext,
  deserializeWorkspace,
  serializeWorkspace
} from '@/app/workspace'
import type { KnowledgeWorkspace, WorkspaceStorage } from '@/app/workspace'

function workspace(): KnowledgeWorkspace {
  return createKnowledgeWorkspace({
    documentId: 'document-persistence',
    id: 'workspace-persistence',
    name: 'Persistent workspace',
    pageId: 'page-persistence'
  })
}

class FakeStorage implements WorkspaceStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('OpenPencil Live App Block safety', () => {
  test('allows only one handshake-backed live runtime owner and truthfully demotes the prior owner', () => {
    const initial = workspace()
    const context = createWorkspaceContext(initial)
    const first = createLiveAppBlock(context, {
      applicationId: 'smylr',
      capture: {
        assetRef: 'indexeddb://capture/first',
        capturedAt: '2026-07-12T12:00:00.000Z',
        maskedFieldIds: ['patient-name'],
        provenance: 'runtime',
        sourceRevision: 'source-1'
      },
      environment: 'local',
      id: 'live-first',
      route: '/patient/one',
      scenarioId: 'patient-one',
      sourceRevision: 'source-1',
      viewport: { height: 800, width: 1280 }
    })
    const second = createLiveAppBlock(context, {
      applicationId: 'smylr',
      environment: 'local',
      id: 'live-second',
      route: '/patient/two',
      runtime: { status: 'auth-required' },
      scenarioId: 'patient-two',
      sourceRevision: 'source-1',
      viewport: { height: 800, width: 1280 }
    })
    const created = applyWorkspaceMutation(initial, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'create-live-blocks',
      operations: [
        { type: 'create-object', object: first },
        { type: 'create-object', object: second }
      ]
    }).workspace
    expect(() =>
      applyWorkspaceMutation(created, {
        dryRun: false,
        expectedRevision: 1,
        idempotencyKey: 'unsafe-live-owner',
        operations: [{ blockId: first.id, type: 'set-runtime-owner' }]
      })
    ).toThrow('successful handshake')

    const firstLive = applyWorkspaceMutation(created, {
      dryRun: false,
      expectedRevision: 1,
      idempotencyKey: 'first-live-owner',
      operations: [
        {
          blockId: first.id,
          handshakeAt: '2026-07-12T12:05:00.000Z',
          type: 'set-runtime-owner'
        }
      ]
    }).workspace
    expect(firstLive.activeRuntimeBlockId).toBe(first.id)
    expect(
      firstLive.objects[first.id]?.type === 'live-app-block'
        ? firstLive.objects[first.id].runtime.status
        : null
    ).toBe('live')
    const secondLive = applyWorkspaceMutation(firstLive, {
      dryRun: false,
      expectedRevision: 2,
      idempotencyKey: 'second-live-owner',
      operations: [
        {
          blockId: second.id,
          handshakeAt: '2026-07-12T12:06:00.000Z',
          type: 'set-runtime-owner'
        }
      ]
    }).workspace
    expect(secondLive.activeRuntimeBlockId).toBe(second.id)
    expect(
      secondLive.objects[first.id]?.type === 'live-app-block'
        ? secondLive.objects[first.id].runtime.status
        : null
    ).toBe('captured')
    expect(
      secondLive.objects[second.id]?.type === 'live-app-block'
        ? secondLive.objects[second.id].runtime.status
        : null
    ).toBe('live')
  })

  test('keeps captures reference-only and exposes no source-apply mutation', () => {
    const initial = workspace()
    const context = createWorkspaceContext(initial)
    const canvas = createCanvasObject(context, {
      canvasKind: 'annotation',
      data: { note: 'Board-only geometry' },
      id: 'annotation'
    })
    const review = createReviewObject(context, {
      attachedObjectIds: [canvas.id],
      attachedRevisions: { [canvas.id]: 0 },
      body: 'Preferred is not approved or applied.',
      id: 'review',
      reviewKind: 'decision',
      reviewStatus: 'preferred'
    })
    const created = applyWorkspaceMutation(initial, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'workspace-only-artifacts',
      operations: [
        { type: 'create-object', object: canvas },
        { type: 'create-object', object: review }
      ]
    }).workspace
    expect(serializeWorkspace(created)).toContain('workspace-only')
    const unsafe = structuredClone(created)
    const storedCanvas = unsafe.objects[canvas.id]
    if (storedCanvas?.type === 'canvas-object') {
      storedCanvas.data = { capture: 'data:image/png;base64,unsafe' }
    }
    expect(() => serializeWorkspace(unsafe)).toThrow('inline data')
  })
})

describe('OpenPencil workspace persistence and shared registry', () => {
  test('round-trips pure serialization and repository mutations', async () => {
    const initial = workspace()
    const persistence = new MemoryWorkspacePersistence()
    const repository = new WorkspaceRepository(persistence)
    await repository.save(initial)
    const loaded = await repository.load(initial.id)
    expect(loaded).toEqual(initial)

    const block = createCanvasObject(createWorkspaceContext(initial), {
      canvasKind: 'shape',
      id: 'persisted-shape',
      label: 'Safe shape'
    })
    const outcome = await repository.mutate(initial.id, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'repository-mutation',
      operations: [{ type: 'create-object', object: block }]
    })
    expect(outcome.workspace.revision).toBe(1)
    expect((await repository.load(initial.id))?.objects[block.id]?.id).toBe(block.id)
    expect(deserializeWorkspace(serializeWorkspace(outcome.workspace))).toEqual(outcome.workspace)
  })

  test('demotes a persisted Live claim to a valid capture until a fresh handshake reclaims it', async () => {
    const initial = workspace()
    const block = createLiveAppBlock(createWorkspaceContext(initial), {
      applicationId: 'smylr',
      capture: {
        assetRef: 'indexeddb://capture/repository-live',
        capturedAt: '2026-07-14T12:00:00.000Z',
        maskedFieldIds: ['patient-name'],
        provenance: 'runtime',
        sourceRevision: 'source-live'
      },
      environment: 'local',
      id: 'repository-live',
      route: '/patient/repository',
      sourceRevision: 'source-live',
      viewport: { height: 800, width: 1280 }
    })
    const created = applyWorkspaceMutation(initial, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'create-repository-live',
      operations: [{ object: block, type: 'create-object' }]
    }).workspace
    const claimed = applyWorkspaceMutation(created, {
      dryRun: false,
      expectedRevision: 1,
      idempotencyKey: 'claim-repository-live',
      operations: [
        {
          blockId: block.id,
          handshakeAt: '2026-07-14T12:01:00.000Z',
          type: 'set-runtime-owner'
        }
      ]
    }).workspace
    const claimedBlock = claimed.objects[block.id]
    if (claimedBlock?.type !== 'live-app-block') throw new Error('expected Live App Block')

    const repository = new WorkspaceRepository(new MemoryWorkspacePersistence())
    await repository.save(claimed)
    const loaded = await repository.load(claimed.id)
    if (!loaded) throw new Error('expected persisted workspace')
    const loadedBlock = loaded.objects[block.id]
    if (loadedBlock?.type !== 'live-app-block') throw new Error('expected Live App Block')

    expect(loaded.activeRuntimeBlockId).toBeUndefined()
    expect(loadedBlock.runtime).toEqual({ status: 'captured' })
    expect(loadedBlock.capture).toEqual(claimedBlock.capture)
    expect(loaded.revision).toBe(claimed.revision)
    expect(loadedBlock.revision).toBe(claimedBlock.revision)

    const reclaimed = applyWorkspaceMutation(loaded, {
      dryRun: false,
      expectedRevision: loaded.revision,
      idempotencyKey: 'reclaim-repository-live',
      operations: [
        {
          blockId: block.id,
          handshakeAt: '2026-07-14T12:02:00.000Z',
          type: 'set-runtime-owner'
        }
      ]
    }).workspace
    const reclaimedBlock = reclaimed.objects[block.id]
    expect(reclaimed.activeRuntimeBlockId).toBe(block.id)
    expect(reclaimedBlock?.type === 'live-app-block' ? reclaimedBlock.runtime.status : null).toBe(
      'live'
    )

    const invalidCapture = structuredClone(claimed)
    const invalidCaptureBlock = invalidCapture.objects[block.id]
    if (invalidCaptureBlock?.type !== 'live-app-block' || !invalidCaptureBlock.capture) {
      throw new Error('expected captured Live App Block')
    }
    invalidCaptureBlock.capture.capturedAt = 'not-a-timestamp'
    await repository.save(invalidCapture)
    const invalidLoaded = await repository.load(invalidCapture.id)
    const invalidLoadedBlock = invalidLoaded?.objects[block.id]
    expect(
      invalidLoadedBlock?.type === 'live-app-block' ? invalidLoadedBlock.runtime.status : null
    ).toBe('unavailable')
  })

  test('hydrates a stale Live claim without a capture as unavailable', () => {
    const registry = new WorkspaceRegistry()
    const initial = registry.resolve({ documentId: 'document-live', pageId: 'page-live' })
    const block = createLiveAppBlock(createWorkspaceContext(initial), {
      applicationId: 'smylr',
      environment: 'local',
      id: 'hydrated-live',
      route: '/patient/hydrated',
      sourceRevision: 'source-live',
      viewport: { height: 800, width: 1280 }
    })
    registry.mutate(initial.documentId, initial.pageId, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'create-hydrated-live',
      operations: [{ object: block, type: 'create-object' }]
    })
    registry.mutate(initial.documentId, initial.pageId, {
      dryRun: false,
      expectedRevision: 1,
      idempotencyKey: 'claim-hydrated-live',
      operations: [
        {
          blockId: block.id,
          handshakeAt: '2026-07-14T12:03:00.000Z',
          type: 'set-runtime-owner'
        }
      ]
    })
    const serialized = registry.serialize()
    const activeBlock = registry.get(initial.documentId, initial.pageId)?.objects[block.id]
    expect(activeBlock?.type === 'live-app-block' ? activeBlock.runtime.status : null).toBe('live')

    const hydrated = new WorkspaceRegistry()
    hydrated.hydrate(serialized)
    const hydratedWorkspace = hydrated.get(initial.documentId, initial.pageId)
    const hydratedBlock = hydratedWorkspace?.objects[block.id]
    expect(hydratedWorkspace?.activeRuntimeBlockId).toBeUndefined()
    expect(hydratedBlock?.type === 'live-app-block' ? hydratedBlock.runtime : null).toEqual({
      status: 'unavailable'
    })
  })

  test('guards localStorage availability and payload size', async () => {
    const unavailable = new LocalStorageWorkspacePersistence({ storage: undefined })
    if (!unavailable.isAvailable()) {
      await expect(unavailable.save('workspace', '{}')).rejects.toThrow(
        'workspace_persistence_unavailable'
      )
    }

    const storage = new FakeStorage()
    const limited = new LocalStorageWorkspacePersistence({ maxBytes: 10, storage })
    await expect(limited.save('workspace', '01234567890')).rejects.toThrow(
      'workspace_persistence_limit'
    )
    const available = new LocalStorageWorkspacePersistence({ maxBytes: 100, storage })
    await available.save('workspace', '{"ok":true}')
    expect(await available.load('workspace')).toBe('{"ok":true}')
  })

  test('resolves one shared workspace per document/page and serializes the active registry', () => {
    const registry = new WorkspaceRegistry()
    const first = registry.resolve({ documentId: 'document', name: 'First', pageId: 'page' })
    const same = registry.resolve({ documentId: 'document', name: 'Ignored', pageId: 'page' })
    const another = registry.resolve({ documentId: 'document', pageId: 'another-page' })
    expect(same).toBe(first)
    expect(another.id).not.toBe(first.id)

    const serialized = registry.serialize()
    const hydrated = new WorkspaceRegistry()
    hydrated.hydrate(serialized)
    expect(hydrated.list()).toHaveLength(2)
    expect(hydrated.get('document', 'page')).toEqual(first)
  })

  test('prevents two page workspaces from claiming the one shared live runtime', () => {
    const registry = new WorkspaceRegistry()
    const first = registry.resolve({ documentId: 'document', pageId: 'page-one' })
    const second = registry.resolve({ documentId: 'document', pageId: 'page-two' })
    const firstBlock = createLiveAppBlock(createWorkspaceContext(first), {
      applicationId: 'smylr',
      environment: 'test',
      id: 'first-runtime',
      route: '/first',
      sourceRevision: 'source-one',
      viewport: { height: 800, width: 1280 }
    })
    const secondBlock = createLiveAppBlock(createWorkspaceContext(second), {
      applicationId: 'smylr',
      environment: 'test',
      id: 'second-runtime',
      route: '/second',
      sourceRevision: 'source-two',
      viewport: { height: 800, width: 1280 }
    })
    registry.mutate(first.documentId, first.pageId, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'create-first-runtime',
      operations: [{ object: firstBlock, type: 'create-object' }]
    })
    registry.mutate(second.documentId, second.pageId, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'create-second-runtime',
      operations: [{ object: secondBlock, type: 'create-object' }]
    })
    registry.mutate(first.documentId, first.pageId, {
      dryRun: false,
      expectedRevision: 1,
      idempotencyKey: 'claim-first-runtime',
      operations: [
        {
          blockId: firstBlock.id,
          handshakeAt: '2026-07-12T12:00:00.000Z',
          type: 'set-runtime-owner'
        }
      ]
    })
    expect(() =>
      registry.mutate(second.documentId, second.pageId, {
        dryRun: false,
        expectedRevision: 1,
        idempotencyKey: 'claim-second-runtime',
        operations: [
          {
            blockId: secondBlock.id,
            handshakeAt: '2026-07-12T12:01:00.000Z',
            type: 'set-runtime-owner'
          }
        ]
      })
    ).toThrow('shared live runtime is already owned')
  })
})
