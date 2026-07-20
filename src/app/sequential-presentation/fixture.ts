import type { SequentialPresentationSpec } from './types'

export const SEQUENTIAL_PRESENTATION_IDS = {
  board: 'html-board_intent-to-experience-presentation-v1',
  evidenceManifest: 'evidence-manifest_intent-to-experience-presentation-v1',
  intent: 'intent-record_intent-to-experience-presentation-v1',
  surface: 'surface-run_intent-to-experience-presentation-v1'
} as const

export const SEQUENTIAL_PRESENTATION_SPEC: SequentialPresentationSpec = {
  capturedAt: '2026-07-14T17:00:00.000Z',
  evidence: [
    {
      access: 'allowed',
      facts: {
        canonicalChain: ['IntentRecord', 'EvidenceManifest', 'SurfaceRun', 'DecisionReceipt'],
        stableIdentity: true
      },
      freshness: 'current',
      id: 'evidence-presentation-canonical-chain',
      observedAt: '2026-07-14T16:42:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T17:00:00.000Z',
      sourceRef: 'captured://openpencil/workspace/canonical-chain',
      summary:
        'The engine already preserves stable intent, evidence, surface, and decision identities across interactive HTML artifacts.',
      title: 'The canonical knowledge chain exists',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: {
        answerForms: ['brief', 'map', 'presentation', 'compare', 'decision', 'tool'],
        unrestrictedGeneration: false
      },
      freshness: 'current',
      id: 'evidence-presentation-form-registry',
      observedAt: '2026-07-14T16:46:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T17:00:00.000Z',
      sourceRef: 'captured://openpencil/surface-form-registry',
      summary:
        'A bounded form registry lets the same evidence become a brief, map, sequence, comparison, decision, or tool without claiming arbitrary generation.',
      title: 'One truth can support multiple bounded forms',
      truthScope: 'captured'
    },
    {
      access: 'allowed',
      facts: { requiredViewsAtOnce: 1, sequenceNavigation: true },
      freshness: 'current',
      id: 'evidence-presentation-progressive-disclosure',
      observedAt: '2026-07-14T16:50:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T17:00:00.000Z',
      sourceRef: 'derived://openpencil/design-direction/progressive-disclosure',
      summary:
        'A sequential form earns its place when one idea should be understood before the next; it should not reproduce a cockpit of simultaneous panels.',
      title: 'Sequence is a progressive-disclosure tool',
      truthScope: 'derived'
    },
    {
      access: 'allowed',
      facts: { externalWrites: false, networkAccess: false, sourceWrites: false },
      freshness: 'current',
      id: 'evidence-presentation-runtime-boundary',
      observedAt: '2026-07-14T16:54:00.000Z',
      permissionScopes: ['workspace-metadata:read'],
      retrievedAt: '2026-07-14T17:00:00.000Z',
      sourceRef: 'captured://openpencil/html-board/runtime-boundary',
      summary:
        'The HTML renderer can navigate and record approval while network, source, and external writes remain prohibited.',
      title: 'Interaction does not require broad write authority',
      truthScope: 'captured'
    }
  ],
  id: 'intent-to-experience-presentation-v1',
  intent: {
    constraints: [
      'Tell one coherent story instead of reproducing the supplied cockpit',
      'Keep every claim tied to inspectable evidence',
      'Navigation and approval must preserve exact revisions',
      'No network, source, or external-system writes'
    ],
    desiredOutcome:
      'Demonstrate that OpenPencil can answer through a purposeful sequence as well as through a board or document',
    statement:
      'Turn the Intent-to-Experience vision into a short, evidence-backed presentation that can be navigated, approved, and reconstructed exactly.'
  },
  review: {
    approvalLabel: 'Approve this sequence',
    approvalMeaning:
      'Record this ordered presentation and its exact evidence basis as the accepted explanation.',
    approvalNotMeaning:
      'No source code, production runtime, connector, or external system is changed.'
  },
  slides: [
    {
      body: 'OpenPencil should translate a human goal into the form that makes the next understanding or decision easiest—not force every answer into chat or one giant board.',
      evidenceItemIds: ['evidence-presentation-form-registry'],
      eyebrow: '01 · Thesis',
      id: 'thesis',
      layout: 'statement',
      title: 'An answer can be an experience.'
    },
    {
      body: 'The engine keeps one durable chain underneath every renderer. A brief, map, presentation, comparison, decision surface, or tool remains a projection of the same intent and evidence.',
      evidenceItemIds: [
        'evidence-presentation-canonical-chain',
        'evidence-presentation-form-registry'
      ],
      eyebrow: '02 · Shared model',
      id: 'shared-model',
      layout: 'sequence',
      points: ['Intent', 'Evidence', 'Interactive form', 'Human correction', 'Durable receipt'],
      title: 'One truth, many useful forms.'
    },
    {
      body: 'Presentation is appropriate when order matters: establish the thesis, reveal its evidence, make the boundary clear, then ask for a decision. Only the current idea should dominate the frame.',
      evidenceItemIds: ['evidence-presentation-progressive-disclosure'],
      eyebrow: '03 · Why this form',
      id: 'why-sequence',
      layout: 'contrast',
      points: ['One focal idea', 'Visible progress', 'Evidence on demand', 'No miniature cockpit'],
      title: 'Sequence is not decoration. It controls attention.'
    },
    {
      body: 'Advancing changes the saved presentation revision. Approval creates a decision receipt. Neither action grants the generated document access to the network, source tree, or external systems.',
      evidenceItemIds: ['evidence-presentation-runtime-boundary'],
      eyebrow: '04 · Trust boundary',
      id: 'trust-boundary',
      layout: 'evidence',
      points: [
        'Navigate: workspace metadata only',
        'Approve: receipt only',
        'Source writes: denied'
      ],
      title: 'The presentation can be interactive without being powerful.'
    },
    {
      body: 'Approving this sequence accepts one ordered explanation and preserves the exact intent, evidence, artifact, corrections, and final slide. It does not declare the entire OpenPencil vision complete.',
      evidenceItemIds: [
        'evidence-presentation-canonical-chain',
        'evidence-presentation-runtime-boundary'
      ],
      eyebrow: '05 · Review',
      id: 'review',
      layout: 'closing',
      title: 'Record the story. Keep the system honest.'
    }
  ],
  subject: 'OpenPencil · Sequential answer form',
  subtitle:
    'A bounded proof that agent output can be a navigable story, not only prose or a board.',
  title: 'From intent to experience'
}
