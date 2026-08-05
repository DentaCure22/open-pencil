import { describe, expect, test } from 'bun:test'

import { persistedNarratedTraceGesture } from '@/app/narrated-trace/persistence'
import type { NarratedTraceEvent, NarratedTraceSession } from '@/app/narrated-trace/types'

describe('Narrated Trace persisted authority mirror', () => {
  test('keeps only stable targets and the page-space region', () => {
    const event: NarratedTraceEvent = {
      anchor: {
        pagePoint: { x: 120, y: 180 },
        pageRegion: { height: 90, width: 240, x: 100, y: 140 },
        viewport: { panX: 10, panY: 20, zoom: 1.5 }
      },
      atMs: 2500,
      gesture: {
        candidateCount: 2,
        candidates: [
          {
            bounds: { height: 100, width: 260, x: 90, y: 130 },
            depth: 2,
            name: 'First card',
            nodeType: 'FRAME',
            objectCoverageRatio: 0.6,
            path: ['Dental Board', 'First card'],
            regionCoverageRatio: 0.8,
            relation: 'intersecting',
            stableId: 'card:first'
          },
          {
            bounds: { height: 100, width: 260, x: 370, y: 130 },
            depth: 2,
            name: 'Second card',
            nodeType: 'FRAME',
            objectCoverageRatio: 0.3,
            path: ['Dental Board', 'Second card'],
            regionCoverageRatio: 0.4,
            relation: 'intersecting',
            stableId: 'card:second'
          }
        ],
        candidatesTruncated: false,
        documentTabId: 'runtime-tab',
        kind: 'focus',
        pagePoints: [{ x: 120, y: 180 }],
        primaryTargetId: 'card:first',
        runtimeInstanceId: 'runtime:browser',
        screenBounds: { height: 90, width: 240, x: 100, y: 140 },
        screenPoints: [{ x: 120, y: 180 }]
      },
      id: 'gesture:first',
      kind: 'screenshot',
      label: 'Highlighted cards'
    }
    const session: NarratedTraceSession = {
      contextDraft: [],
      durationMs: 2500,
      events: [event],
      id: 'session:first',
      scope: {
        documentId: 'document:canonical',
        pageId: 'page:dental',
        workspaceId: 'workspace:canonical'
      },
      startedAt: '2026-08-01T12:00:00.000Z'
    }

    expect(persistedNarratedTraceGesture(session, event)).toEqual({
      boardOrigin: {
        contentDocumentId: 'document:canonical',
        pageId: 'page:dental',
        workspaceId: 'workspace:canonical'
      },
      candidates: {
        count: 2,
        items: [{ stableId: 'card:first' }, { stableId: 'card:second' }],
        primaryTargetId: 'card:first',
        truncated: false
      },
      capturedAt: '2026-08-01T12:00:02.500Z',
      contract: 'trace-gesture-agent/v1',
      geometry: {
        kind: 'focus',
        pageRegion: { height: 90, width: 240, x: 100, y: 140 }
      },
      gestureId: 'gesture:first',
      sessionId: 'session:first'
    })
  })

  test('collapses nested candidates to owners and persists only evidence metadata', () => {
    const evidence = {
      annotation: {
        bounds: { height: 40, width: 100, x: 120, y: 140 },
        color: '#8b5cf6',
        kind: 'focus' as const,
        points: [
          { x: 120, y: 140 },
          { x: 220, y: 180 }
        ],
        strokeWidth: 20
      },
      base64: 'not-persisted',
      capturedAtMs: 1000,
      cropBounds: { height: 120, width: 280, x: 100, y: 120 },
      evidenceId: 'evidence:nested-card',
      height: 120,
      mimeType: 'image/png' as const,
      omissions: [],
      source: 'canvas' as const,
      width: 280
    }
    const event: NarratedTraceEvent = {
      anchor: {
        pagePoint: { x: 180, y: 170 },
        pageRegion: { height: 80, width: 200, x: 100, y: 130 },
        viewport: { panX: 0, panY: 0, zoom: 1 }
      },
      atMs: 1000,
      evidence,
      gesture: {
        candidateCount: 3,
        candidates: [
          {
            bounds: { height: 40, width: 100, x: 120, y: 140 },
            depth: 2,
            name: 'Header',
            nodeType: 'FRAME',
            objectCoverageRatio: 1,
            ownerId: 'card:first',
            path: ['Dental Board', 'First card', 'Header'],
            regionCoverageRatio: 0.3,
            relation: 'contained',
            stableId: 'card:first:header'
          },
          {
            bounds: { height: 20, width: 80, x: 130, y: 150 },
            depth: 3,
            name: 'Title',
            nodeType: 'TEXT',
            objectCoverageRatio: 1,
            ownerId: 'card:first',
            path: ['Dental Board', 'First card', 'Header', 'Title'],
            regionCoverageRatio: 0.1,
            relation: 'contained',
            stableId: 'card:first:title'
          },
          {
            bounds: { height: 100, width: 120, x: 260, y: 130 },
            depth: 1,
            name: 'Second card',
            nodeType: 'FRAME',
            objectCoverageRatio: 0.5,
            ownerId: 'card:second',
            path: ['Dental Board', 'Second card'],
            regionCoverageRatio: 0.4,
            relation: 'intersecting',
            stableId: 'card:second'
          }
        ],
        candidatesTruncated: false,
        kind: 'focus',
        pagePoints: [{ x: 180, y: 170 }],
        primaryTargetId: 'card:first:header',
        screenBounds: { height: 80, width: 200, x: 100, y: 130 },
        screenPoints: [{ x: 180, y: 170 }]
      },
      id: 'gesture:nested-card',
      kind: 'screenshot',
      label: 'Highlighted nested card content'
    }
    const session: NarratedTraceSession = {
      contextDraft: [],
      durationMs: 1000,
      events: [event],
      id: 'session:nested-card',
      scope: {
        documentId: 'document:canonical',
        pageId: 'page:dental',
        workspaceId: 'workspace:canonical'
      },
      startedAt: '2026-08-01T12:00:00.000Z'
    }

    const persisted = persistedNarratedTraceGesture(session, event)

    expect(persisted).toMatchObject({
      candidates: {
        count: 2,
        items: [{ stableId: 'card:first' }, { stableId: 'card:second' }],
        primaryTargetId: 'card:first',
        truncated: false
      },
      evidence: {
        evidenceId: 'evidence:nested-card',
        height: 120,
        mimeType: 'image/png',
        width: 280
      }
    })
    expect(JSON.stringify(persisted)).not.toContain('not-persisted')
  })
})
