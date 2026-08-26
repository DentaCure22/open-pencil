import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  OBJECT_GRAPH_SCHEMA_VERSION,
  SceneGraph,
  setObjectGraphConnectionsOnPage
} from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument
} from '#mcp/local-workspace-authority/document'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []

type Fixture = Awaited<ReturnType<typeof fixture>>
type PersistedTraceSessionProof = {
  contextDraft?: Array<{ sourceEventId: string }>
  events?: Array<{ id: string }>
}

function savedDocument(graph: SceneGraph) {
  return {
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    images: [...graph.images],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    nodes: [...graph.nodes],
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables],
    version: 2
  }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-trace-query-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  page.name = 'Trace Board'
  const first = graph.createNode('FRAME', page.id, {
    height: 120,
    name: 'First card',
    width: 220,
    x: 100,
    y: 200
  })
  const nested = graph.createNode('TEXT', first.id, {
    name: 'Nested title',
    text: 'Nested title'
  })
  const second = graph.createNode('FRAME', page.id, {
    height: 120,
    name: 'Second card',
    width: 220,
    x: 460,
    y: 200
  })
  setObjectGraphConnectionsOnPage(graph, page.id, [
    {
      automatic: false,
      id: 'connection:trace-context',
      kind: 'visual',
      label: '',
      permissions: [],
      schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
      sourceNodeId: first.id,
      sourcePort: 'auto',
      targetNodeId: second.id,
      targetPort: 'auto'
    }
  ])
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-trace-query',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-trace-query',
    sourceWorkspaceId: 'workspace-trace-query'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected initialized local authority')
  return {
    first,
    head,
    nested,
    page,
    root,
    runtime: new LocalWorkspaceBoardRuntime(store),
    second,
    store
  }
}

async function persistSession(
  f: Fixture,
  input: {
    aliases?: string[]
    episodes?: unknown[]
    id: string
    origin?: unknown
    pageId: string
    spokenTurns?: unknown[]
    startedAt: string
    tag?: string
    text: string
  }
) {
  const scope = {
    documentId: f.head.identity.documentId,
    pageId: input.pageId,
    workspaceId: f.head.identity.workspaceId
  }
  const events = Array.from({ length: 8 }, (_, index) => ({
    atMs: 100 + index * 80,
    id: `${input.id}:event:${String(index)}`,
    kind: 'transcript',
    label: input.text,
    ...(input.origin ? { origin: input.origin } : {}),
    text: `${input.text} ${String(index)}`
  }))
  await f.store.recordTraceSession({
    gestures: [],
    session: {
      ...(input.aliases ? { aliases: input.aliases } : {}),
      contextDraft: [],
      durationMs: 1_000,
      ...(input.episodes ? { episodes: input.episodes } : {}),
      events,
      id: input.id,
      scope,
      startedAt: input.startedAt,
      ...(input.tag ? { tag: input.tag } : {})
    },
    spokenTurns: input.spokenTurns,
    summary: {
      durationMs: 1_000,
      eventCount: events.length,
      evidenceCount: 0,
      id: input.id,
      scope,
      searchTerms: input.text.toLowerCase().split(/\s+/u),
      startedAt: input.startedAt,
      ...(input.aliases ? { aliases: input.aliases } : {}),
      ...(input.tag ? { tag: input.tag } : {}),
      title: input.text,
      updatedAt: input.startedAt
    }
  })
}

type TraceQueryResult = {
  matches: Array<{
    episodes?: unknown[]
    events: unknown[]
    scope: { pageId: string }
    sessionId: string
    tag?: string
  }>
  reason?: string
  status: string
  taskCursor?: string
}

type TraceQueryResponse = { result?: TraceQueryResult }

