import type { EvidenceBriefSpec } from './types'

export const EVIDENCE_BRIEF_IDS = {
  board: 'html-board_intent-to-experience-brief-v1',
  evidenceManifest: 'evidence-manifest_intent-to-experience-brief-v1',
  intent: 'intent-record_intent-to-experience-brief-v1',
  surface: 'surface-run_intent-to-experience-brief-v1'
} as const

export const EVIDENCE_BRIEF_SPEC: EvidenceBriefSpec = {
  capturedAt: '2026-07-14T15:30:00.000Z',
  evidence: [
    {
      access: 'allowed',
      facts: { forms: ['brief', 'map', 'presentation', 'compare', 'decision', 'tool'] },
      freshness: 'current',
      id: 'evidence-bounded-form-registry',
      observedAt: '2026-07-14T15:20:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T15:30:00.000Z',
      sourceRef: 'captured://openpencil/surface-form-registry',
      summary:
        'The engine now names six bounded answer forms and records why a form was chosen instead of forcing every intent into one universal layout.',
      title: 'A bounded form registry exists',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { receipts: true, sharedSetupEntryPoint: true, testedRecipes: 2 },
      freshness: 'current',
      id: 'evidence-reusable-setup-tests',
      observedAt: '2026-07-14T15:24:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T15:30:00.000Z',
      sourceRef: 'captured://openpencil/tests/experience-setup',
      summary:
        'Focused engine tests prove that Decision and Compare recipes share one setup service while preserving safe interactions and exact receipts.',
      title: 'Two materially different recipes share one setup path',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { fullVisionComplete: false, rendererCoverage: 3 },
      freshness: 'current',
      id: 'evidence-honest-capability-boundary',
      observedAt: '2026-07-14T15:30:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T15:30:00.000Z',
      sourceRef: 'derived://openpencil/capability-boundary',
      summary:
        'The current build does not claim arbitrary program generation, live connectors, or source-changing actions. Missing renderers remain explicit work.',
      title: 'The capability boundary stays visible',
      truthScope: 'derived'
    }
  ],
  id: 'intent-to-experience-brief-v1',
  intent: {
    constraints: [
      'Do not turn the supplied mockup into a permanent shell',
      'Separate captured, derived, preview, and live truth',
      'Only claim forms and actions that have executable proof'
    ],
    desiredOutcome: 'Give the vision a clear, evidence-backed shape without freezing its outputs',
    statement:
      'Explain what the Intent-to-Experience OS is, what has been proven, and what the engine must earn next.'
  },
  openQuestions: [
    'Which inputs are sufficient for the engine to select a form without guessing?',
    'How should a generated experience declare missing evidence or unsupported actions?',
    'What is the smallest safe contract for promoting a reviewed preview into source?'
  ],
  sections: [
    {
      body: 'OpenPencil is becoming a translation layer between human intent, shared evidence, an appropriate interactive form, and durable learning. The output may look like a brief, map, presentation, comparison, decision surface, or tool.',
      evidenceItemIds: ['evidence-bounded-form-registry'],
      id: 'thesis',
      title: 'The thesis'
    },
    {
      body: 'The engine already has a typed workspace, explicit evidence manifests, a bounded form registry, safe preview interactions, and receipt reconstruction. Decision and Compare are executable recipes rather than detached mockups.',
      evidenceItemIds: ['evidence-reusable-setup-tests'],
      id: 'proven',
      title: 'What is proven'
    },
    {
      body: 'The next work is not more montage. It is a reusable setup composer, broader renderer coverage, connector-backed evidence, and a permissioned decision-to-action path that verifies the result.',
      evidenceItemIds: ['evidence-honest-capability-boundary'],
      id: 'next',
      title: 'What must be earned'
    }
  ],
  subject: 'OpenPencil · Intent-to-Experience OS',
  takeaway:
    'One shared truth can be expressed through many forms, but every form and action must carry evidence, permissions, and a reconstructable receipt.',
  title: 'The vision, without freezing the surface',
  views: ['overview', 'focus', 'sources', 'review']
}
