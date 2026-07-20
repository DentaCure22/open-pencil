import type { DecisionRecommendation } from '@/app/workspace'

import type { FlowStudioSpec } from './types'

export const FLOW_STUDIO_IDS = {
  board: 'html-board_flow-clarification-v1',
  evidenceManifest: 'evidence-manifest_flow-clarification-v1',
  intent: 'intent-record_flow-clarification-v1',
  review: 'review-object_flow-clarification-v1',
  sourceBlock: 'live-app-block_flow-clarification-v1-source',
  surface: 'surface-run_flow-clarification-v1',
  taskCollection: 'collection_flow-clarification-v1-tasks'
} as const

export const FLOW_STUDIO_SPEC: FlowStudioSpec = {
  capturedAt: '2026-07-14T14:00:00.000Z',
  conversation: [
    { author: 'user', body: 'People drop off here. Make this flow clearer.' },
    {
      author: 'agent',
      body: 'I found two viable structures. I will keep the source unchanged and make the differences inspectable.'
    }
  ],
  decision: {
    body: 'Prefer four clear steps over a compressed percentage indicator.',
    status: 'accepted'
  },
  evidence: [
    {
      access: 'allowed',
      facts: { referenceType: 'capability-montage', suppliedByUser: true },
      freshness: 'current',
      id: 'evidence-user-reference',
      observedAt: '2026-07-14T13:45:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T14:00:00.000Z',
      sourceRef: 'captured://user-reference/executable-knowledge-os',
      summary:
        'The supplied image demonstrates that intent, source context, alternatives, evidence, and decisions can coexist as one executable knowledge experience.',
      title: 'User supplied a complete capability example',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { renderer: 'definition-surface', route: '/add-patient' },
      freshness: 'current',
      id: 'evidence-source-definition',
      observedAt: '2026-07-14T13:52:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T14:00:00.000Z',
      sourceRef: 'captured://smylr/source/patient-intake-form-definition',
      summary:
        'Smylr contains a source-backed patient intake definition and authenticated add-patient route, but this proving surface does not claim a healthy embedded runtime.',
      title: 'A real intake source exists',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { components: ['step-indicator', 'button', 'field-group'] },
      freshness: 'current',
      id: 'evidence-design-system',
      observedAt: '2026-07-14T13:55:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T14:00:00.000Z',
      sourceRef: 'captured://smylr/design-system/intake-patterns',
      summary:
        'The existing design system supports a restrained step indicator, field groups, and primary navigation controls.',
      title: 'Reusable intake patterns are available',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { errors: 19, leadingIssue: 'insurance.id' },
      freshness: 'stale',
      id: 'evidence-runtime-errors',
      observedAt: '2026-07-13T16:00:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T14:00:00.000Z',
      sourceRef: 'fixture://runtime-errors/intake-validation',
      staleAt: '2026-07-14T00:00:00.000Z',
      summary:
        'A labeled fixture models validation and verification failures around the insurance step.',
      title: 'Validation risk clusters around insurance',
      truthScope: 'fixture'
    },
    {
      access: 'allowed',
      facts: { dropOffPercent: 31.6, medianTimeSeconds: 522 },
      freshness: 'unknown',
      id: 'evidence-product-analytics',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T14:00:00.000Z',
      sourceRef: 'fixture://product-analytics/intake-funnel',
      summary:
        'A labeled fixture models a 31.6% drop-off before insurance completion; no live analytics connector is attached.',
      title: 'The flow may lose users before insurance',
      truthScope: 'fixture'
    },
    {
      access: 'allowed',
      facts: { sourceChanged: false, runtimeHealthy: false },
      freshness: 'current',
      id: 'evidence-capability-boundary',
      observedAt: '2026-07-14T14:00:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T14:00:00.000Z',
      sourceRef: 'derived://openpencil/flow-studio-capabilities',
      summary:
        'The generated comparison can inspect, prefer, undo, and approve a decision receipt. It cannot access the network or modify source.',
      title: 'This is a preview-only decision surface',
      truthScope: 'derived'
    }
  ],
  id: 'flow-clarification-v1',
  intent: {
    constraints: [
      'Treat the attached image as one possible output, not the product layout',
      'Never label reconstructed screens Live',
      'Keep source and external systems unchanged'
    ],
    desiredOutcome: 'Choose a clearer patient-intake structure',
    statement:
      'Use the available source, design, error, and product-signal evidence to compare clearer intake-flow options.'
  },
  options: [
    {
      evidenceItemIds: ['evidence-design-system', 'evidence-runtime-errors'],
      fieldGroups: [
        {
          fields: ['First name', 'Last name', 'Date of birth', 'Phone'],
          title: 'Patient information'
        },
        { fields: ['Provider', 'Member ID'], title: 'Insurance' },
        { fields: ['Conditions', 'Medications'], title: 'Medical history' },
        { fields: ['Consent', 'Review'], title: 'Review' }
      ],
      id: 'option-calm-guided-flow',
      label: 'Option A',
      summary: 'Four explicit steps with one calm task per screen and visible progress.',
      title: 'Calm guided flow',
      tradeoff: 'More screens, but lower density and clearer recovery.',
      uncertainty:
        'The completion improvement remains a hypothesis until a real runtime and analytics source are attached.'
    },
    {
      evidenceItemIds: ['evidence-user-reference', 'evidence-product-analytics'],
      fieldGroups: [
        { fields: ['Name', 'DOB', 'Phone', 'Email'], title: 'Patient details' },
        { fields: ['Address', 'Insurance'], title: 'Contact and coverage' }
      ],
      id: 'option-compact-expert-flow',
      label: 'Option B',
      summary: 'A denser single-page structure optimized for experienced staff.',
      title: 'Compact expert flow',
      tradeoff: 'Fewer transitions, but more simultaneous fields and decisions.',
      uncertainty:
        'The target audience may be mixed; expert density could recreate the original clarity problem.'
    }
  ],
  signals: [
    {
      id: 'signal-design-system',
      kind: 'design-system',
      label: 'Step indicator and field-group patterns',
      truth: 'captured',
      value: '3 reusable patterns'
    },
    {
      id: 'signal-runtime-errors',
      kind: 'runtime-error',
      label: 'Insurance validation fixture',
      truth: 'fixture · stale',
      value: '19 modeled failures'
    },
    {
      id: 'signal-product-analytics',
      kind: 'analytics',
      label: 'Intake drop-off fixture',
      truth: 'fixture · unknown',
      value: '31.6% modeled drop-off'
    }
  ],
  source: {
    applicationId: 'smylr',
    environment: 'local-development',
    route: '/add-patient',
    scenarioId: 'synthetic-intake-clarification',
    sourceRevision: 'captured-2026-07-14',
    truth: 'illustrative-preview'
  },
  subject: 'Patient intake · Flow clarification',
  tasks: [
    { id: 'task-clarify-flow', status: 'in-progress', title: 'Clarify the intake flow' },
    { id: 'task-progress', status: 'done', title: 'Make progress explicit' },
    { id: 'task-validation', status: 'todo', title: 'Test inline validation' },
    { id: 'task-mobile', status: 'todo', title: 'Verify mobile completion' }
  ],
  title: 'Flow clarification studio',
  views: ['overview', 'focus', 'compare', 'review']
}

export const FLOW_STUDIO_RECOMMENDATIONS: DecisionRecommendation[] = FLOW_STUDIO_SPEC.options.map(
  (option, index) => ({
    evidenceItemIds: option.evidenceItemIds,
    id: option.id,
    rank: index + 1,
    rationale: option.summary,
    status: 'active',
    title: option.title,
    tradeoff: option.tradeoff,
    uncertainty: option.uncertainty
  })
)