function result(value: unknown): TraceQueryResult {
  if (!value || typeof value !== 'object') throw new Error('Expected RPC response')
  const payload = (value as TraceQueryResponse).result
  if (!payload || typeof payload !== 'object') throw new Error('Expected RPC result')
  return payload
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('persisted Trace history query', () => {
  test('pages a continuous activity timeline and preserves context rows', async () => {
    const f = await fixture()
    await persistSession(f, {
      id: 'session:older',
      pageId: f.page.id,
      startedAt: '2026-08-22T12:00:00.000Z',
      text: 'Older activity'
    })
    await persistSession(f, {
      id: 'session:newer',
      pageId: f.page.id,
      startedAt: '2026-08-22T13:00:00.000Z',
      text: 'Newer activity'
    })

    const first = await f.store.traceActivityPage({ limit: 5 })
    expect(first).toMatchObject({
      contract: 'trace-activity-page/v1',
      hasMore: true
    })
    expect(first.items).toHaveLength(5)
    expect(first.items.every((item) => item.sessionId === 'session:newer')).toBe(true)
    expect(first.nextCursor).toBeString()

    const second = await f.store.traceActivityPage({
      before: first.nextCursor ?? undefined,
      limit: 5
    })
    expect(second.items).toHaveLength(5)
    expect(
      second.items.every(
        (item) =>
          !first.items.some(
            (firstItem) =>
              firstItem.sessionId === item.sessionId && firstItem.event.id === item.event.id
          )
      )
    ).toBe(true)
    expect(second.items[0]?.occurredAtMs).toBeLessThan(first.items.at(-1)?.occurredAtMs ?? 0)

    const persisted = (await f.store.traceSession('session:newer')) as PersistedTraceSessionProof
    expect(persisted.contextDraft?.map((entry) => entry.sourceEventId)).toEqual(
      persisted.events?.map((event) => event.id)
    )
  })

  test('returns one compact current Board packet and opt-in persisted image', async () => {
    const f = await fixture()
    const capturedAt = '2026-08-02T12:00:00.000Z'
    const gestureId = 'gesture:compact'
    await f.store.recordTraceSession({
      gestures: [
        {
          boardOrigin: {
            contentDocumentId: f.head.identity.documentId,
            pageId: f.page.id,
            workspaceId: f.head.identity.workspaceId
          },
          candidates: {
            count: 3,
            items: [
              { stableId: f.first.id },
              { ownerId: f.first.id, stableId: f.nested.id },
              { stableId: f.second.id }
            ],
            primaryTargetId: f.nested.id,
            truncated: false
          },
          capturedAt,
          contract: 'trace-gesture-agent/v1',
          geometry: {
            kind: 'focus',
            pageRegion: { height: 220, width: 700, x: 60, y: 150 }
          },
          gestureId,
          sessionId: 'session:compact'
        }
      ],
      session: {
        contextDraft: [],
        durationMs: 0,
        events: [
          {
            evidence: { evidenceId: 'evidence:compact', mimeType: 'image/png' },
            id: gestureId
          }
        ],
        id: 'session:compact',
        startedAt: capturedAt
      },
      summary: {
        id: 'session:compact',
        startedAt: capturedAt,
        title: 'Compact Trace',
        updatedAt: capturedAt
      }
    })
    const directContextPath = path.join(f.root, 'trace-context.json')
    const beforeEvidence = JSON.parse(await readFile(directContextPath, 'utf8')) as {
      evidence: { path: string; status: string }
    }
    expect(beforeEvidence).toMatchObject({
      contract: 'trace-context/v2',
      evidence: { status: 'missing' },
      gesture_id: gestureId,
      status: 'ready'
    })
    await writeFile(directContextPath, '{"contract":"trace-context/v1"}\n')
    await f.store.head()
    expect(JSON.parse(await readFile(directContextPath, 'utf8'))).toMatchObject({
      contract: 'trace-context/v2',
      gesture_id: gestureId
    })
    await f.store.recordTraceEvidence({
      bytes: new Uint8Array([1, 2, 3]),
      evidenceId: 'evidence:compact',
      mimeType: 'image/png',
      sessionId: 'session:compact'
    })

    const directContext = JSON.parse(await readFile(directContextPath, 'utf8')) as {
      evidence: { path: string; status: string }
    }
    expect(directContext).toMatchObject({
      contract: 'trace-context/v2',
      evidence: {
        evidence_id: 'evidence:compact',
        mime_type: 'image/png',
        status: 'ready'
      },
      gesture_id: gestureId,
      scope: {
        document_id: f.head.identity.documentId,
        page_id: f.page.id,
        page_name: 'Trace Board',
        workspace_id: f.head.identity.workspaceId
      },
      session_id: 'session:compact',
      status: 'ready',
      targets: {
        count: 3,
        items: [{ stable_id: f.first.id }, { stable_id: f.nested.id }, { stable_id: f.second.id }],
        primary_stable_id: f.nested.id,
        truncated: false
      },
      workspace_revision: f.head.revision
    })
    expect(Date.parse((directContext as { expires_at: string }).expires_at)).toBe(
      Date.parse(capturedAt) + 15 * 60 * 1_000
    )
    expect(Array.from(await readFile(directContext.evidence.path))).toEqual([1, 2, 3])
    expect((await stat(directContextPath)).mode & 0o777).toBe(0o600)
    expect((await stat(directContext.evidence.path)).mode & 0o777).toBe(0o600)
    const serializedDirectContext = JSON.stringify(directContext)
    expect(serializedDirectContext).not.toContain('base64')
    expect(serializedDirectContext).not.toContain('history')
    expect(serializedDirectContext).not.toContain('intent')
    expect(serializedDirectContext).not.toContain('runtimeInstanceId')

    const response = (await f.runtime.sendRpc({
      args: { include_image: true, latest: true },
      command: 'trace_get_gesture'
    })) as { result: { gesture: Record<string, unknown>; status: string } }
    expect(response.result).toMatchObject({
      gesture: {
        boardOrigin: {
          pageId: f.page.id,
          workspaceId: f.head.identity.workspaceId
        },
        candidates: {
          collapsedCount: 1,
          count: 2,
          items: [{ stableId: f.first.id }, { stableId: f.second.id }],
          primaryTargetId: f.first.id
        },
        contract: 'trace_context/v1',
        evidence: {
          evidenceId: 'evidence:compact',
          image: { base64: 'AQID', mimeType: 'image/png' }
        },
        imageStatus: 'included',
        resolution: { status: 'resolved' }
      },
      status: 'matched'
    })
    expect(response.result.gesture).not.toHaveProperty('episode')
    expect(response.result.gesture).not.toHaveProperty('history')
    expect(response.result.gesture).not.toHaveProperty('points')
    expect(response.result.gesture).not.toHaveProperty('receipts')
    expect(response.result.gesture).not.toHaveProperty('revision')

    const current = await f.store.head()
    if (!current) throw new Error('Expected current local authority head')
    const changed = readAuthorityBoardDocument(current.document)
    changed.graph.deleteNode(f.nested.id)
    await f.store.commit({
      document: writeAuthorityBoardDocument(changed),
      expectedContentHash: current.contentHash,
      expectedRevision: current.revision,
      requestId: 'delete-precise-traced-object',
      workspaceId: current.identity.workspaceId
    })
    expect(JSON.parse(await readFile(directContextPath, 'utf8'))).toMatchObject({
      reasons: ['target_missing'],
      status: 'ambiguous',
      targets: {
        items: [{ stable_id: f.first.id }, { stable_id: f.nested.id }, { stable_id: f.second.id }],
        primary_stable_id: f.nested.id
      },
      workspace_revision: current.revision + 1
    })
  })

  test('queries global JSONL history across Boards with bounded results and cursor continuation', async () => {
    const f = await fixture()
    await persistSession(f, {
      id: 'session:dental',
      pageId: 'page:dental',
      startedAt: '2026-08-02T12:00:00.000Z',
      text: 'Dental connector workflow'
    })
    await persistSession(f, {
      id: 'session:other',
      pageId: 'page:other',
      startedAt: '2026-08-02T13:00:00.000Z',
      text: 'Unrelated spatial notes'
    })

    const queried = result(
      await f.runtime.sendRpc({
        args: { query: 'Dental connector workflow' },
        command: 'trace_query'
      })
    )
    expect(queried).toMatchObject({
      matches: [{ scope: { pageId: 'page:dental' }, sessionId: 'session:dental' }],
      status: 'matched'
    })
    expect(queried.matches[0]?.events).toHaveLength(5)
    expect(queried.taskCursor).toBeString()

    const continued = result(
      await f.runtime.sendRpc({
        args: { task_cursor: queried.taskCursor },
        command: 'trace_query'
      })
    )
    expect(continued).toMatchObject({
      matches: [{ sessionId: 'session:dental' }],
      status: 'matched'
    })
  })

  test('resolves one durable session globally by its exact voice-friendly tag', async () => {
    const f = await fixture()
    await persistSession(f, {
      aliases: ['patient-check'],
      episodes: [
        {
          endedAtMs: 900,
          id: 'chrome:capture-1',
          kind: 'chrome',
          label: 'Patient chart',
          sourceSessionId: 'capture-1',
          startedAtMs: 0
        }
      ],
      id: 'session:tagged',
      origin: {
        episodeId: 'chrome:capture-1',
        kind: 'chrome',
        reference: 'Annotation #1',
        sequence: 1,
        sourceSessionId: 'capture-1'
      },
      pageId: 'page:tagged',
      startedAt: '2026-08-02T12:00:00.000Z',
      tag: 'patient-flow',
      text: 'Chrome annotations for the patient flow'
    })
    await persistSession(f, {
      id: 'session:other-tag',
      pageId: 'page:other',
      startedAt: '2026-08-02T13:00:00.000Z',
      tag: 'billing-flow',
      text: 'Unrelated billing activity'
    })

    const queried = result(
      await f.runtime.sendRpc({
        args: { session_tag: '#PATIENT FLOW' },
        command: 'trace_query'
      })
    )
    expect(queried).toMatchObject({
      matches: [
        {
          episodes: [{ id: 'chrome:capture-1', kind: 'chrome' }],
          sessionId: 'session:tagged',
          tag: 'patient-flow'
        }
      ],
      status: 'matched'
    })
    expect(queried.matches).toHaveLength(1)
    expect(queried.matches[0]?.events[0]).toMatchObject({
      origin: { kind: 'chrome', reference: 'Annotation #1' }
    })

    const legacyAlias = result(
      await f.runtime.sendRpc({
        args: { session_tag: 'patient-check' },
        command: 'trace_query'
      })
    )
    expect(legacyAlias).toMatchObject({
      matches: [{ sessionId: 'session:tagged', tag: 'patient-flow' }],
      status: 'matched'
    })

    await expect(
      persistSession(f, {
        id: 'session:duplicate-tag',
        pageId: 'page:duplicate',
        startedAt: '2026-08-02T14:00:00.000Z',
        tag: 'patient-check',
        text: 'Should not steal a saved alias'
      })
    ).rejects.toThrow('Trace session tag #patient-check is already in use.')
  })

  test('applies inclusive persisted time ranges without resolving a live Board', async () => {
    const f = await fixture()
    await persistSession(f, {
      id: 'session:morning',
      pageId: 'page:morning',
      startedAt: '2026-08-02T09:00:00.000Z',
      text: 'Morning connector review'
    })

    const excluded = result(
      await f.runtime.sendRpc({
        args: {
          query: 'Morning connector review',
          since: '2026-08-02T10:00:00.000Z',
          until: '2026-08-02T11:00:00.000Z'
        },
        command: 'trace_query'
      })
    )
    expect(excluded).toMatchObject({
      reason: 'no_relevant_trace',
      status: 'empty'
    })
  })

  test('resolves saved spoken turns after authority restart by latest, id, and text', async () => {
    const f = await fixture()
    const startedAt = new Date(Date.now() - 1_000).toISOString()
    const startedAtEpochMs = Date.parse(startedAt) + 200
    const spokenTurn = {
      endedAt: new Date(startedAtEpochMs + 600).toISOString(),
      endedAtEpochMs: startedAtEpochMs + 600,
      expiresAtEpochMs: 1,
      id: 'spoken:persisted',
      runtimeTabBindingId: 'runtime-tab:closed',
      scope: {
        documentId: f.head.identity.documentId,
        pageId: 'page:spoken',
        workspaceId: f.head.identity.workspaceId
      },
      sequence: 1,
      startedAt: new Date(startedAtEpochMs).toISOString(),
      startedAtEpochMs,
      text: 'Connect the vertical cards'
    }
    await persistSession(f, {
      id: 'session:spoken',
      pageId: 'page:spoken',
      spokenTurns: [spokenTurn],
      startedAt,
      text: 'Connect the vertical cards'
    })

    const restarted = new LocalWorkspaceBoardRuntime(
      new LocalWorkspaceAuthorityStore({
        preferredWorkspaceId: f.head.identity.workspaceId,
        root: f.root
      })
    )
    for (const args of [
      { latest_spoken_turn: true },
      { spoken_turn_id: spokenTurn.id },
      { spoken_text: 'vertical cards' }
    ]) {
      const queried = result(await restarted.sendRpc({ args, command: 'trace_query' }))
      expect(queried).toMatchObject({
        matches: [{ sessionId: 'session:spoken' }],
        status: 'matched'
      })
    }
  })
})
