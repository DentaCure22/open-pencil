# Weekly Decision Surface — Build 1 Receipt

Status: **PROVEN LOCALLY / candidate pattern**  
Date: **2026-07-13**  
Build method: **Build first, then revise the specification from observed evidence**  
Master plan: [`../vision/openpencil-build-first-master-plan.md`](../vision/openpencil-build-first-master-plan.md)

## Outcome

OpenPencil now has one real, bounded intent-to-decision loop in the canonical engine:

`IntentRecord → EvidenceManifest → SurfaceRun → structured corrections → DecisionReceipt`

One short weekly-planning intent creates an evidence-backed interactive HTML surface. A person can inspect evidence, reorder, reject, restore, revise, and approve the recommendations. The engine persists those corrections against exact object and artifact revisions, records the final decision without touching source or an external system, and reconstructs the approved state after reload.

This result proves the implementation locally. It does not yet prove that the form wins across repeated human use or that OpenPencil can choose arbitrary presentation forms.

## Build goal

Demonstrate the smallest trustworthy version of the north-star loop:

> Intent → evidence → interactive model → human decision → durable learning

The user job was:

> Given the work, bugs, product signals, designs, and evidence in front of us, what should we fix or ship this week?

The risky hypothesis was that a bounded evidence set and clear intent can produce a more useful decision experience than a normal prose response.

## Canonical run manifest

| Field | Value |
|---|---|
| Canonical engine | `/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base` |
| Planning/spec home | `/Users/omar/Documents/Open Pencil` |
| Live route used | `http://localhost:3000/open-pencil?smylr-app=&smylr-page=smylr-tokens` |
| OpenPencil dev server | Vite on `http://localhost:1420/open-pencil/` through the Smylr route |
| Runtime | Bundled Bun for unit/build; Codex bundled Node for Playwright |
| Final source/test digest | `11a1ab5c306c78fbf3c5fe93762de0d2297e4d37a64dddfd24e2384406aa445f` |
| Source parity | Canonical engine and `/tmp/openpencil-build1` staging copy match, excluding generated output |
| Repository status | The canonical engine directory is not a Git worktree; the digest and staging parity check are the present audit trail |

The digest covers all files returned by `rg --files src tests`, sorted with null-safe filenames and hashed with SHA-256.

## Canonical identities

The proving fixture uses stable identities:

| Object | Stable ID |
|---|---|
| Intent | `intent-record_weekly-decision-v1` |
| Evidence manifest | `evidence-manifest_weekly-decision-v1` |
| Surface run | `surface-run_weekly-decision-v1` |
| HTML artifact | `html-board_weekly-decision-v1` |

The surface is the canonical decision object. The HTML board is its versioned projection, not a second store of intent, evidence, or decision truth.

## What was implemented

### 1. Shared identity and lineage

- Added first-class `IntentRecord`, `EvidenceManifest`, `SurfaceRun`, `SurfaceInteraction`, and `DecisionReceipt` workspace types.
- Added stable object and HTML artifact revision references.
- Migrated workspace serialization from schema version 1 to 2 without changing the existing registry key or storage prefix.
- Validated exact referenced revisions, evidence access/redaction, recommendation citations, artifact identity, final order, corrections, and receipt classification.
- Made intent, evidence snapshots, decided surfaces, and receipts immutable at the correct lifecycle points.
- Corrected the existing identity split: semantic operations now use the graph root document and base page, matching the workspace UI instead of a transient tab/current projection.

### 2. Eight-record evidence pack

The manifest deliberately mixes truth and freshness states rather than presenting everything as live:

| Evidence | Truth scope | Freshness | Purpose |
|---|---|---|---|
| Engine baseline and missing live receipt | Captured | Current | Establish technical baseline and the need for visible proof |
| HTML/workspace identity divergence | Captured | Current | Support canonical identity work |
| Missing correction receipt | Fixture | Stale | Model the known historical decision-loop gap without calling it live |
| Workspace permission boundary | Captured | Current | Show enforced local edit/view behavior |
| Restricted decision runtime | Captured | Current | Prove no network/source/external-write capability |
| Local lexical query boundary | Last-known | Current | Keep retrieval limits visible |
| Missing organizational connectors | Derived | Unknown | Avoid implying Slack/Linear/Notion/Sentry/PostHog are integrated |
| Multi-view navigation gap | Last-known | Unknown | Separate domain projection support from a proven everyday experience |

### 3. Interactive decision surface

