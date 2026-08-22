import { afterEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  TraceHistorySession,
  TraceQueryRecordSummary,
  TraceQuerySpokenTurn
} from '@open-pencil/core/rpc'

import type { LocalWorkspaceTraceGesture } from '#mcp/local-workspace-authority/trace'
import {
  LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT,
  LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT,
  LocalWorkspaceTraceFileStore
} from '#mcp/local-workspace-authority/trace-file-store'

const roots: string[] = []
const scope = {
  documentId: 'document:trace-file',
  pageId: 'page:trace-file',
  workspaceId: 'workspace:trace-file'
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-trace-file-store-'))
  roots.push(root)
  return root
}

function traceSession(): TraceHistorySession {
  return {
    durationMs: 1_000,
    events: [
      {
        anchor: { pageRegion: { height: 80, width: 120, x: 40, y: 60 } },
        atMs: 200,
        evidence: { evidenceId: 'evidence:focus' },
        id: 'gesture:focus',
        kind: 'ink',
        label: 'Focus exact title',
        target: {
          frameId: 'frame:code-object',
          name: 'Exact title',
          path: ['Board', 'Card', 'Exact title'],
          route: '/patients/overview',
          stableId: 'leaf:exact-title'
        }
      }
    ],
    id: 'session:trace-file',
    scope,
    startedAt: '2026-08-21T12:00:00.000Z'
  }
}

function traceSummary(): TraceQueryRecordSummary {
  return {
    durationMs: 1_000,
    id: 'session:trace-file',
    scope,
    startedAt: '2026-08-21T12:00:00.000Z',
    targetIds: ['leaf:exact-title'],
    title: 'Focus exact title'
  }
}

function traceGesture(
  gestureId = 'gesture:focus',
  overrides: { evidenceId?: string; primaryTargetId?: string; truncated?: boolean } = {}
): LocalWorkspaceTraceGesture {
  return {
    boardOrigin: {
      contentDocumentId: scope.documentId,
      documentId: scope.documentId,
      pageId: scope.pageId,
      runtimeInstanceId: 'local-authority:trace-file-test',
      workspaceId: scope.workspaceId
    },
    candidates: {
      count: 2,
      items: [
        { ownerId: 'frame:card-owner', stableId: 'leaf:exact-title' },
        { stableId: 'frame:other-card' }
      ],
      primaryTargetId: overrides.primaryTargetId ?? 'leaf:exact-title',
      truncated: overrides.truncated ?? false
    },
    capturedAt: '2026-08-21T12:00:00.200Z',
    contract: 'trace-gesture-agent/v1',
    evidence: {
      evidenceId: overrides.evidenceId ?? 'evidence:focus',
      mimeType: 'image/png'
    },
    geometry: {
      kind: 'focus',
      pageRegion: { height: 80, width: 120, x: 40, y: 60 }
    },
    gestureId,
    sessionId: 'session:trace-file'
  }
}

