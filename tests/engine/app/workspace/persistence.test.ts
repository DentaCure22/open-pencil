import { describe, expect, test } from 'bun:test'

import {
  LocalStorageWorkspacePersistence,
  MemoryWorkspacePersistence,
  WorkspaceRegistry,
  WorkspaceRepository,
  applyWorkspaceMutation,
  createCanvasObject,
  createKnowledgeWorkspace,
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

describe('OpenPencil workspace persistence and shared registry', () => {
  test('keeps workspace artifacts reference-only', () => {
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
})
