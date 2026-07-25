import { describe, expect, test } from 'bun:test'

import {
  WORKSPACE_SCHEMA_VERSION,
  applyWorkspaceMutation,
  createDocumentBlock,
  createEvidenceManifest,
  createIntentRecord,
  createKnowledgeWorkspace,
  createReviewObject,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceRelation,
  createWorkspaceView,
  deserializeWorkspace,
  serializeWorkspace,
  type KnowledgeWorkspace,
  type WorkspaceOperation
} from '@/app/workspace'
import { resolveExperienceProjections } from '@/app/workspace-ui/experience-projections'

const ROOT_ID = 'surface-projection-root'
const COMPANION_ID = 'surface-projection-companion-01'
const INTENT_ID = 'intent-projection-root'
const EVIDENCE_ID = 'evidence-projection-root'
const BINDING_ID = 'binding-projection-root'
const UNRELATED_ID = 'unrelated-object'

function ref(objectId: string, revision = 1) {
  return { objectId, revision }
}

function artifact(surfaceId: string) {
  return {
    artifactId: `artifact-${surfaceId}`,
    boardId: `board-${surfaceId}`,
    boardRevision: 1,
    boardSchemaVersion: 1,
    kind: 'html-board' as const,
    sourceHash: `fnv1a-${surfaceId}`
  }
}

function projectionWorkspace(
  input: {
    bindingCount?: number
    companionCount?: number
    rendererCompare?: boolean
    reviewCount?: number
  } = {}
): KnowledgeWorkspace {
  const initial = createKnowledgeWorkspace({
    documentId: 'document-experience-projections',
    id: 'workspace-experience-projections',
    name: 'Experience projections',
    now: '2026-07-14T18:00:00.000Z',
    pageId: 'page-experience-projections'
  })
  const context = createWorkspaceContext(initial, {
    now: '2026-07-14T18:00:00.000Z'
  })
  const intent = createIntentRecord(context, {
    capturedAt: '2026-07-14T18:00:00.000Z',
    desiredOutcome: 'Project one exact experience without unrelated workspace objects.',
    id: INTENT_ID,
    statement: 'Keep one shared lineage across purposeful views.'
  })
  const evidence = createEvidenceManifest(context, {
    id: EVIDENCE_ID,
    intent: ref(INTENT_ID),
    items: [],
    snapshotAt: '2026-07-14T18:00:00.000Z'
  })
  const bindingIds = Array.from({ length: input.bindingCount ?? 1 }, (_, index) =>
    index === 0 ? BINDING_ID : `${BINDING_ID}-${String(index + 1).padStart(2, '0')}`
  )
  const bindings = bindingIds.map((id) =>
    createDocumentBlock(context, {
      blockKind: 'paragraph',
      id,
      text: `Bound knowledge ${id} belongs to this surface.`
    })
  )
  const unrelated = createDocumentBlock(context, {
    blockKind: 'paragraph',
    id: UNRELATED_ID,
    text: 'This active object must never leak into the experience projections.'
  })
  const modes = [
    {
      id: 'mode-focus',
      kind: 'focus' as const,
      label: 'Focus',
      rendererViewId: 'focus'
    },
    ...(input.rendererCompare
      ? [
          {
            id: 'mode-compare',
            kind: 'compare' as const,
            label: 'Compare',
            rendererViewId: 'compare'
          }
        ]
      : []),
    {
      id: 'mode-review',
      kind: 'review' as const,
      label: 'Review',
      rendererViewId: 'review'
    }
  ]
  const root = createSurfaceRun(context, {
    artifact: artifact(ROOT_ID),
    bindings: {
      evidenceItemIds: [],
      objectRefs: [ref(INTENT_ID), ref(EVIDENCE_ID), ...bindingIds.map((id) => ref(id))],
      viewIds: []
    },
    evidenceManifest: ref(EVIDENCE_ID),
    formRationale: 'A focused interactive surface keeps this intent executable.',
    id: ROOT_ID,
    intent: ref(INTENT_ID),
    modes,
    name: 'Projection root',
    recommendations: [],
    rendererId: 'projection-test-v1'
  })
  const reviews = Array.from({ length: input.reviewCount ?? 1 }, (_, index) => {
    const bindingId = bindingIds[index % bindingIds.length] ?? BINDING_ID
    const id =
      index === 0
        ? 'review-projection-root'
        : `review-projection-root-${String(index + 1).padStart(2, '0')}`
    return createReviewObject(
      createWorkspaceContext(initial, {
        now: `2026-07-14T18:${String(index + 1).padStart(2, '0')}:00.000Z`
      }),
      {
        attachedObjectIds: [bindingId],
        attachedRevisions: { [bindingId]: 1 },
        body: `Review ${id} is attached to an exact bound object revision.`,
        id,
        reviewKind: 'comment'
      }
    )
  })
  const operations: WorkspaceOperation[] = [
    { object: intent, type: 'create-object' },
    { object: evidence, type: 'create-object' },
    ...bindings.map((object) => ({ object, type: 'create-object' as const })),
    { object: unrelated, type: 'create-object' },
    { object: root, type: 'create-object' },
    ...reviews.map((object) => ({ object, type: 'create-object' as const }))
  ]
  for (let index = 0; index < (input.companionCount ?? 0); index += 1) {
    const companionId =
      index === 0
        ? COMPANION_ID
        : `surface-projection-companion-${String(index + 1).padStart(2, '0')}`
    const companion = createSurfaceRun(context, {
      artifact: artifact(companionId),
      bindings: {
        evidenceItemIds: [],
        objectRefs: [ref(INTENT_ID), ref(EVIDENCE_ID)],
        viewIds: []
      },
      evidenceManifest: ref(EVIDENCE_ID),
      formRationale: 'A companion explains the same exact intent and evidence.',
      id: companionId,
      intent: ref(INTENT_ID),
      modes: [
        { id: 'mode-focus', kind: 'focus', label: 'Focus' },
        { id: 'mode-review', kind: 'review', label: 'Review' }
      ],
      name: 'Projection companion',
      recommendations: [],
      rendererId: 'projection-companion-v1'
    })
    const relation = createWorkspaceRelation({
      id: `relation-${companionId}`,
      relationType: 'companion-view-of',
      sourceId: companionId,
      targetId: ROOT_ID,
      workspaceId: initial.id
    })
    operations.push(
      { object: companion, type: 'create-object' },
      { relation, type: 'connect-relation' }
    )
  }
  return applyWorkspaceMutation(initial, {
    dryRun: false,
    expectedRevision: 0,
    idempotencyKey: 'create-projection-workspace',
    operations
  }).workspace
}

