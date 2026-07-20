import { beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import {
  EVIDENCE_BRIEF_IDS,
  applyEvidenceBriefEvent,
  createEvidenceBrief,
  reconstructEvidenceBriefReceipt,
  type EvidenceBriefEventRequest
} from '@/app/evidence-brief'
import { htmlBoardDocument } from '@/app/html-board/workspace'
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
  if (!workspace) throw new Error('evidence brief workspace missing')
  return workspace
}

function currentSurface(store: EditorStore) {
  const object = currentWorkspace(store).objects[EVIDENCE_BRIEF_IDS.surface]
  if (!object || object.type !== 'surface-run') throw new Error('evidence brief surface missing')
  return object
}

function board(store: EditorStore) {
  const node = store.graph.getNode(currentSurface(store).artifact.boardId)
  if (!node) throw new Error('evidence brief board missing')
  return node
}

function approvalFor(store: EditorStore, eventId: string): EvidenceBriefEventRequest {
  const workspace = currentWorkspace(store)
  const surface = currentSurface(store)
  return {
    action: 'approve',
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

describe('Evidence Brief reusable experience recipe', () => {
  test('renders explanation as a distinct brief while preserving shared identity and truth', async () => {
    const store = createEditorStore()
    const result = await createEvidenceBrief(store)
    const surface = currentSurface(store)
    const source = htmlBoardDocument(board(store)).html

    expect(result.created).toBe(true)
    expect(surface.rendererId).toBe('evidence-brief-v1')
    expect(surface.jobKind).toBe('explain')
    expect(surface.form.kind).toBe('evidence-brief')
    expect(surface.formChoice.rationale).toContain('Brief')
    expect(surface.bindings.evidenceItemIds).toHaveLength(3)
    expect(source).toContain('The vision, without freezing the surface')
    expect(source).toContain('Evidence brief')
    expect(source).toContain('Sources')
    expect(source).toContain('Source unchanged')
    expect(source).toContain("connect-src 'none'")
  })

  test('approves, reloads, and reconstructs the exact brief receipt', async () => {
    const store = createEditorStore()
    await createEvidenceBrief(store)

    const stale = approvalFor(store, 'brief-stale')
    stale.expected.workspaceRevision -= 1
    expect((await applyEvidenceBriefEvent(store, stale)).status).toBe('rejected')

    const approval = approvalFor(store, 'brief-approve')
    const approved = await applyEvidenceBriefEvent(store, approval)
    expect(approved.status).toBe('applied')
    expect((await applyEvidenceBriefEvent(store, approval)).status).toBe('replayed')
    expect(currentSurface(store).status).toBe('decided')
    expect(htmlBoardDocument(board(store)).workflow.status).toBe('approved')

    const serialized = serializeActiveKnowledgeWorkspaces()
    workspaceRegistry.clear()
    hydrateActiveKnowledgeWorkspaces(serialized)
    const reconstruction = reconstructEvidenceBriefReceipt(store, approved.receiptId ?? '')
    expect(reconstruction.receipt?.outcome.selectedRecommendationIds).toEqual([
      'approve-evidence-brief'
    ])
    expect(reconstruction.receipt?.artifact).toEqual(reconstruction.surface.artifact)
    expect(reconstruction.surface.interactions.map((interaction) => interaction.action)).toEqual([
      'approve'
    ])
  })
})
