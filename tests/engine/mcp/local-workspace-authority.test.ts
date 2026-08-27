import { describe, expect, test } from 'bun:test'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  LocalWorkspaceAuthorityStore,
  LocalWorkspaceAuthorityStoreError
} from '#mcp/local-workspace-authority/store'

import { useLocalWorkspaceAuthorityFixture } from './local-workspace-authority-fixture'

async function expectOneCompetingCommit(
  firstStore: LocalWorkspaceAuthorityStore,
  secondStore: LocalWorkspaceAuthorityStore,
  expectedContentHash: string
) {
  const results = await Promise.allSettled([
    firstStore.commit({
      document: { value: 'first-change' },
      expectedContentHash,
      expectedRevision: 1,
      requestId: 'commit-first',
      workspaceId: 'workspace-canonical'
    }),
    secondStore.commit({
      document: { value: 'second-change' },
      expectedContentHash,
      expectedRevision: 1,
      requestId: 'commit-second',
      workspaceId: 'workspace-canonical'
    })
  ])
  const winner = results.find((result) => result.status === 'fulfilled')
  const loser = results.find((result) => result.status === 'rejected')
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  if (!winner) throw new Error('Expected one winning commit')
  if (!loser) throw new Error('Expected one stale commit')
  expect(winner.value).toMatchObject({
    appliedRevision: 2,
    baseRevision: 1,
    status: 'committed'
  })
  expect(loser.reason).toMatchObject({
    code: 'stale_revision',
    currentRevision: 2
  })

  const expectedValue = winner.value.requestId === 'commit-first' ? 'first-change' : 'second-change'
  expect(await secondStore.head()).toMatchObject({
    document: { value: expectedValue },
    revision: 2
  })
}

const { createStore, trackRoot } = useLocalWorkspaceAuthorityFixture()