The generated surface is a focused review sheet, not a dashboard or a pile of cards. It contains three ranked recommendations:

1. Trust the build you are looking at.
2. Unify HTML surface and workspace identity.
3. Close the receipt-backed decision loop.

The working surface supports:

- Evidence selection and progressive disclosure
- Keyboard-accessible up/down reordering
- Reject with preserved rejected state
- Restore
- Inline revision
- Approval only after host persistence succeeds
- A persistent receipt state that keeps the final ranking visible

The iframe emits only validated `surface-event` messages. The host service checks the expected workspace, surface, and artifact revisions, applies one domain mutation, regenerates the artifact revision, and returns the authoritative result.

### 4. Capability and write boundary

The Weekly Decision surface declares and enforces:

- Network: none
- Navigation: none
- Forms: none
- Popups/modals: none
- Host storage: none
- Source writes: none
- External-system writes: none

The iframe sandbox is `allow-scripts` only, and the generated document embeds a restrictive content-security policy. Approval records a decision receipt; it is not source approval or source application.

### 5. Permission and reconstruction behavior

- Query results, collections, and backlinks do not expose objects without `canView`.
- Update, relation, projection, archive, and restore paths require the corresponding edit capability.
- A decided surface and every receipt are immutable.
- Reconstruction requires exact intent, manifest, surface, board, board schema, board revision, and source-hash equality.
- Missing or mismatched history returns `reconstruction_conflict`; it never silently substitutes the latest version.

## Implementation map

Primary implementation:

- `src/app/weekly-decision/fixture.ts`
- `src/app/weekly-decision/render.ts`
- `src/app/weekly-decision/service.ts`
- `src/app/weekly-decision/types.ts`
- `src/app/weekly-decision/index.ts`

Shared domain and enforcement:

- `src/app/workspace/types.ts`
- `src/app/workspace/factories.ts`
- `src/app/workspace/permissions.ts`
- `src/app/workspace/errors.ts`
- `src/app/workspace/mutation.ts`
- `src/app/workspace/serialization.ts`
- `src/app/workspace/query.ts`

Projection and runtime integration:

- `src/app/html-board/workspace.ts`
- `src/components/canvas/HtmlBoardEmbeds.vue`
- `src/app/automation/bridge/workspace-semantic-adapter.ts`
- `src/app/workspace-ui/projection.ts`
- `src/app/workspace-ui/object-label.ts`
- `src/components/workspace/WorkspaceObjectInspector.vue`

Acceptance tests:

- `tests/engine/app/weekly-decision-surface.test.ts`
- `tests/e2e/decision/weekly-decision.spec.ts`

## Verification receipt

### Focused domain/runtime suite

Result: **38 passed, 0 failed, 160 expectations**

```bash
env BUN_TMPDIR=/tmp /Users/omar/.bun/bin/bun test \
  tests/engine/app/weekly-decision-surface.test.ts \
  tests/engine/app/workspace/domain.test.ts \
  tests/engine/app/workspace/persistence.test.ts \
  tests/engine/app/knowledge-workspace-ui.test.ts \
  tests/engine/mcp/smylr-semantic-registration.test.ts \
  tests/engine/app/narrated-trace.test.ts \
  tests/engine/app/narrated-trace-history.test.ts
```

The Weekly Decision tests cover five deterministic scenarios: canonical lineage, revision/idempotency behavior, permission denial, truth/freshness labels with runtime restrictions, and exact correction/receipt reconstruction after serialization.

### Browser acceptance

Result: **2 passed in 4.2 seconds**

```bash
env PATH="/Users/omar/.bun/bin:/Users/omar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  BUN_TMPDIR=/tmp \
  /Users/omar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  node_modules/@playwright/test/cli.js test \
  tests/e2e/decision/weekly-decision.spec.ts \
  --project=openpencil
```

The browser tests complete corrections plus exact approval/reload and protect the closed-panel fit-to-viewport regression discovered during visual review.

### Production build

Result: **passed — Vite built 4,056 modules in 1.58 seconds**

```bash
env BUN_TMPDIR=/tmp SMYLR_OPENPENCIL_BASE=/open-pencil/ \
  /Users/omar/.bun/bin/bunx vite build
```

The build retains existing non-blocking warnings elsewhere in the project. A broader type check also still reports pre-existing unrelated errors in `packages/dom-css` and Smylr live-inspector asset code; the focused Build 1 suite and production bundle contain no new feature failure.

## Real served-app run

The real Smylr/OpenPencil route was exercised manually:

