import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore, type EditorStore } from '@/app/editor/session'
import { createEvidenceBrief, EVIDENCE_BRIEF_SPEC } from '@/app/evidence-brief'
import { htmlBoardDocument } from '@/app/html-board/workspace'
import {
  RECORD_TRIAGE_SPEC,
  applyRecordExplorerEvent,
  createRecordExplorer,
  reconstructRecordExplorerReceipt,
  recordExplorerRecordId,
  recordExplorerSavedViewId,
  recordExplorerStateForBoard,
  validateRecordExplorerDefinition,
  type RecordExplorerEventRequest
} from '@/app/record-explorer'
import {
  getKnowledgeWorkspace,
  hydrateActiveKnowledgeWorkspaces,
  serializeActiveKnowledgeWorkspaces,
  workspaceRegistry
} from '@/app/workspace'

function currentWorkspace(store: EditorStore) {
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')
  const workspace = getKnowledgeWorkspace(store.graph.rootId, page.id)
  if (!workspace) throw new Error('record explorer workspace missing')
  return workspace
}

function currentSurface(store: EditorStore) {
  const object = currentWorkspace(store).objects[`surface-run_${RECORD_TRIAGE_SPEC.id}`]
  if (!object || object.type !== 'surface-run') throw new Error('record explorer surface missing')
  return object
}

function board(store: EditorStore) {
  const node = store.graph.getNode(currentSurface(store).artifact.boardId)
  if (!node) throw new Error('record explorer board missing')
  return node
}

function eventFor(
  store: EditorStore,
  eventId: string,
  input: Omit<RecordExplorerEventRequest, 'eventId' | 'expected' | 'surfaceRunId'>
): RecordExplorerEventRequest {
  const workspace = currentWorkspace(store)
  const surface = currentSurface(store)
  return {
    ...input,
    eventId,
    expected: {
      artifactRevision: htmlBoardDocument(board(store)).revision,
      surfaceRevision: surface.revision,
      workspaceRevision: workspace.revision
    },
    surfaceRunId: surface.id
  }
}

beforeEach(() => workspaceRegistry.clear())

