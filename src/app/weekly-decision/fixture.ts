import type { DecisionRecommendation, EvidenceManifestItem } from '@/app/workspace'

import type { OptionWorkbenchSpec } from './types'

export const WEEKLY_DECISION_IDS = {
  evidenceManifest: 'evidence-manifest_weekly-decision-v1',
  intent: 'intent-record_weekly-decision-v1',
  surface: 'surface-run_weekly-decision-v1'
} as const

export const WEEKLY_DECISION_CAPTURED_AT = '2026-07-13T15:00:00.000Z'

export const WEEKLY_DECISION_EVIDENCE: EvidenceManifestItem[] = [
  {
    access: 'allowed',
    facts: { failures: 1, suite: 'workspace baseline', tests: 29 },
    freshness: 'current',
    id: 'evidence-runtime-baseline',
    observedAt: '2026-07-13T14:42:00.000Z',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'captured://openpencil/unit-baseline',
    summary:
      'The focused workspace baseline passes, while the live served route still needs a visible run receipt.',
    title: 'Engine baseline is green; live receipt is missing',
    truthScope: 'captured'
  },
  {
    access: 'allowed',
    facts: { identities: 2, target: 1 },
    freshness: 'current',
    id: 'evidence-identity-split',
    observedAt: '2026-07-13T14:50:00.000Z',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'captured://openpencil/semantic-adapter-review',
    summary:
      'The workspace UI and semantic adapter can resolve different document and page identities for the same visible board.',
    title: 'HTML surface and workspace identity can diverge',
    truthScope: 'captured'
  },
  {
    access: 'allowed',
    facts: { persistedCorrections: 0, receipts: 0 },
    freshness: 'stale',
    id: 'evidence-decision-loop',
    observedAt: '2026-07-12T19:00:00.000Z',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'fixture://openpencil/decision-loop-audit',
    staleAt: '2026-07-13T07:00:00.000Z',
    summary:
      'This fixture models the known gap: a board can present a recommendation without preserving the user correction and exact artifact revision.',
    title: 'Decision corrections do not yet produce a receipt',
    truthScope: 'fixture'
  },
  {
    access: 'allowed',
    facts: { enforcedChecks: 2, modeledFlags: 3 },
    freshness: 'current',
    id: 'evidence-permission-boundary',
    observedAt: '2026-07-13T14:54:00.000Z',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'captured://openpencil/workspace-permission-review',
    summary:
      'Workspace mutations now enforce edit and view permissions; external writes remain outside this proving build.',
    title: 'Permission enforcement exists at the workspace boundary',
    truthScope: 'captured'
  },
  {
    access: 'allowed',
    facts: { externalWrites: false, networkAccess: false, sourceWrites: false },
    freshness: 'current',
    id: 'evidence-runtime-sandbox',
    observedAt: '2026-07-13T14:57:00.000Z',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'captured://openpencil/html-board-sandbox-review',
    summary:
      'The decision surface is limited to scripts and a typed bridge; its capability manifest prohibits network, source, and external writes.',
    title: 'The proving surface has a narrow runtime capability set',
    truthScope: 'captured'
  },
  {
    access: 'allowed',
    facts: { connectorCount: 0, queryMode: 'local lexical' },
    freshness: 'current',
    id: 'evidence-query-boundary',
    observedAt: '2026-07-13T14:47:00.000Z',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'last-known://openpencil/workspace-query-capabilities',
    summary:
      'Current retrieval is typed and local. It does not yet provide semantic organizational search or connector freshness.',
    title: 'Knowledge retrieval is useful but still locally bounded',
    truthScope: 'last-known'
  },
  {
    access: 'allowed',
    facts: { externalConnectors: 0, proposedFirstConnector: 'Linear' },
    freshness: 'unknown',
    id: 'evidence-connector-gap',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'derived://openpencil/capability-ledger',
    summary:
      'The planning evidence indicates no live Slack, Linear, Notion, Sentry, or PostHog connector is part of this build.',
    title: 'Organizational evidence is not live yet',
    truthScope: 'derived'
  },
  {
    access: 'allowed',
    facts: { mounted: false, projections: 5 },
    freshness: 'unknown',
    id: 'evidence-view-access',
    permissionScopes: ['workspace-metadata:read'],
    retrievedAt: WEEKLY_DECISION_CAPTURED_AT,
    sourceRef: 'last-known://openpencil/view-switcher-review',
    summary:
      'The domain supports multiple projections, but direct navigation among them is not yet a dependable everyday interaction.',
    title: 'Multiple views exist before the navigation experience is proven',
    truthScope: 'last-known'
  }
]

export const WEEKLY_DECISION_RECOMMENDATIONS: DecisionRecommendation[] = [
  {
    evidenceItemIds: [
      'evidence-runtime-baseline',
      'evidence-permission-boundary',
      'evidence-runtime-sandbox'
    ],
    id: 'recommendation-trust-build',
    rank: 1,
    rationale:
      'A real run, visible truth labels, and a reconstruction check are the minimum proof that the surface is trustworthy.',
    status: 'active',
    title: 'Trust the build you are looking at',
    tradeoff: 'This delays breadth in order to make one end-to-end path independently verifiable.',
    uncertainty: 'The live browser gate remains open until the real served app is exercised.'
  },
  {
    evidenceItemIds: ['evidence-identity-split', 'evidence-query-boundary', 'evidence-view-access'],
    id: 'recommendation-unify-identity',
    rank: 2,
    rationale:
      'Intent, evidence, HTML artifact, and receipt must resolve through one stable workspace and page identity.',
    status: 'active',
    title: 'Unify HTML surface and workspace identity',
    tradeoff: 'Canonical identity removes convenient transient targets from the semantic adapter.',
    uncertainty:
      'Legacy saved scenes may still contain projections written under older scope rules.'
  },
  {
    evidenceItemIds: ['evidence-decision-loop', 'evidence-connector-gap'],
    id: 'recommendation-close-loop',
    rank: 3,
    rationale:
      'Reorders, rejections, revisions, and approval become durable knowledge only when they are recorded against exact revisions.',
    status: 'active',
    title: 'Close the receipt-backed decision loop',
    tradeoff:
      'The first surface supports a narrow, typed interaction set instead of arbitrary embedded actions.',
    uncertainty:
      'The evidence is a deliberately labeled fixture until more live connectors are attached.'
  }
]

export const WEEKLY_DECISION_SPEC: OptionWorkbenchSpec = {
  actorId: 'openpencil-proving-build',
  capturedAt: WEEKLY_DECISION_CAPTURED_AT,
  evidence: WEEKLY_DECISION_EVIDENCE,
  formRationale:
    'A ranked review sheet makes evidence, tradeoffs, correction, and approval visible in one bounded surface.',
  id: 'weekly-decision-v1',
  intent: {
    constraints: [
      'No external, source, or network writes',
      'Every claim exposes its truth scope and freshness',
      'Approval must reconstruct from exact revisions'
    ],
    desiredOutcome: 'Choose the next OpenPencil proving-build priority',
    statement:
      'Turn current engine evidence into a ranked, correctable weekly decision and preserve the result as durable knowledge.'
  },
  mode: 'decision',
  recommendations: WEEKLY_DECISION_RECOMMENDATIONS,
  rendererId: 'weekly-decision-v1',
  title: 'Weekly decision — OpenPencil proving build'
}