1. Created the stable Weekly Decision board from `Decide → Weekly decision`.
2. Started in review at board revision 1.
3. Reordered a priority at revision 2.
4. Rejected the identity priority at revision 3.
5. Revised the first priority to “Prove the live run and preserve its exact receipt” at revision 4.
6. Approved the plan; the board reached revision 6 after the explicit approved-workflow revision.
7. Confirmed four persisted corrections and a disabled `Decision recorded` action.
8. Reloaded the complete app and recovered the approved revision-6 state and correction count.

No console errors occurred. Existing splitter normalization warnings were observed but are unrelated to the decision feature.

## Visual quality receipt

Screenshot: [`../../artifacts/weekly-decision-surface-build1-approved.png`](../../artifacts/weekly-decision-surface-build1-approved.png)

The first live review exposed a real engine issue: fit-to-board reserved width for closed side panels, reducing the usable board to roughly 40% of the canvas. The fit calculation now reserves panel width only when those panels are open, and a browser regression test protects the behavior.

Final manual design score: **88/100**

| Dimension | Score |
|---|---:|
| Hierarchy | 18/20 |
| Composition | 17/20 |
| Typography | 17/20 |
| Density and progressive disclosure | 17/20 |
| Interaction and trust | 19/20 |

## Learning receipt

### What worked

- A narrow review form was sufficient for one real weekly-priority decision.
- The HTML board can act as a dynamic projection while workspace objects retain durable identity and truth.
- Typed in-surface events can close the correction/decision loop without granting arbitrary iframe mutation power.
- Immutable evidence snapshots plus exact artifact references make a trustworthy historical receipt possible without a generalized object-history system.
- Screenshot review found a consequential engine fit bug that unit-only work would have missed.

### What remains unproven

- Whether the surface beats a concise prose answer in repeated human sessions.
- Whether OpenPencil can select this form automatically better than an explicit template choice.
- Whether the object chain remains useful in a materially different renderer or workflow.
- Whether real organizational connectors improve the decision enough to justify their complexity.
- Whether the canonical nested checkout should be migrated to a version-controlled primary repository.

### Contract decision

Candidate patterns created:

- Canonical intent/evidence/surface/receipt chain
- Exact HTML artifact lineage
- Typed decision-event bridge
- Immutable reconstruction receipt
- Narrow generated-runtime capability manifest

Contracts promoted: **none at the universal product layer**. The canonical root/base-page scope correction is accepted as a technical fix. The remaining patterns need repeated human use and cross-build reuse.

No `PresentationSpec`, connector framework, arbitrary-program contract, or source-application path was added.

## Gate result and next build decision

Gate result: **PROVEN LOCALLY / candidate pattern**

- Automated deterministic scenarios: 5/5 passing
- Focused browser acceptance: 2/2 passing
- Real human dogfood sessions: 1/5 completed
- Provisional threshold: 3/5 passing real sessions

Four real sessions remain for the full five-run review. If the first session counts as passing, two more successful sessions would reach the provisional threshold, but all five should still be run and recorded. Each session must capture time to useful surface, time to decision, clarification/reconstruction count, user correction behavior, confidence change, rubric score, and a prose-baseline comparison.

Build 2, One Truth, Three Views, should begin only after the Build 1 dogfood gate is either promoted, pivoted, or explicitly accepted as an overlapping experiment.

## Build receipt

- Build ID and artifact revision: `surface-run_weekly-decision-v1`; live approved board revision 6
- User job: decide what OpenPencil should fix or ship this week
- Risky hypothesis: bounded evidence plus clear intent can create a better decision experience than prose
- Evidence sources and truth scopes: eight captured, fixture, last-known, and derived records
- Allowed actions: inspect, reorder, reject, restore, revise, approve, persist receipt
- Forbidden actions: network, source write, external write, popup, navigation, host storage
- Runs completed: five deterministic automated scenarios; two browser acceptance cases; one manual live served-app session
- Gate result: **PROVEN LOCALLY / candidate pattern**
- Trust/safety outcome: exact revisions and reload reconstruction passed; no source or external write capability
- User corrections: reorder, reject, revise, and approve persisted as four structured interactions
- Candidate patterns: canonical object chain, typed event bridge, exact receipt reconstruction, capability manifest
- Contracts promoted: no universal product contract
- Duplicate path retired: transient tab/current-projection semantic scope for workspace identity
- Highest-value next uncertainty: repeated human usefulness against a prose baseline
