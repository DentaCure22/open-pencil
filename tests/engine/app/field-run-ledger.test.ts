import { createEditorStore } from '@/app/editor/session'
import {
  getPreparedFieldRun,
  prepareFieldRun,
  prepareFieldRunForStore,
  preparedFieldRunSummaries,
  readPreparedFieldRuns,
  recordFieldRunAttemptEnded,
  recordFieldRunAttemptEndedForStore,
  recordFieldRunAttemptStarted,
  recordFieldRunAttemptStartedForStore,
  type PrepareFieldRunInput,
} from '@/app/field-sessions'
import { ObservedHumanSessionAuthority } from '@/app/human-sessions'
import { humanLearningReviewDigest } from '@/app/learning-receipts'
import {
  applyWorkspaceMutation,
  createEvidenceManifest,
  createIntentRecord,
  createKnowledgeWorkspace,
  createLearningReceipt,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceView,
  getKnowledgeWorkspace,
  replaceKnowledgeWorkspace,
  workspaceRegistry,
} from '@/app/workspace'
import {
  deserializeSceneGraph,
  serializeSceneGraph,
} from '@open-pencil/core/kiwi'
import { beforeEach, describe, expect, test } from 'bun:test'

function preparation(
  overrides: Partial<PrepareFieldRunInput> = {}
): PrepareFieldRunInput {
  return {
    boardId: 'board-field-run',
    preparedAt: '2026-07-14T21:00:00.000Z',
    projectionPageId: 'page-field-review',
    projectionViewId: 'view-field-review',
    purpose: 'review',
    rootSurface: { objectId: 'surface-field-root', revision: 1 },
    runCode: 'B31-S01',
    target: {
      artifact: {
        artifactId: 'artifact-field-run',
        boardId: 'board-field-run',
        boardRevision: 4,
        boardSchemaVersion: 4,
        kind: 'html-board',
        sourceHash: 'fnv1a-field-run',
      },
      evidenceManifest: { objectId: 'evidence-field-run', revision: 1 },
      intent: { objectId: 'intent-field-run', revision: 1 },
      surfaceRun: { objectId: 'surface-field-root', revision: 1 },
    },
    targetPageId: 'page-field-base',
    ...overrides,
  }
}

function installEligibleWorkspace(store: ReturnType<typeof createEditorStore>) {
  const pageId = store.state.currentPageId
  const initial = createKnowledgeWorkspace({
    documentId: store.graph.rootId,
    id: 'workspace-field-run',
    name: 'Prepared field run',
    now: '2026-07-14T21:00:00.000Z',
    pageId,
  })
  const context = createWorkspaceContext(initial, {
    now: '2026-07-14T21:00:00.000Z',
  })
  const intent = createIntentRecord(context, {
    capturedAt: '2026-07-14T21:00:00.000Z',
    desiredOutcome: 'Test one exact prepared human handoff.',
    id: 'intent-field-run',
    statement: 'Use the prepared experience and report whether it helped.',
  })
  const evidence = createEvidenceManifest(context, {
    id: 'evidence-field-run',
    intent: { objectId: intent.id, revision: 1 },
    items: [],
    snapshotAt: '2026-07-14T21:00:00.000Z',
  })
  const surface = createSurfaceRun(context, {
    artifact: preparation().target.artifact,
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formRationale: 'Use an exact executable field surface.',
    id: 'surface-field-root',
    intent: { objectId: intent.id, revision: 1 },
    name: 'Prepared field surface',
    recommendations: [],
  })
  const view = createWorkspaceView({
    experienceProjection: {
      purpose: 'review',
      rootSurface: { objectId: surface.id, revision: 1 },
    },
    id: 'view-field-review',
    kind: 'review',
    name: 'Prepared field review',
    workspaceId: initial.id,
  })
  replaceKnowledgeWorkspace(
    applyWorkspaceMutation(initial, {
      dryRun: false,
      expectedRevision: 0,
      idempotencyKey: 'install-field-run-fixture',
      operations: [
        { object: intent, type: 'create-object' },
        { object: evidence, type: 'create-object' },
        { object: surface, type: 'create-object' },
        { type: 'create-view', view },
      ],
    }).workspace
  )
  store.graph.createNodeWithId('board-field-run', 'FRAME', pageId, {
    height: 720,
    name: 'Prepared field board',
    width: 1120,
    x: 80,
    y: 80,
  })
  const page = store.graph.getNode(pageId)
  if (!page) throw new Error('field-run fixture page missing')
  store.graph.updateNode(pageId, {
    pluginData: [
      ...page.pluginData,
      {
        key: 'kind',
        pluginId: 'openpencil-knowledge-workspace',
        value: 'workspace-projection-page',
      },
      {
        key: 'workspaceId',
        pluginId: 'openpencil-knowledge-workspace',
        value: initial.id,
      },
      {
        key: 'basePageId',
        pluginId: 'openpencil-knowledge-workspace',
        value: pageId,
      },
      {
        key: 'experiencePurpose',
        pluginId: 'openpencil-knowledge-workspace',
        value: 'review',
      },
      {
        key: 'viewId',
        pluginId: 'openpencil-knowledge-workspace',
        value: view.id,
      },
    ],
  })
  return preparation({ projectionPageId: pageId, targetPageId: pageId })
}