describe('experience projection view contract', () => {
  test('creates and persists an exact typed root projection while migrating v13 workspaces', () => {
    const workspace = projectionWorkspace()
    const view = createWorkspaceView({
      experienceProjection: {
        purpose: 'focus',
        rendererViewId: 'focus',
        rootSurface: ref(ROOT_ID)
      },
      id: 'view-experience-focus',
      kind: 'canvas',
      name: 'Focus',
      workspaceId: workspace.id
    })
    const withView = applyWorkspaceMutation(workspace, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: 'create-focus-projection',
      operations: [{ type: 'create-view', view }]
    }).workspace

    expect(withView.views[view.id]?.experienceProjection).toEqual({
      purpose: 'focus',
      rendererViewId: 'focus',
      rootSurface: ref(ROOT_ID)
    })
    expect(deserializeWorkspace(serializeWorkspace(withView))).toEqual(withView)
    const persistedRoot = deserializeWorkspace(serializeWorkspace(withView)).objects[ROOT_ID]
    if (persistedRoot?.type !== 'surface-run') throw new Error('persisted root missing')
    expect(persistedRoot.modes.find((mode) => mode.kind === 'focus')).toMatchObject({
      id: 'mode-focus',
      rendererViewId: 'focus'
    })

    const legacy = serializeWorkspace(workspace).replace('"schemaVersion":15', '"schemaVersion":13')
    const migrated = deserializeWorkspace(legacy)
    expect(migrated.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION)
    expect(Object.values(migrated.views).every((item) => !item.experienceProjection)).toBe(true)
  })

  test('rejects renderer presentation targets that cannot be exact-matched safely', () => {
    const workspace = projectionWorkspace()
    const root = workspace.objects[ROOT_ID]
    if (root?.type !== 'surface-run') throw new Error('projection root missing')
    const invalid = {
      ...workspace,
      objects: {
        ...workspace.objects,
        [root.id]: {
          ...root,
          modes: root.modes.map((mode) =>
            mode.kind === 'focus' ? { ...mode, rendererViewId: '[data-view="focus"]' } : mode
          )
        }
      }
    }

    expect(() => serializeWorkspace(invalid)).toThrow('bounded renderer target')
  })

  test('rejects stale, cross-workspace, and duplicate active purpose claims', () => {
    const workspace = projectionWorkspace()
    const focus = (id: string, rootSurface = ref(ROOT_ID)) =>
      createWorkspaceView({
        experienceProjection: { purpose: 'focus', rootSurface },
        id,
        kind: 'canvas',
        name: 'Focus',
        workspaceId: workspace.id
      })

    expect(() =>
      serializeWorkspace({
        ...workspace,
        views: { stale: focus('stale', ref(ROOT_ID, 0)) }
      })
    ).toThrow('exact surface-run revision 0')
    expect(() =>
      serializeWorkspace({
        ...workspace,
        views: {
          foreign: focus('foreign', ref('surface-from-another-workspace'))
        }
      })
    ).toThrow('references missing object surface-from-another-workspace')
    expect(() =>
      serializeWorkspace({
        ...workspace,
        views: { first: focus('first'), second: focus('second') }
      })
    ).toThrow('duplicate active focus projections')
  })

  test('atomically advances existing purpose views when their root surface is revised', () => {
    const workspace = projectionWorkspace({ rendererCompare: true })
    const viewInputs = [
      { id: 'view-purpose-focus', kind: 'canvas', purpose: 'focus' },
      { id: 'view-purpose-compare', kind: 'canvas', purpose: 'compare' },
      { id: 'view-purpose-knowledge', kind: 'document', purpose: 'knowledge' },
      { id: 'view-purpose-review', kind: 'review', purpose: 'review' }
    ] as const
    const views = viewInputs.map((input) =>
      createWorkspaceView({
        experienceProjection: {
          purpose: input.purpose,
          rendererViewId: input.purpose,
          rootSurface: ref(ROOT_ID)
        },
        id: input.id,
        kind: input.kind,
        name: input.purpose,
        workspaceId: workspace.id
      })
    )
    const withViews = applyWorkspaceMutation(workspace, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: 'create-purpose-views',
      operations: views.map((view) => ({ type: 'create-view', view }))
    }).workspace
    const withArchivedReview = applyWorkspaceMutation(withViews, {
      dryRun: false,
      expectedRevision: withViews.revision,
      idempotencyKey: 'archive-purpose-review',
      operations: [
        {
          expectedViewRevision: withViews.views['view-purpose-review']?.revision ?? -1,
          type: 'archive-view',
          viewId: 'view-purpose-review'
        }
      ]
    }).workspace
    const previousViewIds = Object.keys(withArchivedReview.views).toSorted()
    const previousViewRevisions = Object.fromEntries(
      Object.values(withArchivedReview.views).map((view) => [view.id, view.revision])
    )
    const updated = applyWorkspaceMutation(withArchivedReview, {
      dryRun: false,
      expectedRevision: withArchivedReview.revision,
      idempotencyKey: 'revise-purpose-root',
      operations: [
        {
          expectedObjectRevision: 1,
          objectId: ROOT_ID,
          objectType: 'surface-run',
          patch: { name: 'Projection root r2' },
          type: 'update-object'
        }
      ]
    })
    const revisedSurface = updated.workspace.objects[ROOT_ID]
    if (revisedSurface?.type !== 'surface-run') throw new Error('revised surface missing')

    expect(revisedSurface.revision).toBe(2)
    expect(Object.keys(updated.workspace.views).toSorted()).toEqual(previousViewIds)
    for (const view of Object.values(updated.workspace.views)) {
      expect(view.experienceProjection?.rootSurface).toEqual(ref(ROOT_ID, 2))
      expect(view.revision).toBe((previousViewRevisions[view.id] ?? 0) + 1)
      expect(view.updatedAt).toBe(revisedSurface.updatedAt)
      expect(view.lastWorkspaceRevision).toBe(updated.workspace.revision)
    }
    expect(updated.workspace.views['view-purpose-review']?.lifecycle).toBe('archived')
    expect(updated.result.affectedStableIds).toEqual(
      expect.arrayContaining([ROOT_ID, ...previousViewIds])
    )
    expect(deserializeWorkspace(serializeWorkspace(updated.workspace))).toEqual(updated.workspace)
    expect(resolveExperienceProjections(updated.workspace, ref(ROOT_ID, 2)).rootSurface).toEqual(
      ref(ROOT_ID, 2)
    )
    expect(() => resolveExperienceProjections(updated.workspace, ref(ROOT_ID))).toThrow(
      'exact surface-run revision'
    )
  })
})

