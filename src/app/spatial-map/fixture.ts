import { spatialMapObjectIds } from './model'
import type { SpatialMapSpec } from './types'

export const OPENPENCIL_SPATIAL_MAP: SpatialMapSpec = {
  capturedAt: '2026-07-14T16:20:00.000Z',
  defaultFocusedNodeId: 'form-selection',
  edges: [
    {
      confidence: 1,
      id: 'identity-to-evidence',
      label: 'anchors',
      relationshipType: 'enables',
      sourceId: 'canonical-model',
      targetId: 'evidence-boundary'
    },
    {
      confidence: 1,
      id: 'intent-to-form',
      label: 'asks for',
      relationshipType: 'enables',
      sourceId: 'human-intent',
      targetId: 'form-selection'
    },
    {
      confidence: 0.95,
      id: 'evidence-to-form',
      label: 'justifies',
      relationshipType: 'enables',
      sourceId: 'evidence-boundary',
      targetId: 'form-selection'
    },
    {
      confidence: 1,
      id: 'registry-to-form',
      label: 'bounds',
      relationshipType: 'enables',
      sourceId: 'renderer-registry',
      targetId: 'form-selection'
    },
    {
      confidence: 1,
      id: 'form-to-answer',
      label: 'produces',
      relationshipType: 'produces',
      sourceId: 'form-selection',
      targetId: 'interactive-answer'
    },
    {
      confidence: 1,
      id: 'permission-to-answer',
      label: 'constrains',
      relationshipType: 'blocks',
      sourceId: 'permission-boundary',
      targetId: 'interactive-answer'
    },
    {
      confidence: 1,
      id: 'answer-to-receipt',
      label: 'records into',
      relationshipType: 'produces',
      sourceId: 'interactive-answer',
      targetId: 'outcome-receipt'
    },
    {
      confidence: 1,
      id: 'identity-to-receipt',
      label: 'preserves identity',
      relationshipType: 'enables',
      sourceId: 'canonical-model',
      targetId: 'outcome-receipt'
    },
    {
      confidence: 0.9,
      id: 'receipt-to-learning',
      label: 'updates',
      relationshipType: 'enables',
      sourceId: 'outcome-receipt',
      targetId: 'durable-learning'
    }
  ],
  evidence: [
    {
      access: 'allowed',
      facts: { canonicalTypes: 4, stableRevisions: true },
      freshness: 'current',
      id: 'evidence-canonical-lineage',
      observedAt: '2026-07-14T16:00:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T16:20:00.000Z',
      sourceRef: 'captured://openpencil/workspace/canonical-lineage',
      summary:
        'Intent, evidence, interactive runs, and receipts retain stable object IDs and exact revisions.',
      title: 'Canonical lineage is implemented',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { form: 'map', requiredTrait: 'relationships', writes: false },
      freshness: 'current',
      id: 'evidence-map-form-registry',
      observedAt: '2026-07-14T16:05:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T16:20:00.000Z',
      sourceRef: 'captured://openpencil/surface-forms/map',
      summary:
        'The bounded form registry selects Map when relationships are the important part of the answer.',
      title: 'Map is a declared answer form',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { idempotency: true, revisionChecks: 3, sourceWrites: false },
      freshness: 'current',
      id: 'evidence-safe-interactions',
      observedAt: '2026-07-14T16:08:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T16:20:00.000Z',
      sourceRef: 'captured://openpencil/surface-events',
      summary:
        'Surface events require exact workspace, surface, and artifact revisions and replay by event ID.',
      title: 'Interactions have a safe mutation envelope',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { connectors: 'not-integrated', fullVisionComplete: false },
      freshness: 'current',
      id: 'evidence-honest-boundary',
      observedAt: '2026-07-14T16:20:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T16:20:00.000Z',
      sourceRef: 'derived://openpencil/spatial-map/capability-boundary',
      summary:
        'The proving renderer explains dependencies but does not claim connector access, external execution, or production source changes.',
      title: 'The remaining boundary is explicit',
      truthScope: 'derived'
    }
  ],
  id: 'intent-to-experience-dependency-map-v1',
  insight:
    'The form is not the product. Durable learning depends on preserving the exact path from intent and evidence through interaction to receipt.',
  intent: {
    constraints: [
      'Use a relationship map only when dependencies matter',
      'Keep evidence and derived conclusions visibly distinct',
      'Do not allow network, external, or source writes'
    ],
    desiredOutcome:
      'Show which foundations make arbitrary intent-to-experience generation trustworthy',
    statement:
      'Explain the OpenPencil vision as a dependency map so the user can inspect what enables what and where the remaining boundary sits.'
  },
  nodes: [
    {
      evidenceItemIds: [],
      id: 'human-intent',
      kind: 'intent',
      label: 'Human intent',
      status: 'proven',
      summary: 'A person states the outcome they want without prescribing the final interface.'
    },
    {
      evidenceItemIds: ['evidence-canonical-lineage'],
      id: 'canonical-model',
      kind: 'foundation',
      label: 'Canonical model',
      status: 'proven',
      summary: 'Stable IDs and revisions keep every form attached to the same underlying knowledge.'
    },
    {
      evidenceItemIds: ['evidence-honest-boundary'],
      id: 'permission-boundary',
      kind: 'constraint',
      label: 'Permission boundary',
      status: 'partial',
      summary: 'Capabilities stay denied unless the experience declares and earns them explicitly.'
    },
    {
      evidenceItemIds: ['evidence-canonical-lineage'],
      id: 'evidence-boundary',
      kind: 'foundation',
      label: 'Evidence boundary',
      status: 'proven',
      summary: 'Captured and derived facts carry source, freshness, permission, and truth scope.'
    },
    {
      evidenceItemIds: ['evidence-map-form-registry'],
      id: 'renderer-registry',
      kind: 'foundation',
      label: 'Bounded renderer registry',
      status: 'partial',
      summary:
        'Named forms expose suitability and supported interactions without a universal mega-spec.'
    },
    {
      evidenceItemIds: ['evidence-map-form-registry'],
      id: 'form-selection',
      kind: 'capability',
      label: 'Form selection',
      status: 'partial',
      summary:
        'The engine chooses Map because relationships, not sequence or adjustment, drive this job.'
    },
    {
      evidenceItemIds: ['evidence-safe-interactions'],
      id: 'interactive-answer',
      kind: 'capability',
      label: 'Interactive answer',
      status: 'partial',
      summary: 'The user can inspect nodes and approve the exact relationship model presented.'
    },
    {
      evidenceItemIds: ['evidence-canonical-lineage', 'evidence-safe-interactions'],
      id: 'outcome-receipt',
      kind: 'foundation',
      label: 'Outcome receipt',
      status: 'proven',
      summary:
        'Approval freezes exact intent, evidence, graph, surface, artifact, and correction revisions.'
    },
    {
      evidenceItemIds: ['evidence-honest-boundary'],
      id: 'durable-learning',
      kind: 'outcome',
      label: 'Durable learning',
      status: 'missing',
      summary:
        'Future runs should learn from reviewed outcomes without treating unverified output as truth.'
    }
  ],
  question: 'What must exist for any generated experience to remain trustworthy?',
  title: 'The dependency map beneath every experience'
}

export const SPATIAL_MAP_IDS = spatialMapObjectIds(OPENPENCIL_SPATIAL_MAP)