beforeEach(() => workspaceRegistry.clear())

describe('Prepared field-run ledger', () => {
  test('persists a v2 exact family scope while leaving v1 byte-compatible', () => {
    const store = createEditorStore()
    const legacy = preparation()
    const primary = {
      artifact: legacy.target.artifact,
      formKind: 'record-explorer' as const,
      instanceId: 'primary-1',
      rendererId: 'record-explorer-v1',
      role: 'primary' as const,
      surfaceIndex: 0,
      surfaceRun: legacy.target.surfaceRun,
    }
    const support = {
      artifact: {
        ...legacy.target.artifact,
        artifactId: 'artifact-field-support',
        boardId: 'board-field-support',
      },
      formKind: 'evidence-brief' as const,
      instanceId: 'support-1',
      relation: { relationId: 'relation-field-support', revision: 1 },
      rendererId: 'evidence-brief-v1',
      role: 'support' as const,
      surfaceIndex: 1,
      surfaceRun: { objectId: 'surface-field-support', revision: 1 },
    }
    const family = {
      complete: true as const,
      compositionId: 'composition-field-family',
      evidenceManifest: legacy.target.evidenceManifest,
      familyDigest: 'fnv1a-field-family',
      intent: legacy.target.intent,
      members: [primary, support],
      primary,
      recipeDigest: 'fnv1a-field-recipe',
      relations: [support.relation],
      schemaVersion: 1 as const,
      supports: [support],
      surfaceCount: 2,
    }
    const created = prepareFieldRun(store.graph, {
      ...legacy,
      scope: { family, kind: 'experience-family', schemaVersion: 1 },
    })
    expect(created.run).toMatchObject({
      scope: { family: { surfaceCount: 2 }, kind: 'experience-family' },
      version: 2,
    })
    const reloaded = deserializeSceneGraph(
      structuredClone(serializeSceneGraph(store.graph))
    )
    expect(readPreparedFieldRuns(reloaded)).toEqual([created.run])

    expect(() =>
      prepareFieldRun(store.graph, {
        ...legacy,
        runCode: 'B31-BAD',
        scope: {
          family: {
            ...family,
            primary: { ...primary, surfaceRun: support.surfaceRun },
          },
          kind: 'experience-family',
          schemaVersion: 1,
        },
      })
    ).toThrow('field_run_target_invalid')
  })

  test('persists an exact non-evidentiary handoff without participant or key material', () => {
    const store = createEditorStore()
    const created = prepareFieldRun(store.graph, preparation())
    expect(created.created).toBe(true)
    expect(created.run).toMatchObject({
      attempts: [],
      runCode: 'B31-S01',
      version: 1,
    })

    const serialized = serializeSceneGraph(store.graph)
    const text = JSON.stringify(serialized)
    expect(text).not.toContain('participantAlias')
    expect(text).not.toContain('actorId')
    expect(text).not.toContain('privateKey')

    const reloaded = deserializeSceneGraph(structuredClone(serialized))
    expect(readPreparedFieldRuns(reloaded)).toEqual([created.run])
    expect(getPreparedFieldRun(reloaded, 'B31-S01')).toEqual(created.run)
  })

  test('replays the same run and refuses run-code reuse for another target', () => {
    const store = createEditorStore()
    const first = prepareFieldRun(store.graph, preparation())
    const replay = prepareFieldRun(
      store.graph,
      preparation({ preparedAt: '2026-07-14T22:00:00Z' })
    )
    expect(replay).toEqual({ created: false, run: first.run })
    expect(readPreparedFieldRuns(store.graph)).toHaveLength(1)

    expect(() =>
      prepareFieldRun(
        store.graph,
        preparation({
          boardId: 'board-other',
          target: {
            ...preparation().target,
            artifact: {
              ...preparation().target.artifact,
              boardId: 'board-other',
            },
          },
        })
      )
    ).toThrow('field_run_code_conflict')
  })

  test('records attempts without identity and turns an abandoned open attempt into interruption', () => {
    const store = createEditorStore()
    prepareFieldRun(store.graph, preparation())
    const first = recordFieldRunAttemptStarted(store.graph, {
      runCode: 'B31-S01',
      sessionId: 'human-session_first',
      startedAt: '2026-07-14T21:01:00.000Z',
    })
    expect(first.run.attempts).toEqual([
      {
        sessionId: 'human-session_first',
        startedAt: '2026-07-14T21:01:00.000Z',
      },
    ])

    const second = recordFieldRunAttemptStarted(store.graph, {
      runCode: 'B31-S01',
      sessionId: 'human-session_second',
      startedAt: '2026-07-14T21:05:00.000Z',
    })
    expect(second.run.attempts).toEqual([
      {
        endedAt: '2026-07-14T21:05:00.000Z',
        result: 'interrupted',
        sessionId: 'human-session_first',
        startedAt: '2026-07-14T21:01:00.000Z',
      },
      {
        sessionId: 'human-session_second',
        startedAt: '2026-07-14T21:05:00.000Z',
      },
    ])

    const ended = recordFieldRunAttemptEnded(store.graph, {
      endedAt: '2026-07-14T21:06:00.000Z',
      result: 'aborted',
      runCode: 'B31-S01',
      sessionId: 'human-session_second',
    })
    expect(ended.run.attempts.at(-1)).toMatchObject({
      endedAt: '2026-07-14T21:06:00.000Z',
      result: 'aborted',
    })
  })

  test('filters malformed stored data instead of treating it as a prepared run', () => {
    const store = createEditorStore()
    const root = store.graph.getNode(store.graph.rootId)
    if (!root) throw new Error('test root missing')
    store.graph.updateNode(root.id, {
      pluginData: [
        {
          key: 'prepared-runs-v1',
          pluginId: 'openpencil-field-runs',
          value: JSON.stringify([{ runCode: 'forged', version: 1 }]),
        },
      ],
    })
    expect(readPreparedFieldRuns(store.graph)).toEqual([])
  })

  test('requires a durable target before preparation and replays without extra history', async () => {
    const unprepared = createEditorStore()
    await expect(
      prepareFieldRunForStore(unprepared, preparation())
    ).rejects.toThrow('field_run_persistence_not_ready')
    expect(readPreparedFieldRuns(unprepared.graph)).toEqual([])
    expect(unprepared.undo.canUndo).toBe(false)

    const prepared = createEditorStore()
    const eligible = installEligibleWorkspace(prepared)
    let saves = 0
    prepared.getWritableDocumentSource = () => ({
      kind: 'browser-file-handle',
      label: 'Prepared field-run.fig',
    })
    prepared.persistWritableDocumentSource = async () => {
      saves += 1
      return true
    }
    const created = await prepareFieldRunForStore(prepared, eligible)
    expect(created.created).toBe(true)
    expect(saves).toBe(1)
    expect(prepared.undo.canUndo).toBe(true)

    const replay = await prepareFieldRunForStore(prepared, {
      ...eligible,
      preparedAt: '2026-07-14T23:00:00.000Z',
    })
    expect(replay.created).toBe(false)
    expect(saves).toBe(1)
  })

  test('derives prepared, active, interrupted, and aborted states without a completion flag', async () => {
    const store = createEditorStore()
    const eligible = installEligibleWorkspace(store)
    store.getWritableDocumentSource = () => ({
      kind: 'browser-file-handle',
      label: 'Prepared field-run.fig',
    })
    store.persistWritableDocumentSource = async () => true
    await prepareFieldRunForStore(store, eligible)
    expect((await preparedFieldRunSummaries(store))[0]?.status).toBe('prepared')

    await recordFieldRunAttemptStartedForStore(store, {
      runCode: 'B31-S01',
      sessionId: 'human-session_started',
      startedAt: '2026-07-14T21:01:00.000Z',
    })
    const activeSession = {
      actorId: 'must-not-be-persisted',
      dataPolicy: 'phi-free-declared-v1' as const,
      fieldSessionId: 'field-session_B31-S01',
      interactionCount: 0,
      sessionId: 'human-session_started',
      startedAt: '2026-07-14T21:01:00.000Z',
      status: 'active' as const,
      target: eligible.target,
    }
    expect(
      (await preparedFieldRunSummaries(store, { session: activeSession }))[0]
        ?.status
    ).toBe('active')
    expect((await preparedFieldRunSummaries(store))[0]?.status).toBe(
      'interrupted'
    )

    await recordFieldRunAttemptEndedForStore(store, {
      endedAt: '2026-07-14T21:02:00.000Z',
      result: 'aborted',
      runCode: 'B31-S01',
      sessionId: 'human-session_started',
    })
    expect((await preparedFieldRunSummaries(store))[0]?.status).toBe('aborted')
    expect(JSON.stringify(serializeSceneGraph(store.graph))).not.toContain(
      'must-not-be-persisted'
    )
  })

  test('marks completion only from a matching cryptographically reverified receipt', async () => {
    const store = createEditorStore()
    const eligible = installEligibleWorkspace(store)
    store.getWritableDocumentSource = () => ({
      kind: 'browser-file-handle',
      label: 'Prepared field-run.fig',
    })
    store.persistWritableDocumentSource = async () => true
    await prepareFieldRunForStore(store, eligible)
    const workspace = getKnowledgeWorkspace(
      store.graph.rootId,
      eligible.targetPageId
    )
    if (!workspace) throw new Error('field-run workspace missing')
    const context = createWorkspaceContext(workspace, {
      now: '2026-07-14T21:10:00.000Z',
    })
    const receipt = createLearningReceipt(context, {
      attestation: {
        attestedAt: '2026-07-14T21:10:05.000Z',
        attestedBy: 'P01',
        kind: 'self-report',
      },
      comparisonOutcome: 'better',
      decisionReceipt: { objectId: 'decision-field-run', revision: 1 },
      durableOutcome: true,
      evidenceManifest: eligible.target.evidenceManifest,
      evidenceTraceable: true,
      executionKind: 'human',
      formDisposition: 'accepted',
      formId: 'decision',
      id: 'learning-receipt-field-run',
      intent: eligible.target.intent,
      intentCompleted: true,
      keyboardAccepted: true,
      occurredAt: '2026-07-14T21:10:04.000Z',
      outcome: 'passed',
      recordedAt: '2026-07-14T21:10:05.000Z',
      recordedBy: 'P01',
      rendererId: 'weekly-decision-v1',
      repairCount: 0,
      runId: 'field-run-review-B31-S01',
      safetyViolation: false,
      surfaceRun: eligible.target.surfaceRun,
      visualAccepted: true,
    })
    let now = Date.parse('2026-07-14T21:10:00.000Z')
    const authority = new ObservedHumanSessionAuthority({
      crypto,
      hasFocus: () => true,
      hasUserActivation: () => true,
      isAutomated: () => false,
      isVisible: () => true,
      now: () => now,
    })
    await authority.start({
      actorId: receipt.recordedBy,
      dataPolicy: 'phi-free-declared-v1',
      fieldSessionId: 'field-session_B31-S01',
      target: eligible.target,
    })
    now += 1_000
    authority.recordTaskInteraction({
      after: { artifactRevision: 5, surfaceRevision: 2 },
      before: { artifactRevision: 4, surfaceRevision: 1 },
      eventId: 'task-event-field-run',
      frameId: eligible.boardId,
      kind: 'pointerdown',
      occurredAt: new Date(now).toISOString(),
      surfaceRunId: eligible.target.surfaceRun.objectId,
    })
    now += 4_000
    const proof = await authority.issue({
      actorId: receipt.recordedBy,
      decisionReceiptId: receipt.decisionReceipt?.objectId ?? '',
      occurredAt: receipt.occurredAt,
      recordedAt: receipt.recordedAt,
      reviewDigest: await humanLearningReviewDigest(receipt),
      runId: receipt.runId,
      surfaceRunId: receipt.surfaceRun.objectId,
    })
    const attestation = await authority.verify(proof, proof.claim)
    const forged = {
      ...receipt,
      attestation: {
        ...attestation,
        proof: attestation.proof
          ? { ...attestation.proof, signature: 'forged' }
          : undefined,
      },
      revision: 1,
    }
    replaceKnowledgeWorkspace({
      ...workspace,
      objects: { ...workspace.objects, [forged.id]: forged },
    })
    expect((await preparedFieldRunSummaries(store))[0]?.status).toBe('prepared')

    const observed = { ...receipt, attestation, revision: 1 }
    replaceKnowledgeWorkspace({
      ...workspace,
      objects: { ...workspace.objects, [observed.id]: observed },
    })
    expect((await preparedFieldRunSummaries(store))[0]).toMatchObject({
      receiptId: observed.id,
      status: 'verified-completed',
    })
  })
})