describe('local workspace authority', () => {
  test('creates one cold-start authority identity across many store instances', async () => {
    const container = await mkdtemp(path.join(tmpdir(), 'openpencil-local-authority-parent-'))
    trackRoot(container)
    const root = path.join(container, 'nested', 'authority')
    const stores = Array.from(
      { length: 24 },
      () =>
        new LocalWorkspaceAuthorityStore({
          preferredWorkspaceId: 'workspace-canonical',
          root
        })
    )

    const statuses = await Promise.all(
      stores.map(async (store, index) => {
        if (index % 2 === 1) expect(await store.head()).toBeNull()
        return store.status()
      })
    )
    expect(new Set(statuses.map((status) => status.authorityId)).size).toBe(1)
    expect(new Set(statuses.map((status) => status.identity.documentId)).size).toBe(1)
  })

  test('keeps one stable configured identity across server restarts', async () => {
    const { root, store } = await createStore()
    const first = await store.status()
    const restarted = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-canonical',
      root
    })
    const second = await restarted.status()

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      revision: 0,
      seedWorkspaceId: 'workspace-canonical',
      state: 'configured'
    })
    expect(first.identity.workspaceId).toBe('workspace-canonical')
  })

  test('persists compact Trace targets without changing the Board revision', async () => {
    const { root, store } = await createStore()
    await store.initialize({
      document: { nodes: ['canonical-copy'] },
      requestId: 'seed-trace',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const status = await store.status()
    const gesture = {
      boardOrigin: {
        contentDocumentId: status.identity.documentId,
        documentId: 'runtime-tab-that-may-restart',
        pageId: 'page:dental',
        runtimeInstanceId: 'runtime:browser-that-may-restart',
        workspaceId: status.identity.workspaceId
      },
      candidates: {
        count: 2,
        items: [{ stableId: 'card:first' }, { stableId: 'card:second' }],
        primaryTargetId: 'card:first',
        truncated: false
      },
      capturedAt: '2026-08-01T12:00:00.000Z',
      contract: 'trace-gesture-agent/v1',
      geometry: {
        kind: 'focus',
        pageRegion: { height: 80, width: 220, x: 100, y: 200 }
      },
      gestureId: 'gesture:persisted',
      sessionId: 'session:persisted'
    }
    await store.recordTraceSession({
      gestures: [gesture],
      session: {
        contextDraft: [],
        durationMs: 0,
        events: [
          {
            evidence: {
              evidenceId: 'evidence:persisted',
              image: { base64: 'must-not-be-persisted', mimeType: 'image/png' },
              mimeType: 'image/png'
            },
            id: gesture.gestureId
          }
        ],
        id: gesture.sessionId,
        startedAt: gesture.capturedAt
      },
      summary: {
        durationMs: 0,
        eventCount: 1,
        evidenceCount: 1,
        gestureCount: 1,
        gestureIds: [gesture.gestureId],
        id: gesture.sessionId,
        latestGestureAt: gesture.capturedAt,
        startedAt: gesture.capturedAt,
        title: 'Persisted Trace',
        updatedAt: gesture.capturedAt
      }
    })
    expect(await store.traceGesture({ includeImage: true, latest: true })).toMatchObject({
      gesture: {
        evidence: { evidenceId: 'evidence:persisted', mimeType: 'image/png' },
        imageStatus: 'missing'
      },
      status: 'matched'
    })
    await store.recordTraceEvidence({
      bytes: new Uint8Array([137, 80, 78, 71]),
      evidenceId: 'evidence:persisted',
      mimeType: 'image/png',
      sessionId: gesture.sessionId
    })

    const restarted = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-canonical',
      root
    })
    const compact = await restarted.traceGesture({ latest: true })
    expect(compact).toMatchObject({
      gesture: {
        boardOrigin: {
          contentDocumentId: status.identity.documentId,
          documentId: status.identity.documentId,
          pageId: 'page:dental',
          runtimeInstanceId: `local-authority:${status.authorityId}`,
          workspaceId: status.identity.workspaceId
        },
        candidates: {
          items: [{ stableId: 'card:first' }, { stableId: 'card:second' }],
          primaryTargetId: 'card:first'
        },
        evidence: { evidenceId: 'evidence:persisted', mimeType: 'image/png' },
        gestureId: 'gesture:persisted',
        imageStatus: 'not_requested'
      },
      scanned: { sessions: 1 },
      status: 'matched'
    })
    expect(JSON.stringify(compact)).not.toContain('must-not-be-persisted')
    expect(await restarted.traceGesture({ includeImage: true, latest: true })).toMatchObject({
      gesture: {
        evidence: {
          evidenceId: 'evidence:persisted',
          image: { base64: 'iVBORw==', mimeType: 'image/png' },
          mimeType: 'image/png'
        },
        imageStatus: 'included'
      },
      status: 'matched'
    })
    expect((await restarted.head())?.revision).toBe(1)
    expect(await restarted.traceSession('session:persisted')).toMatchObject({
      id: 'session:persisted',
      startedAt: gesture.capturedAt
    })
    expect(await restarted.traceSessionSummaries()).toMatchObject([
      {
        eventCount: 1,
        evidenceCount: 1,
        gestureCount: 1,
        gestureIds: [gesture.gestureId],
        id: 'session:persisted',
        latestGestureAt: gesture.capturedAt,
        startedAt: gesture.capturedAt,
        title: 'Persisted Trace',
        updatedAt: gesture.capturedAt
      }
    ])
    expect(await restarted.traceEvidence('evidence:persisted')).toEqual({
      bytes: new Uint8Array([137, 80, 78, 71]),
      mimeType: 'image/png'
    })
  })

  test('replaces and deletes all session-owned Trace records during JSONL replay', async () => {
    const { store } = await createStore()
    await store.initialize({
      document: { nodes: ['canonical-copy'] },
      requestId: 'seed-trace-replay',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const status = await store.status()
    const sessionId = 'session:replace'
    const startedAtEpochMs = Date.now() - 1_000
    const scope = {
      documentId: status.identity.documentId,
      pageId: 'page:replace',
      workspaceId: status.identity.workspaceId
    }
    const gesture = (gestureId: string, capturedAtEpochMs: number) => ({
      boardOrigin: {
        contentDocumentId: scope.documentId,
        pageId: scope.pageId,
        workspaceId: scope.workspaceId
      },
      candidates: { count: 1, items: [{ stableId: gestureId }], truncated: false },
      capturedAt: new Date(capturedAtEpochMs).toISOString(),
      contract: 'trace-gesture-agent/v1',
      geometry: {
        kind: 'focus',
        pageRegion: { height: 40, width: 80, x: 10, y: 20 }
      },
      gestureId,
      sessionId
    })
    const spokenTurn = (id: string, sequence: number, offsetMs: number) => ({
      endedAt: new Date(startedAtEpochMs + offsetMs + 200).toISOString(),
      endedAtEpochMs: startedAtEpochMs + offsetMs + 200,
      id,
      scope,
      sequence,
      startedAt: new Date(startedAtEpochMs + offsetMs).toISOString(),
      startedAtEpochMs: startedAtEpochMs + offsetMs,
      text: `Replace Trace turn ${String(sequence)}`
    })
    const persist = async (gestureId: string, turnId: string, sequence: number) => {
      const startedAt = new Date(startedAtEpochMs + sequence * 100).toISOString()
      await store.recordTraceSession({
        gestures: [gesture(gestureId, Date.parse(startedAt))],
        session: {
          contextDraft: [],
          durationMs: 500,
          events: [],
          id: sessionId,
          scope,
          startedAt
        },
        spokenTurns: [spokenTurn(turnId, sequence, sequence * 100)],
        summary: {
          durationMs: 500,
          id: sessionId,
          scope,
          startedAt,
          title: `Replacement ${String(sequence)}`,
          updatedAt: startedAt
        }
      })
    }

    await persist('gesture:old', 'spoken:old', 1)
    await persist('gesture:new', 'spoken:new', 2)

    expect(await store.traceGesture({ gestureId: 'gesture:old' })).toMatchObject({
      reason: 'gesture_not_found',
      status: 'empty'
    })
    expect(await store.traceGesture({ gestureId: 'gesture:new' })).toMatchObject({
      gesture: { gestureId: 'gesture:new' },
      status: 'matched'
    })
    expect((await store.traceSpokenTurns()).map((turn) => (turn as { id: string }).id)).toEqual([
      'spoken:new'
    ])
    expect(await store.deleteTraceSession(sessionId)).toBe(true)
    expect(await store.traceSession(sessionId)).toBeNull()
    expect(await store.traceGesture({ latest: true })).toMatchObject({ status: 'empty' })
    expect(await store.traceSpokenTurns()).toEqual([])
  })

  test('ignores the retired gesture sidecar instead of silently migrating it', async () => {
    const { root, store } = await createStore()
    await store.initialize({
      document: { nodes: ['canonical-copy'] },
      requestId: 'seed-legacy-trace',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const status = await store.status()
    const gesture = {
      boardOrigin: {
        contentDocumentId: status.identity.documentId,
        documentId: status.identity.documentId,
        pageId: 'page:legacy',
        runtimeInstanceId: `local-authority:${status.authorityId}`,
        workspaceId: status.identity.workspaceId
      },
      candidates: {
        count: 1,
        items: [{ stableId: 'card:legacy' }],
        truncated: false
      },
      capturedAt: '2026-08-01T12:00:00.000Z',
      contract: 'trace-gesture-agent/v1',
      geometry: {
        kind: 'focus',
        pageRegion: { height: 80, width: 220, x: 100, y: 200 }
      },
      gestureId: 'gesture:legacy',
      sessionId: 'session:legacy'
    }
    await writeFile(
      path.join(root, 'trace-gestures.json'),
      JSON.stringify({ gestures: [gesture], version: 1 })
    )

    expect(await store.traceGesture({ latest: true })).toEqual({
      reason: 'gesture_not_found',
      scanned: { sessions: 0 },
      status: 'empty'
    })
    expect(await store.traceSession(gesture.sessionId)).toBeNull()
  })

  test('accepts only the selected legacy workspace as the initial seed', async () => {
    const { store } = await createStore()

    await expect(
      store.initialize({
        document: { nodes: ['stale-copy'] },
        requestId: 'seed-stale',
        sourceWorkspaceId: 'workspace-other'
      })
    ).rejects.toMatchObject({
      code: 'seed_workspace_mismatch'
    })

    const receipt = await store.initialize({
      document: { nodes: ['canonical-copy'] },
      requestId: 'seed-canonical',
      sourceWorkspaceId: 'workspace-canonical'
    })

    expect(receipt).toMatchObject({
      appliedRevision: 1,
      baseRevision: 0,
      status: 'initialized',
      workspaceId: 'workspace-canonical'
    })
    expect(await store.head()).toMatchObject({
      document: { nodes: ['canonical-copy'] },
      revision: 1
    })
  })

  test('serializes commits, rejects stale writes, and replays request IDs once', async () => {
    const { root, store } = await createStore()
    const initialized = await store.initialize({
      document: { value: 'initial' },
      requestId: 'seed',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const request = {
      document: { value: 'chrome-change' },
      expectedContentHash: initialized.contentHash,
      expectedRevision: 1,
      requestId: 'commit-chrome',
      workspaceId: 'workspace-canonical'
    }

    const committed = await store.commit(request)
    const replayed = await store.commit(request)
    expect(committed).toEqual(replayed)
    expect(committed).toMatchObject({
      appliedRevision: 2,
      baseRevision: 1,
      status: 'committed'
    })

    await expect(
      store.commit({
        document: { value: 'stale-browser-copy' },
        expectedContentHash: initialized.contentHash,
        expectedRevision: 2,
        requestId: 'commit-stale-browser-base',
        workspaceId: 'workspace-canonical'
      })
    ).rejects.toMatchObject({
      code: 'stale_content_hash',
      currentRevision: 2
    })
    await expect(
      store.commit({
        document: { value: 'chrome-change' },
        expectedContentHash: initialized.contentHash,
        expectedRevision: 2,
        requestId: 'commit-stale-unchanged-base',
        workspaceId: 'workspace-canonical'
      })
    ).rejects.toMatchObject({
      code: 'stale_content_hash',
      currentRevision: 2
    })
    expect(await store.head()).toMatchObject({
      contentHash: committed.contentHash,
      document: { value: 'chrome-change' },
      revision: 2
    })

    try {
      await store.commit({
        document: { value: 'stale-codex-change' },
        expectedContentHash: initialized.contentHash,
        expectedRevision: 1,
        requestId: 'commit-codex-stale',
        workspaceId: 'workspace-canonical'
      })
      throw new Error('Expected the stale commit to be rejected')
    } catch (error) {
      expect(
        error instanceof LocalWorkspaceAuthorityStoreError &&
          error.code === 'stale_revision' &&
          error.currentRevision === 2
      ).toBe(true)
    }

    const restarted = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-canonical',
      root
    })
    expect(await restarted.head()).toMatchObject({
      document: { value: 'chrome-change' },
      revision: 2
    })
  })

  test('notifies subscribers only when a new authority head commits', async () => {
    const { store } = await createStore()
    const changes: number[] = []
    const unsubscribe = store.subscribeHeadCommitted((receipt) => {
      changes.push(receipt.appliedRevision)
    })
    const initialized = await store.initialize({
      document: { value: 'initial' },
      requestId: 'seed-notification',
      sourceWorkspaceId: 'workspace-canonical'
    })
    await store.initialize({
      document: { value: 'initial' },
      requestId: 'seed-notification',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const committed = await store.commit({
      document: { value: 'changed' },
      expectedContentHash: initialized.contentHash,
      expectedRevision: initialized.appliedRevision,
      requestId: 'commit-notification',
      workspaceId: 'workspace-canonical'
    })
    await store.commit({
      document: { value: 'changed' },
      expectedContentHash: initialized.contentHash,
      expectedRevision: initialized.appliedRevision,
      requestId: 'commit-notification',
      workspaceId: 'workspace-canonical'
    })
    unsubscribe()

    expect(changes).toEqual([initialized.appliedRevision, committed.appliedRevision])
  })

  test('serializes competing store instances that share one authority root', async () => {
    const { root, store: firstStore } = await createStore()
    const initialized = await firstStore.initialize({
      document: { value: 'initial' },
      requestId: 'seed',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const secondStore = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-canonical',
      root
    })

    await expectOneCompetingCommit(firstStore, secondStore, initialized.contentHash)
  })

  test('retains only the latest 64 full workspace snapshots', async () => {
    const { store } = await createStore()
    let receipt = await store.initialize({
      document: { value: 0 },
      requestId: 'seed-history',
      sourceWorkspaceId: 'workspace-canonical'
    })

    for (let value = 1; value <= 70; value += 1) {
      receipt = await store.commit({
        document: { value },
        expectedContentHash: receipt.contentHash,
        expectedRevision: receipt.appliedRevision,
        requestId: `commit-history-${value}`,
        workspaceId: 'workspace-canonical'
      })
    }

    expect(await store.headAtRevision(6)).toBeNull()
    expect(await store.headAtRevision(7)).toBeNull()
    expect(await store.headAtRevision(8)).toMatchObject({ document: { value: 7 }, revision: 8 })
    expect(await store.headAtRevision(70)).toMatchObject({ document: { value: 69 }, revision: 70 })
    expect(await store.head()).toMatchObject({ document: { value: 70 }, revision: 71 })
  })

  test('serializes competing commits through real and symlinked root aliases', async () => {
    const { root, store: realStore } = await createStore()
    const initialized = await realStore.initialize({
      document: { value: 'initial' },
      requestId: 'seed',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const aliasContainer = await mkdtemp(path.join(tmpdir(), 'openpencil-local-authority-alias-'))
    trackRoot(aliasContainer)
    const rootAlias = path.join(aliasContainer, 'authority')
    await symlink(root, rootAlias, 'dir')
    const aliasStore = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-canonical',
      root: rootAlias
    })

    await expectOneCompetingCommit(realStore, aliasStore, initialized.contentHash)
  })
})
