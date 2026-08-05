import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  getNarratedTraceGestureFromRecords,
  resolveNarratedTraceSceneTargets,
  summarizeNarratedTraceSession,
  type NarratedTraceEvent,
  type NarratedTraceSession
} from '@/app/narrated-trace'

const scope = {
  documentId: 'content-document:1',
  documentName: 'Dental board',
  pageId: 'page:1',
  pageName: 'Exam',
  workspaceId: 'workspace:1'
}

function event(input: Partial<NarratedTraceEvent> & Pick<NarratedTraceEvent, 'id' | 'kind'>) {
  return {
    atMs: 0,
    label: input.id,
    ...input
  }
}

function session(
  id: string,
  startedAt: string,
  events: NarratedTraceEvent[]
): NarratedTraceSession {
  return {
    contextDraft: [],
    durationMs: Math.max(1, ...events.map((item) => item.atMs + 1_000)),
    events,
    id,
    scope,
    startedAt
  }
}

function gestureEvent(id: string, atMs: number): NarratedTraceEvent {
  return event({
    anchor: {
      pagePoint: { x: 150, y: 90 },
      pageRegion: { height: 80, width: 160, x: 70, y: 50 },
      viewport: { panX: 20, panY: 10, zoom: 2 }
    },
    atMs,
    gesture: {
      candidateCount: 2,
      candidates: [
        {
          bounds: { height: 180, width: 320, x: 40, y: 20 },
          depth: 1,
          name: 'Patient card',
          nodeType: 'FRAME',
          objectCoverageRatio: 0.22,
          path: ['Exam', 'Patient card'],
          regionCoverageRatio: 1,
          relation: 'contains-region',
          stableId: 'frame:patient'
        },
        {
          bounds: { height: 48, width: 220, x: 70, y: 50 },
          depth: 2,
          name: 'Header',
          nodeType: 'FRAME',
          objectCoverageRatio: 1,
          path: ['Exam', 'Patient card', 'Header'],
          regionCoverageRatio: 0.83,
          relation: 'contained',
          stableId: 'frame:header'
        }
      ],
      candidatesTruncated: false,
      documentTabId: 'tab:1',
      kind: 'focus',
      pagePoints: [
        { x: 80, y: 60 },
        { x: 220, y: 110 }
      ],
      primaryTargetId: 'frame:header',
      runtimeInstanceId: 'runtime:1',
      screenBounds: { height: 160, width: 320, x: 160, y: 110 },
      screenPoints: [
        { x: 180, y: 130 },
        { x: 460, y: 230 }
      ]
    },
    id,
    kind: 'screenshot',
    target: {
      name: 'Header',
      path: ['Exam', 'Patient card', 'Header'],
      stableId: 'frame:header'
    }
  })
}

describe('Narrated Trace gesture packets', () => {
  test('captures the stable page-owned owner for nested candidates', () => {
    const store = createEditorStore()
    store.setViewport({ panX: 0, panY: 0, zoom: 1 })
    const owner = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 240,
      name: 'Trace workflow',
      width: 320,
      x: 100,
      y: 100
    })
    const group = store.graph.createNode('GROUP', owner.id, {
      height: 80,
      name: 'Implementation group',
      width: 180,
      x: 40,
      y: 40
    })
    const label = store.graph.createNode('TEXT', group.id, {
      height: 30,
      name: 'Nested label',
      text: 'Nested label',
      width: 120,
      x: 20,
      y: 20
    })

    const result = resolveNarratedTraceSceneTargets(store, {
      height: 30,
      width: 120,
      x: 160,
      y: 160
    })

    expect(result.target?.stableId).toBe(label.id)
    expect(result.candidates.map(({ ownerId, stableId }) => ({ ownerId, stableId }))).toEqual([
      { ownerId: owner.id, stableId: label.id },
      { ownerId: owner.id, stableId: group.id },
      { ownerId: owner.id, stableId: owner.id }
    ])
  })

  test('returns exact geometry, all candidate objects, and the chronological nearby episode', async () => {
    const earlier = session('session:earlier', '2026-08-01T12:00:00.000Z', [
      event({ atMs: 1_000, id: 'selection:1', kind: 'selection', label: 'Selected patient' })
    ])
    const current = session('session:gesture', '2026-08-01T12:00:03.000Z', [
      gestureEvent('gesture:header', 0),
      event({ atMs: 900, id: 'transcript:1', kind: 'transcript', text: 'make this white' })
    ])
    const sessions = new Map([
      [earlier.id, earlier],
      [current.id, current]
    ])
    const result = await getNarratedTraceGestureFromRecords(
      { includeImage: false, latest: true },
      {
        currentSession: current,
        readSession: async (id) => sessions.get(id) ?? null,
        records: [summarizeNarratedTraceSession(current), summarizeNarratedTraceSession(earlier)]
      }
    )

    expect(result.status).toBe('matched')
    expect(result.gesture).toMatchObject({
      boardOrigin: {
        contentDocumentId: 'content-document:1',
        documentId: 'tab:1',
        pageId: 'page:1',
        runtimeInstanceId: 'runtime:1',
        workspaceId: 'workspace:1'
      },
      candidates: {
        count: 2,
        items: [{ stableId: 'frame:patient' }, { stableId: 'frame:header' }],
        primaryTargetId: 'frame:header',
        truncated: false
      },
      geometry: {
        pagePoints: [
          { x: 80, y: 60 },
          { x: 220, y: 110 }
        ],
        pageRegion: { height: 80, width: 160, x: 70, y: 50 }
      },
      gestureId: 'gesture:header'
    })
    expect(result.gesture?.episode.events.map((item) => item.id)).toEqual([
      'selection:1',
      'gesture:header',
      'transcript:1'
    ])
  })

  test('resolves one exact older gesture and rejects ambiguous selectors', async () => {
    const older = session('session:older', '2026-08-01T11:00:00.000Z', [
      gestureEvent('gesture:older', 500)
    ])
    const records = [summarizeNarratedTraceSession(older)]
    const dependencies = {
      currentSession: null,
      readSession: async (id: string) => (id === older.id ? older : null),
      records
    }

    expect(
      await getNarratedTraceGestureFromRecords({ gestureId: 'gesture:older' }, dependencies)
    ).toMatchObject({ gesture: { gestureId: 'gesture:older' }, status: 'matched' })
    expect(
      await getNarratedTraceGestureFromRecords(
        { gestureId: 'gesture:older', latest: true },
        dependencies
      )
    ).toMatchObject({ reason: 'invalid_selector', status: 'error' })
  })
})
