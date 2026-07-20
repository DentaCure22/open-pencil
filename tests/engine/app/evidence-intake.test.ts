import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { collectEvidence } from '@/app/evidence-intake'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorRoute,
  liveInspectorStatus
} from '@/app/smylr-live-inspector/session'
import {
  createSmylrProductionWorkspaceGraph,
  isSmylrLiveAppFrameNode,
  smylrLiveAppFrameRoute
} from '@/app/smylr-production/workspace'
import {
  createEvidenceManifest,
  createIntentRecord,
  createWorkspaceContext,
  deserializeWorkspace,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  serializeWorkspace,
  workspaceRegistry
} from '@/app/workspace'

const NOW = '2026-07-14T16:00:00.000Z'

beforeEach(() => {
  workspaceRegistry.clear()
  liveInspectorActiveFrameId.value = null
  liveInspectorDocument.value = null
  liveInspectorRoute.value = null
  liveInspectorStatus.value = 'idle'
})

describe('Evidence intake gateway', () => {
  test('calls application evidence Live only after an active matching handshake', () => {
    const graph = createSmylrProductionWorkspaceGraph().graph
    const store = createEditorStore(graph)
    const frame = graph.getAllNodes().find(isSmylrLiveAppFrameNode)
    if (!frame) throw new Error('live frame fixture missing')
    const route = smylrLiveAppFrameRoute(frame)

    const captured = collectEvidence({
      collectionId: 'live-evidence-captured',
      grant: {
        actorId: 'test-user',
        issuedAt: NOW,
        scopes: ['live-runtime:read']
      },
      now: NOW,
      requests: [{ frameId: frame.id, id: 'current-app', kind: 'live-app-frame' }],
      store
    })
    expect(captured.items[0]?.truthScope).toBe('captured')
    expect(captured.items[0]?.freshness).toBe('unknown')
    expect(captured.items[0]?.summary).toContain('not Live runtime evidence')

    const requiredLive = collectEvidence({
      collectionId: 'live-evidence-required',
      grant: {
        actorId: 'test-user',
        issuedAt: NOW,
        scopes: ['live-runtime:read']
      },
      now: NOW,
      requests: [
        { frameId: frame.id, id: 'current-app', kind: 'live-app-frame', requireLive: true }
      ],
      store
    })
    expect(requiredLive.status).toBe('partial')
    expect(requiredLive.items[0]?.access).toBe('redacted')
    expect(requiredLive.receipt.providerRuns[0]?.status).toBe('unavailable')

    liveInspectorActiveFrameId.value = frame.id
    liveInspectorRoute.value = route
    liveInspectorStatus.value = 'connected'
    liveInspectorDocument.value = {
      capturedAt: NOW,
      route,
      selectedId: 'root',
      title: 'Synthetic test runtime',
      tree: {
        children: [
          {
            id: 'child',
            label: 'Child',
            rect: { height: 10, width: 10, x: 0, y: 0 }
          }
        ],
        id: 'root',
        label: 'Root',
        rect: { height: 100, width: 100, x: 0, y: 0 }
      }
    }
    const live = collectEvidence({
      collectionId: 'live-evidence-connected',
      grant: {
        actorId: 'test-user',
        issuedAt: NOW,
        scopes: ['live-runtime:read']
      },
      now: NOW,
      requests: [{ frameId: frame.id, id: 'current-app', kind: 'live-app-frame' }],
      store
    })
    expect(live.status).toBe('ready')
    expect(live.items[0]?.truthScope).toBe('live')
    expect(live.items[0]?.freshness).toBe('current')
    expect(live.items[0]?.facts.runtimeActive).toBe(true)
    expect(live.items[0]?.facts.nodeCount).toBe(2)
    expect(JSON.stringify(live.items[0])).not.toContain('Child')
    expect(live.receipt.providerRuns[0]?.capabilities).toEqual({
      capturedContentRead: false,
      externalWrites: false,
      liveRuntimeRead: true,
      networkAccess: false,
      sourceWrites: false,
      workspaceMetadataRead: false
    })
  })

  test('redacts evidence when the required scope is not granted', () => {
    const store = createEditorStore()
    const result = collectEvidence({
      collectionId: 'redacted-evidence',
      grant: { issuedAt: NOW, scopes: [] },
      now: NOW,
      requests: [
        {
          facts: { secret: 'must-not-leak' },
          id: 'private-capture',
          kind: 'captured-input',
          sourceRef: 'captured://private/input',
          summary: 'Sensitive summary',
          title: 'Sensitive title'
        }
      ],
      store
    })
    expect(result.status).toBe('partial')
    expect(result.items[0]).toMatchObject({
      access: 'redacted',
      facts: {},
      summary: '',
      title: 'Evidence unavailable'
    })
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect(JSON.stringify(result)).not.toContain('Sensitive summary')
    expect(result.receipt.providerRuns[0]?.status).toBe('redacted')
    expect(result.receipt.providerRuns[0]?.requestedScopes).toEqual(['captured-content:read'])
    expect(result.receipt.providerRuns[0]?.grantedScopes).toEqual([])
  })

  test('persists an exact provider receipt with canonical workspace evidence', () => {
    const store = createEditorStore()
    const page = store.graph.getPages()[0]
    if (!page) throw new Error('test page missing')
    let workspace = resolveKnowledgeWorkspace({
      documentId: store.graph.rootId,
      name: 'Evidence intake test',
      pageId: page.id
    })
    const intent = createIntentRecord(
      createWorkspaceContext(workspace, {
        now: NOW,
        provenance: { actorId: 'test-user', kind: 'user' }
      }),
      {
        capturedAt: NOW,
        desiredOutcome: 'Prove exact provider receipts',
        id: 'intent-record_evidence-intake-test',
        statement: 'Collect one canonical workspace object.'
      }
    )
    workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: 'create-evidence-intake-intent',
      operations: [{ object: intent, type: 'create-object' }]
    }).workspace
    const committedIntent = workspace.objects[intent.id]
    if (!committedIntent || committedIntent.type !== 'intent-record') {
      throw new Error('committed intent missing')
    }
    const intake = collectEvidence({
      collectionId: 'workspace-evidence',
      grant: {
        actorId: 'test-user',
        issuedAt: NOW,
        scopes: ['workspace-metadata:read']
      },
      now: NOW,
      requests: [
        {
          id: 'canonical-intent',
          kind: 'workspace-object',
          objectId: committedIntent.id,
          revision: committedIntent.revision
        }
      ],
      store,
      workspace
    })
    const manifest = createEvidenceManifest(
      createWorkspaceContext(workspace, {
        now: NOW,
        provenance: { actorId: 'evidence-intake', kind: 'agent' }
      }),
      {
        collectionReceipt: intake.receipt,
        id: 'evidence-manifest_provider-receipt-test',
        intent: { objectId: committedIntent.id, revision: committedIntent.revision },
        items: intake.items,
        snapshotAt: NOW,
        status: intake.status
      }
    )
    workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: 'create-provider-receipt-manifest',
      operations: [{ object: manifest, type: 'create-object' }]
    }).workspace

    const reloaded = deserializeWorkspace(serializeWorkspace(workspace))
    const stored = reloaded.objects[manifest.id]
    if (!stored || stored.type !== 'evidence-manifest') {
      throw new Error('stored evidence manifest missing')
    }
    expect(stored.collectionReceipt).toEqual(intake.receipt)
    expect(stored.items[0]?.providerRunId).toBe(intake.receipt.providerRuns[0]?.id)
    expect(stored.items[0]?.sourceObject).toEqual({
      objectId: committedIntent.id,
      revision: committedIntent.revision
    })
  })
})
