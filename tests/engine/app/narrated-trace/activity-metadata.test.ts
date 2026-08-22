import { describe, expect, test } from 'bun:test'

import { narratedTraceActivityMetadata } from '@/app/narrated-trace/activity-metadata'
import type { NarratedTraceActivityItem } from '@/app/narrated-trace/history'

function activityItem(): NarratedTraceActivityItem {
  return {
    context: { included: true, removed: false, sourceEventId: 'event-1' },
    event: {
      atMs: 0,
      id: 'event-1',
      kind: 'selection',
      label: 'Selected SortableHeader',
      target: {
        elementKind: 'container',
        hierarchy: {
          children: [],
          current: { label: 'SortableHeader', stableId: 'sortable-header' },
          parent: { label: 'Table header', stableId: 'table-header' }
        },
        name: 'SortableHeader',
        path: ['Document', 'Dental Chart', 'Table header', 'SortableHeader'],
        route: '/dental-chart',
        source: {
          componentName: 'PatientHistoryPanel',
          filePath: 'src/features/dental-chart/components/patient-history-panel.tsx',
          lineNumber: 72
        },
        stableId: 'sortable-header'
      }
    },
    occurredAtMs: 0,
    scope: {
      documentId: 'document-long-id',
      documentName: 'OpenPencil Workspace',
      pageId: 'page-long-id',
      pageName: 'Dental Chart',
      workspaceId: 'workspace-long-id'
    },
    sessionId: 'session-1',
    sessionStartedAt: '2026-08-17T12:00:00.000Z',
    title: 'Recent activity'
  }
}

describe('Narrated Trace Activity metadata', () => {
  test('shows source ownership and compact target hierarchy without transport IDs', () => {
    const metadata = narratedTraceActivityMetadata(activityItem())

    expect(metadata).toBe(
      'PatientHistoryPanel · patient-history-panel.tsx:72 · Table header > SortableHeader · /dental-chart'
    )
    expect(metadata).not.toContain('workspace-long-id')
    expect(metadata).not.toContain('document-long-id')
    expect(metadata).not.toContain('page-long-id')
  })

  test('keeps historical targets readable with a short ancestry fallback', () => {
    const item = activityItem()
    const target = item.event.target
    if (!target) throw new Error('Expected target fixture')
    target.source = undefined
    target.hierarchy = undefined

    expect(narratedTraceActivityMetadata(item)).toBe(
      'Dental Chart > Table header > SortableHeader · /dental-chart'
    )
  })
})