function spokenTurn(id = 'spoken-turn:trace-file', sequence = 1): TraceQuerySpokenTurn {
  const startedAtEpochMs = Date.parse('2026-08-21T12:00:00.100Z') + sequence
  return {
    endedAt: new Date(startedAtEpochMs + 400).toISOString(),
    endedAtEpochMs: startedAtEpochMs + 400,
    id,
    runtimeTabBindingId: 'runtime-tab:trace-file',
    scope: { ...scope, workspaceId: scope.workspaceId },
    sequence,
    startedAt: new Date(startedAtEpochMs).toISOString(),
    startedAtEpochMs,
    text: `Focus this title ${String(sequence)}`
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('file-native Trace persistence', () => {
  test('appends typed JSONL records and rotates without rewriting closed segments', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({ maxSegmentBytes: 1, root })

    const sessionReceipt = await store.appendSession({
      session: traceSession(),
      summary: traceSummary()
    })
    expect(sessionReceipt).toMatchObject({ recordCount: 1 })
    const firstSegment = sessionReceipt.segmentPaths[0]
    const firstContents = await readFile(firstSegment, 'utf8')

    await store.appendGestures([traceGesture()])
    await store.appendSpokenTurns([spokenTurn()])

    const segments = await store.listEventSegments()
    expect(segments.map((segment) => path.basename(segment))).toEqual([
      'events-00000001.jsonl',
      'events-00000002.jsonl',
      'events-00000003.jsonl'
    ])
    expect(await readFile(firstSegment, 'utf8')).toBe(firstContents)

    const records = await store.readEvents()
    expect(records.map((record) => record.recordType)).toEqual([
      'session',
      'gesture',
      'spoken-turn'
    ])
    expect(
      records.every((record) => record.contract === LOCAL_WORKSPACE_TRACE_EVENT_CONTRACT)
    ).toBe(true)
    const sessionRecord = records[0]
    const gestureRecord = records[1]
    expect(sessionRecord?.recordType).toBe('session')
    expect(gestureRecord?.recordType).toBe('gesture')
    if (sessionRecord?.recordType !== 'session' || gestureRecord?.recordType !== 'gesture') {
      throw new Error('Expected session and gesture records')
    }
    expect(sessionRecord.evidence[0]?.path).toBe(gestureRecord.evidence?.path)
    expect(sessionRecord.evidence[0]?.path).toStartWith(path.join(root, 'trace-evidence'))
  })

  test('writes separate PNG evidence and atomically projects precise current targets', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({ root })
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const evidence = await store.writeEvidence({
      bytes,
      evidenceId: '../../evidence:focus',
      mimeType: 'image/png'
    })
    const gesture = traceGesture('gesture:precise', {
      evidenceId: '../../evidence:focus'
    })

    const context = await store.writeCurrentContext({
      gesture,
      pageName: 'Trace file Board',
      workspaceRevision: 12
    })

    expect(context).toMatchObject({
      contract: LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT,
      evidence: { path: evidence.path, status: 'ready' },
      gesture_id: 'gesture:precise',
      scope: { page_name: 'Trace file Board' },
      status: 'ready',
      targets: {
        items: [
          { owner_id: 'frame:card-owner', stable_id: 'leaf:exact-title' },
          { stable_id: 'frame:other-card' }
        ],
        primary_stable_id: 'leaf:exact-title'
      },
      workspace_revision: 12
    })
    expect(path.dirname(evidence.path)).toBe(path.join(root, 'trace-evidence'))
    expect(path.basename(evidence.path)).not.toContain('..')
    expect((await store.readEvidence('../../evidence:focus'))?.bytes).toEqual(bytes)
    expect(await store.readCurrentContext()).toEqual(context)
    expect((await stat(store.currentContextPath)).mode & 0o777).toBe(0o600)
    expect((await readdir(root)).some((fileName) => fileName.endsWith('.tmp'))).toBe(false)
  })

  test('evicts the oldest unpinned evidence by capture count and releases task pins', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({
      maxEvidenceBytes: 100,
      maxEvidenceCount: 2,
      root
    })

    await store.writeEvidence({
      bytes: new Uint8Array([1]),
      evidenceId: 'evidence:pinned',
      mimeType: 'image/png'
    })
    expect(await store.pinEvidence('evidence:pinned', 'agent-thread:active')).toBe('pinned')
    await store.writeEvidence({
      bytes: new Uint8Array([2]),
      evidenceId: 'evidence:oldest-unpinned',
      mimeType: 'image/png'
    })
    await store.writeEvidence({
      bytes: new Uint8Array([3]),
      evidenceId: 'evidence:newest',
      mimeType: 'image/png'
    })

    expect(await store.evidenceStatus('evidence:pinned')).toBe('ready')
    expect(await store.evidenceStatus('evidence:oldest-unpinned')).toBe('evicted')
    expect(await store.readEvidence('evidence:oldest-unpinned')).toBeNull()
    expect(
      await store.evidenceOverview([
        'evidence:pinned',
        'evidence:oldest-unpinned',
        'evidence:newest'
      ])
    ).toMatchObject({
      contract: 'trace-evidence-overview/v1',
      evidence: {
        'evidence:newest': { pinned: false, status: 'ready' },
        'evidence:oldest-unpinned': { pinned: false, status: 'evicted' },
        'evidence:pinned': { pinned: true, status: 'ready' }
      },
      limits: { bytes: 100, count: 2 },
      usage: {
        bytes: 2,
        count: 2,
        evictableCount: 1,
        evictedCount: 1,
        pinnedCount: 1
      }
    })
    expect(await store.releaseEvidencePins('agent-thread:active')).toBe(1)

    await store.writeEvidence({
      bytes: new Uint8Array([4]),
      evidenceId: 'evidence:after-release',
      mimeType: 'image/png'
    })
    expect(await store.evidenceStatus('evidence:pinned')).toBe('evicted')
    expect(await store.evidenceStatus('evidence:newest')).toBe('ready')
    expect(await store.evidenceStatus('evidence:after-release')).toBe('ready')
  })

  test('deduplicates identical captures by content hash before applying the byte limit', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({
      maxEvidenceBytes: 4,
      maxEvidenceCount: 10,
      root
    })
    const duplicateBytes = new Uint8Array([1, 2, 3])

    const first = await store.writeEvidence({
      bytes: duplicateBytes,
      evidenceId: 'evidence:duplicate-1',
      mimeType: 'image/png'
    })
    const second = await store.writeEvidence({
      bytes: duplicateBytes,
      evidenceId: 'evidence:duplicate-2',
      mimeType: 'image/png'
    })
    expect((await stat(first.path)).ino).toBe((await stat(second.path)).ino)
    expect(await store.evidenceStatus('evidence:duplicate-1')).toBe('ready')
    expect(await store.evidenceStatus('evidence:duplicate-2')).toBe('ready')
    expect((await store.evidenceOverview([])).usage.deduplicatedCount).toBe(1)

    await store.writeEvidence({
      bytes: new Uint8Array([4, 5, 6]),
      evidenceId: 'evidence:replacement',
      mimeType: 'image/png'
    })
    expect(await store.evidenceStatus('evidence:duplicate-1')).toBe('evicted')
    expect(await store.evidenceStatus('evidence:duplicate-2')).toBe('evicted')
    expect(await store.evidenceStatus('evidence:replacement')).toBe('ready')

    const restarted = new LocalWorkspaceTraceFileStore({
      maxEvidenceBytes: 4,
      maxEvidenceCount: 10,
      root
    })
    expect(await restarted.evidenceStatus('evidence:duplicate-1')).toBe('evicted')
    expect((await restarted.readEvidence('evidence:replacement'))?.bytes).toEqual(
      new Uint8Array([4, 5, 6])
    )
  })

  test('preserves an evicted evidence marker in the direct Trace context', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({
      maxEvidenceBytes: 100,
      maxEvidenceCount: 1,
      root
    })
    await store.writeEvidence({
      bytes: new Uint8Array([1]),
      evidenceId: 'evidence:focus',
      mimeType: 'image/png'
    })
    await store.writeEvidence({
      bytes: new Uint8Array([2]),
      evidenceId: 'evidence:newer',
      mimeType: 'image/png'
    })

    const context = await store.writeCurrentContext({ gesture: traceGesture() })
    expect(context.evidence?.status).toBe('evicted')
    expect(context.evidence?.evidence_id).toBe('evidence:focus')
  })

  test('marks truncated targeting ambiguous without replacing precise IDs with owners', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({ root })
    const context = await store.writeCurrentContext({
      gesture: traceGesture('gesture:truncated', {
        evidenceId: 'evidence:missing',
        truncated: true
      })
    })

    expect(context).toMatchObject({
      evidence: { status: 'missing' },
      reasons: ['candidate_list_truncated'],
      status: 'ambiguous',
      targets: {
        items: [
          { owner_id: 'frame:card-owner', stable_id: 'leaf:exact-title' },
          { stable_id: 'frame:other-card' }
        ],
        primary_stable_id: 'leaf:exact-title',
        truncated: true
      }
    })
  })

  test('projects a finished spoken turn without requiring a Trace session or gesture', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({ root })
    const turn = spokenTurn('spoken-turn:standalone', 7)

    const context = await store.writeCurrentContext({
      pageName: 'Standalone speech Board',
      spokenTurn: turn,
      workspaceRevision: 19
    })

    expect(context).toMatchObject({
      contract: LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT,
      scope: {
        page_id: scope.pageId,
        page_name: 'Standalone speech Board',
        workspace_id: scope.workspaceId
      },
      spoken_turn: {
        id: turn.id,
        runtime_tab_binding_id: turn.runtimeTabBindingId,
        sequence: turn.sequence,
        text: turn.text
      },
      status: 'ready',
      targets: { count: 0, items: [], truncated: false },
      workspace_revision: 19
    })
    expect(context).not.toHaveProperty('gesture_id')
  })

  test('serializes concurrent appends across store instances sharing one authority root', async () => {
    const root = await temporaryRoot()
    const first = new LocalWorkspaceTraceFileStore({ root })
    const second = new LocalWorkspaceTraceFileStore({ root })
    const turns = Array.from({ length: 40 }, (_, index) =>
      spokenTurn(`spoken-turn:${String(index)}`, index + 1)
    )

    await Promise.all(
      turns.map((turn, index) => (index % 2 === 0 ? first : second).appendSpokenTurns([turn]))
    )

    const records = await first.readEvents()
    expect(records).toHaveLength(turns.length)
    const turnIds = records.flatMap((record) =>
      record.recordType === 'spoken-turn' ? [record.spokenTurn.id] : []
    )
    expect(new Set(turnIds).size).toBe(turns.length)
    const segments = await first.listEventSegments()
    expect(segments).toHaveLength(1)
    const lines = (await readFile(segments[0], 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(turns.length)
    expect(lines.every((line) => JSON.parse(line) !== null)).toBe(true)
  })

  test('ignores only an interrupted newest tail and rotates before the next append', async () => {
    const root = await temporaryRoot()
    const store = new LocalWorkspaceTraceFileStore({ root })
    await store.appendSpokenTurns([spokenTurn('spoken-turn:before-crash', 1)])
    const firstSegment = (await store.listEventSegments())[0]
    if (!firstSegment) throw new Error('Expected a Trace event segment')
    await appendFile(firstSegment, '{"contract":"trace-file-event/v1"')

    await store.appendSpokenTurns([spokenTurn('spoken-turn:after-crash', 2)])

    expect((await store.listEventSegments()).map((file) => path.basename(file))).toEqual([
      'events-00000001.jsonl',
      'events-00000002.jsonl'
    ])
    expect(
      (await store.readEvents()).flatMap((event) =>
        event.recordType === 'spoken-turn' ? [event.spokenTurn.id] : []
      )
    ).toEqual(['spoken-turn:before-crash', 'spoken-turn:after-crash'])
  })

  test('serializes concurrent current-context replacements as complete atomic JSON', async () => {
    const root = await temporaryRoot()
    const first = new LocalWorkspaceTraceFileStore({ root })
    const second = new LocalWorkspaceTraceFileStore({ root })
    const firstGesture = traceGesture('gesture:first', { primaryTargetId: 'leaf:exact-title' })
    const secondGesture = traceGesture('gesture:second', { primaryTargetId: 'frame:other-card' })

    await Promise.all([
      first.writeCurrentContext({ gesture: firstGesture }),
      second.writeCurrentContext({ gesture: secondGesture })
    ])

    const context = JSON.parse(await readFile(first.currentContextPath, 'utf8')) as {
      gesture_id: string
      targets: { primary_stable_id: string }
    }
    const expectedPrimary =
      context.gesture_id === 'gesture:first' ? 'leaf:exact-title' : 'frame:other-card'
    expect(['gesture:first', 'gesture:second']).toContain(context.gesture_id)
    expect(context.targets.primary_stable_id).toBe(expectedPrimary)
    expect((await readdir(root)).some((fileName) => fileName.endsWith('.tmp'))).toBe(false)
  })
})