describe('pure experience projection resolution', () => {
  test('returns deterministic bounded roles and a companion-backed compare basis', () => {
    const workspace = projectionWorkspace({ companionCount: 1 })
    const result = resolveExperienceProjections(workspace, ref(ROOT_ID))

    expect(result.availablePurposes).toEqual(['focus', 'compare', 'knowledge', 'review'])
    expect(result.comparison).toEqual({
      basis: 'companion-surfaces',
      companionSurfaces: [ref(COMPANION_ID)],
      modeId: undefined,
      status: 'available'
    })
    expect(result.members.focus).toEqual([
      { ...ref(ROOT_ID), role: 'root-surface' },
      { ...ref(INTENT_ID), role: 'intent' },
      { ...ref(EVIDENCE_ID), role: 'evidence-manifest' }
    ])
    expect(result.members.compare.map(({ objectId, role }) => [objectId, role])).toEqual([
      [ROOT_ID, 'root-surface'],
      [COMPANION_ID, 'companion-surface'],
      [INTENT_ID, 'intent'],
      [EVIDENCE_ID, 'evidence-manifest'],
      [BINDING_ID, 'surface-binding'],
      ['review-projection-root', 'review-object']
    ])
    for (const purpose of result.availablePurposes) {
      expect(result.members[purpose].some((item) => item.objectId === UNRELATED_ID)).toBe(false)
    }
  })

  test('reports an honest unavailable compare projection without leaking unrelated objects', () => {
    const workspace = projectionWorkspace()
    const result = resolveExperienceProjections(workspace, ref(ROOT_ID))

    expect(result.availablePurposes).toEqual(['focus', 'knowledge', 'review'])
    expect(result.comparison).toEqual({
      basis: 'none',
      companionSurfaces: [],
      reason: 'no-companion-or-renderer-compare-mode',
      status: 'unavailable'
    })
    expect(result.members.compare).toEqual([])
    expect(
      Object.values(result.members)
        .flat()
        .some((item) => item.objectId === UNRELATED_ID)
    ).toBe(false)
  })

  test('uses an explicit renderer compare mode when no companion exists', () => {
    const workspace = projectionWorkspace({ rendererCompare: true })
    const result = resolveExperienceProjections(workspace, ref(ROOT_ID))

    expect(result.comparison).toEqual({
      basis: 'renderer-mode',
      companionSurfaces: [],
      modeId: 'mode-compare',
      status: 'available'
    })
    expect(result.availablePurposes).toContain('compare')
  })

  test('applies deterministic hard density bounds when lineage objects overflow', () => {
    const workspace = projectionWorkspace({
      bindingCount: 6,
      companionCount: 4,
      reviewCount: 5
    })
    const first = resolveExperienceProjections(workspace, ref(ROOT_ID))
    const replay = resolveExperienceProjections(workspace, ref(ROOT_ID))

    expect(replay).toEqual(first)
    expect(first.members.focus).toHaveLength(3)
    expect(first.members.compare).toHaveLength(8)
    expect(first.comparison.companionSurfaces).toEqual([ref(COMPANION_ID)])
    expect(first.members.compare.map((item) => item.objectId)).toEqual([
      ROOT_ID,
      COMPANION_ID,
      INTENT_ID,
      EVIDENCE_ID,
      BINDING_ID,
      `${BINDING_ID}-02`,
      `${BINDING_ID}-03`,
      `${BINDING_ID}-04`
    ])
    expect(first.members.knowledge).toHaveLength(8)
    expect(first.members.knowledge.map((item) => item.objectId)).toEqual([
      INTENT_ID,
      EVIDENCE_ID,
      ROOT_ID,
      COMPANION_ID,
      'surface-projection-companion-02',
      'review-projection-root-05',
      'review-projection-root-04',
      'review-projection-root-03'
    ])
    expect(first.members.review.map((item) => item.objectId)).toEqual([
      ROOT_ID,
      COMPANION_ID,
      INTENT_ID,
      EVIDENCE_ID,
      'review-projection-root-05'
    ])
  })
})
