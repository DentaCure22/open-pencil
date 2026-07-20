import type { EvidenceManifestItem } from '@/app/workspace'

import type { InteractiveProgramSpec } from './types'

const CAPTURED_AT = '2026-07-14T19:30:00.000Z'

function evidence(id: string, title: string, summary: string): EvidenceManifestItem {
  return {
    access: 'allowed',
    facts: { source: title },
    freshness: 'current',
    id,
    observedAt: CAPTURED_AT,
    permissionScopes: ['captured-content:read'],
    retrievedAt: CAPTURED_AT,
    sourceRef: `captured://interactive-program/${id}`,
    summary,
    title,
    truthScope: 'fixture'
  }
}

const PRIORITY_EVIDENCE = [
  evidence('priority-user-impact', 'User impact notes', 'Captured synthetic impact scores.'),
  evidence('priority-effort', 'Engineering estimates', 'Captured synthetic effort estimates.'),
  evidence('priority-risk', 'Risk review', 'Captured synthetic risk-reduction scores.')
]

export const PRIORITY_WEIGHTING_PROGRAM: InteractiveProgramSpec = {
  capturedAt: CAPTURED_AT,
  evidence: PRIORITY_EVIDENCE,
  id: 'priority-weighting-program',
  inputs: [
    {
      defaultValue: 5,
      description: 'How strongly should user impact affect the ranking?',
      id: 'impact',
      label: 'User impact weight',
      max: 10,
      min: 0,
      step: 1
    },
    {
      defaultValue: 3,
      description: 'How strongly should lower implementation effort help?',
      id: 'ease',
      label: 'Delivery ease weight',
      max: 10,
      min: 0,
      step: 1
    },
    {
      defaultValue: 4,
      description: 'How strongly should risk reduction affect the ranking?',
      id: 'risk',
      label: 'Risk reduction weight',
      max: 10,
      min: 0,
      step: 1
    }
  ],
  intent: {
    constraints: ['Use a fixed synthetic evidence snapshot', 'Do not update the roadmap'],
    desiredOutcome: 'Understand how priority changes as decision weights change.',
    statement: 'Explore which OpenPencil build should come next under different priorities.'
  },
  items: [
    {
      evidenceItemIds: PRIORITY_EVIDENCE.map((item) => item.id),
      id: 'connector-foundation',
      label: 'Connector foundation',
      metrics: { ease: 5, impact: 7, risk: 9 },
      note: 'Improves evidence freshness and closes external loops.'
    },
    {
      evidenceItemIds: PRIORITY_EVIDENCE.map((item) => item.id),
      id: 'presentation-renderer',
      label: 'Presentation renderer',
      metrics: { ease: 8, impact: 6, risk: 3 },
      note: 'Expands communication jobs with comparatively low effort.'
    },
    {
      evidenceItemIds: PRIORITY_EVIDENCE.map((item) => item.id),
      id: 'knowledge-authoring',
      label: 'Knowledge authoring',
      metrics: { ease: 4, impact: 9, risk: 7 },
      note: 'Deepens the durable knowledge workflow.'
    }
  ],
  model: { kind: 'weighted-priority' },
  subtitle: 'Adjust decision weights and watch the same evidence produce a new ranking.',
  title: 'What should OpenPencil build next?'
}

const CAPACITY_EVIDENCE = [
  evidence('capacity-value', 'Outcome value estimates', 'Captured synthetic value estimates.'),
  evidence('capacity-effort', 'Team capacity estimates', 'Captured synthetic weekly effort.')
]

export const CAPACITY_PLANNER_PROGRAM: InteractiveProgramSpec = {
  capturedAt: CAPTURED_AT,
  evidence: CAPACITY_EVIDENCE,
  id: 'capacity-planner-program',
  inputs: [
    {
      defaultValue: 10,
      description: 'Available team points for the next cycle.',
      id: 'capacity',
      label: 'Available capacity',
      max: 20,
      min: 2,
      step: 1,
      unit: 'points'
    }
  ],
  intent: {
    constraints: ['Use a fixed synthetic evidence snapshot', 'No scheduling writes'],
    desiredOutcome: 'See which work fits as available capacity changes.',
    statement: 'Build a coherent next-cycle plan without exceeding team capacity.'
  },
  items: [
    {
      evidenceItemIds: CAPACITY_EVIDENCE.map((item) => item.id),
      id: 'evidence-receipts',
      label: 'Evidence receipts',
      metrics: { effort: 3, value: 9 },
      note: 'Makes truth and permissions inspectable.'
    },
    {
      evidenceItemIds: CAPACITY_EVIDENCE.map((item) => item.id),
      id: 'program-renderer',
      label: 'Interactive program renderer',
      metrics: { effort: 5, value: 10 },
      note: 'Proves adjustable tools as a new form.'
    },
    {
      evidenceItemIds: CAPACITY_EVIDENCE.map((item) => item.id),
      id: 'visual-polish',
      label: 'Visual polish pass',
      metrics: { effort: 4, value: 6 },
      note: 'Improves clarity without changing the model.'
    },
    {
      evidenceItemIds: CAPACITY_EVIDENCE.map((item) => item.id),
      id: 'connector-adapter',
      label: 'First real connector adapter',
      metrics: { effort: 7, value: 8 },
      note: 'Connects one external system through the proven boundary.'
    }
  ],
  model: {
    capacityInputId: 'capacity',
    effortMetricId: 'effort',
    kind: 'capacity-planner',
    valueMetricId: 'value'
  },
  subtitle: 'Change capacity to test a plan before committing work anywhere.',
  title: 'What fits in the next cycle?'
}