describe('Record Explorer executable form', () => {
  test('creates typed records and saved views with one exact lineage', async () => {
    const store = createEditorStore()
    const result = await createRecordExplorer(store, RECORD_TRIAGE_SPEC)
    const workspace = currentWorkspace(store)
    const surface = currentSurface(store)
    const collection = workspace.objects[`collection_${RECORD_TRIAGE_SPEC.id}`]
    const html = htmlBoardDocument(board(store)).html

    expect(result.created).toBe(true)
    expect(surface).toMatchObject({
      form: { kind: 'record-explorer' },
      jobKind: 'triage',
      rendererId: 'record-explorer-v1',
      status: 'in-review'
    })
    expect(collection?.type).toBe('collection')
    if (collection?.type !== 'collection') throw new Error('record collection missing')
    expect(collection.recordIds).toHaveLength(RECORD_TRIAGE_SPEC.records.length)
    expect(collection.savedViewIds).toHaveLength(RECORD_TRIAGE_SPEC.views.length)
    expect(
      collection.recordIds.every((id) => workspace.objects[id]?.type === 'collection-record')
    ).toBe(true)
    expect(
      collection.savedViewIds.every((id) => workspace.objects[id]?.type === 'saved-view')
    ).toBe(true)
    expect(surface.bindings.objectRefs).toHaveLength(2 + 1 + 5 + 3)
    expect(surface.capabilities).toEqual({
      externalWrites: false,
      networkAccess: false,
      sourceWrites: false
    })
    expect(html).toContain('Operational signal triage')
    expect(html).toContain('All signals')
    expect(html).toContain("connect-src 'none'")
    expect(recordExplorerStateForBoard(store, board(store))?.records[0]?.title).toBe(
      'Handoff waiting on verification'
    )
  })

  test('refuses malformed record grammars before any surface exists', () => {
    expect(() =>
      validateRecordExplorerDefinition({
        ...structuredClone(RECORD_TRIAGE_SPEC),
        records: [
          ...RECORD_TRIAGE_SPEC.records.slice(0, 1),
          {
            id: 'bad-record',
            properties: { unknown: 'not declared' },
            title: 'Invalid record'
          }
        ]
      })
    ).toThrow('unknown field')
    expect(() =>
      validateRecordExplorerDefinition({
        ...structuredClone(RECORD_TRIAGE_SPEC),
        defaultViewId: 'missing-view'
      })
    ).toThrow('default view')
  })

  test('allows independent surfaces to advance without invalidating exact local actions', async () => {
    const store = createEditorStore()
    await createRecordExplorer(store, RECORD_TRIAGE_SPEC)
    const event = eventFor(store, 'record-view-after-companion', {
      action: 'activate-view',
      targetId: recordExplorerSavedViewId(RECORD_TRIAGE_SPEC.id, 'needs-attention')
    })
    const originalWorkspaceRevision = event.expected.workspaceRevision

    await createEvidenceBrief(store, {
      ...structuredClone(EVIDENCE_BRIEF_SPEC),
      id: 'independent-companion-proof'
    })
    expect(currentWorkspace(store).revision).toBeGreaterThan(originalWorkspaceRevision)

    const applied = await applyRecordExplorerEvent(store, event)
    expect(applied.status).toBe('applied')
    expect(applied.state?.activeView.id).toBe(event.targetId)

    const staleArtifact = eventFor(store, 'record-stale-after-companion', {
      action: 'focus-record',
      targetId: recordExplorerRecordId(RECORD_TRIAGE_SPEC.id, 'handoff-delay')
    })
    staleArtifact.expected.artifactRevision -= 1
    expect((await applyRecordExplorerEvent(store, staleArtifact)).status).toBe('rejected')
  })

  test('switches saved views, validates focus, receipts approval, and reconstructs after reload', async () => {
    const store = createEditorStore()
    await createRecordExplorer(store, RECORD_TRIAGE_SPEC)
    const attentionView = recordExplorerSavedViewId(RECORD_TRIAGE_SPEC.id, 'needs-attention')
    const activated = await applyRecordExplorerEvent(
      store,
      eventFor(store, 'record-view-attention', {
        action: 'activate-view',
        targetId: attentionView
      })
    )
    expect(activated.status).toBe('applied')
    expect(activated.state?.activeView.id).toBe(attentionView)
    expect(activated.state?.records.map((record) => record.properties.status)).not.toContain(
      'resolved'
    )
    expect(
      (
        await applyRecordExplorerEvent(
          store,
          eventFor(store, 'record-focus-outside-view', {
            action: 'focus-record',
            targetId: recordExplorerRecordId(RECORD_TRIAGE_SPEC.id, 'closed-loop')
          })
        )
      ).status
    ).toBe('rejected')

    const focusedRecord = recordExplorerRecordId(RECORD_TRIAGE_SPEC.id, 'handoff-delay')
    const focus = eventFor(store, 'record-focus-blocker', {
      action: 'focus-record',
      targetId: focusedRecord
    })
    expect((await applyRecordExplorerEvent(store, focus)).status).toBe('applied')
    expect((await applyRecordExplorerEvent(store, focus)).status).toBe('replayed')

    const approval = await applyRecordExplorerEvent(
      store,
      eventFor(store, 'record-approve-blocker', { action: 'approve' })
    )
    expect(approval.error).toBeUndefined()
    expect(approval.status).toBe('applied')
    expect(currentSurface(store).status).toBe('decided')
    expect(htmlBoardDocument(board(store)).workflow.status).toBe('approved')

    const receipt = currentWorkspace(store).objects[approval.receiptId ?? '']
    expect(receipt?.type).toBe('decision-receipt')
    if (receipt?.type !== 'decision-receipt') throw new Error('record receipt missing')
    expect(receipt.outcome.selectedRecommendationIds).toHaveLength(
      RECORD_TRIAGE_SPEC.records.length
    )
    expect(receipt.outcome.finalOrder[0]).toBe(`recommendation_${focusedRecord}`)
    expect(
      currentSurface(store).recommendations.find(
        (recommendation) => recommendation.status === 'preferred'
      )?.id
    ).toBe(`recommendation_${focusedRecord}`)

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reconstructed = reconstructRecordExplorerReceipt(store, approval.receiptId ?? '')
    expect(reconstructed.receipt?.artifact).toEqual(reconstructed.surface.artifact)
    expect(reconstructed.activeView.id).toBe(attentionView)
    expect(reconstructed.focusedRecordId).toBe(focusedRecord)
    expect(reconstructed.surface.interactions.map((interaction) => interaction.action)).toEqual([
      'adjust',
      'adjust',
      'approve'
    ])
  })
})
