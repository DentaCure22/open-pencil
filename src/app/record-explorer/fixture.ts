import type { RecordExplorerSpec } from './types'

const CAPTURED_AT = '2026-07-14T20:30:00.000Z'
const EVIDENCE_ID = 'evidence-record-triage-fixture'

export const RECORD_TRIAGE_SPEC: RecordExplorerSpec = {
  capturedAt: CAPTURED_AT,
  defaultViewId: 'all-signals',
  evidence: [
    {
      access: 'allowed',
      facts: { fixture: true, recordCount: 5, sourceWrites: false },
      freshness: 'current',
      id: EVIDENCE_ID,
      observedAt: CAPTURED_AT,
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: CAPTURED_AT,
      sourceRef: 'fixture://openpencil/record-triage-v1',
      summary:
        'Five synthetic operational signals exercise typed fields, filters, sorts, grouping, focus, and approval without claiming a live source.',
      title: 'PHI-free record triage fixture',
      truthScope: 'fixture'
    }
  ],
  fields: [
    {
      id: 'status',
      label: 'Status',
      options: [
        { color: 'violet', id: 'new', label: 'New' },
        { color: 'amber', id: 'attention', label: 'Needs attention' },
        { color: 'red', id: 'blocked', label: 'Blocked' },
        { color: 'green', id: 'resolved', label: 'Resolved' }
      ],
      required: true,
      type: 'status'
    },
    { id: 'priority', label: 'Priority', required: true, type: 'number' },
    { id: 'owner', label: 'Owner', required: true, type: 'text' },
    { id: 'age-hours', label: 'Age (hours)', required: true, type: 'number' }
  ],
  id: 'record-triage-proof-v1',
  intent: {
    constraints: [
      'Use only the declared synthetic fixture',
      'Do not mutate record status or any external source',
      'Preserve one record identity across every saved view'
    ],
    desiredOutcome:
      'Scan the signal set, narrow attention, inspect one record, and record the triage focus',
    statement:
      'Turn a bounded record model into an interactive triage experience with saved views and a reviewable decision.'
  },
  records: [
    {
      evidenceItemIds: [EVIDENCE_ID],
      id: 'handoff-delay',
      properties: { 'age-hours': 14, owner: 'Care operations', priority: 92, status: 'blocked' },
      title: 'Handoff waiting on verification'
    },
    {
      evidenceItemIds: [EVIDENCE_ID],
      id: 'missing-context',
      properties: { 'age-hours': 8, owner: 'Support', priority: 78, status: 'attention' },
      title: 'Request lacks decision context'
    },
    {
      evidenceItemIds: [EVIDENCE_ID],
      id: 'duplicate-path',
      properties: { 'age-hours': 4, owner: 'Product', priority: 61, status: 'new' },
      title: 'Two intake paths create duplicate work'
    },
    {
      evidenceItemIds: [EVIDENCE_ID],
      id: 'stale-owner',
      properties: { 'age-hours': 19, owner: 'Platform', priority: 84, status: 'attention' },
      title: 'Escalation owner is stale'
    },
    {
      evidenceItemIds: [EVIDENCE_ID],
      id: 'closed-loop',
      properties: { 'age-hours': 2, owner: 'Operations', priority: 24, status: 'resolved' },
      title: 'Resolved signal retained for context'
    }
  ],
  subtitle:
    'One typed collection projected into different saved views, with exact evidence and review lineage.',
  title: 'Operational signal triage',
  views: [
    {
      filters: [],
      id: 'all-signals',
      kind: 'table',
      label: 'All signals',
      sorts: [{ direction: 'descending', propertyId: 'priority' }],
      visiblePropertyIds: ['status', 'priority', 'owner', 'age-hours']
    },
    {
      filters: [{ operator: 'not-equals', propertyId: 'status', value: 'resolved' }],
      id: 'needs-attention',
      kind: 'list',
      label: 'Needs attention',
      sorts: [
        { direction: 'descending', propertyId: 'priority' },
        { direction: 'descending', propertyId: 'age-hours' }
      ],
      visiblePropertyIds: ['status', 'priority', 'owner']
    },
    {
      filters: [],
      groupByPropertyId: 'status',
      id: 'by-status',
      kind: 'board',
      label: 'By status',
      sorts: [{ direction: 'descending', propertyId: 'priority' }],
      visiblePropertyIds: ['status', 'priority', 'owner']
    }
  ]
}
