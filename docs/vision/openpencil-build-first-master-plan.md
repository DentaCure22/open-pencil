# OpenPencil Build-First Master Plan

Status: **Living master plan — v0.2**  
Date: **2026-07-13**  
Method: **Build first, extract the specification from evidence**  
Canonical planning home: `/Users/omar/Documents/Open Pencil`  
Current implementation under review: `/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base`

This is not a claim that the final OpenPencil architecture is known. It is the operating document for discovering that architecture through useful, real builds. It separates the stable vision from the hypotheses, technical capabilities, and product behavior that still need proof.

---

## 1. Master goal

Build OpenPencil into an **intent-to-experience system** that can repeatedly:

1. Understand what a person is trying to understand, decide, communicate, create, or change.
2. Assemble the relevant knowledge and evidence without hiding its source, freshness, permissions, or uncertainty.
3. Compose the most useful form for that job: a brief, spatial board, comparison, dashboard, presentation, workflow, live product view, or bounded interactive program.
4. Let the person inspect, correct, compare, decide, or act inside that experience.
5. Return the resulting corrections, decisions, approvals, and outcomes to durable knowledge with complete provenance.

The north-star loop is:

> **Intent → evidence → interactive model → human action or decision → durable learning**

The program succeeds when this loop works across materially different real user jobs and gets faster, safer, and more reusable with each build. It does **not** succeed merely because OpenPencil can generate an attractive artifact, register many tools, or imitate every existing work application.

### Product boundary

Slack, Linear, Notion, Figma, Storybook, Sentry, PostHog, presentations, documents, canvases, dashboards, and small programs may be:

- Sources of evidence
- Interaction patterns worth reusing
- Renderers of the same underlying knowledge
- Destinations for an approved action

They do not individually define the product. OpenPencil's boundary is the complete intent-to-outcome loop.

### What OpenPencil is reaching for

Software is a dynamic model of knowledge, rules, state, and possible action. OpenPencil asks whether the same medium can become the normal interface between a person and an agent:

- A person can express short intent while their current screen, selection, and work provide context.
- The agent can answer in a form that is more useful than chat when the job requires more than chat.
- The answer can be inspected and manipulated rather than passively consumed.
- The work can become a durable object, a reusable workflow, or eventually a bounded program when evidence shows that is valuable.
- What the person does in the result becomes knowledge for the next agent or collaborator.

This is the vision. Whether every board should become a program, whether an agent can reliably choose the right form, and which data model best supports that are still open hypotheses.

---

## 2. Operating doctrine: build first, then specify

The vision is stable enough to guide us. The final architecture is not.

The specification is a **living evidence ledger**, not a frozen blueprint:

> **Vision → proving build → observed evidence → contract/spec revision → consolidation → next proving build**

Every proving build must follow this loop:

1. Choose one real human outcome and the most consequential uncertainty behind it.
2. Define observable success before implementation without prescribing an unearned universal architecture.
3. Build the smallest real end-to-end slice in the actual OpenPencil/live-product path.
4. Use real identity, evidence, state, and runtime wherever possible; label fixtures and substitutes visibly.
5. Observe task completion, corrections, trust failures, reuse, and where the user leaves the generated surface.
6. Record what the build proved, weakened, disproved, or failed to test.
7. Promote demonstrated behavior into shared contracts only when the evidence threshold is met.
8. Consolidate repeated primitives and retire duplicate or failed paths.
9. Revise this document and select the next highest-value uncertainty.

A failed proving build is valuable when it clearly invalidates an assumption and prevents the engine from hardening around it. An attractive demo without a learning receipt is not a completed proving build.

### Evidence status vocabulary

Every material claim in this plan must use one of these statuses:

| Status | Meaning | Promotion rule |
|---|---|---|
| **Invariant** | A product or trust law that must hold before and during experiments | Non-negotiable unless the vision itself changes |
| **Open hypothesis** | Desired behavior not demonstrated end to end | Must be tested by a named proving build |
| **Candidate pattern** | Worked once in a bounded implementation or use | Needs repeated runs and later reuse |
| **Provisional contract** | Passed the active build's gate in at least 3 of 5 dogfood runs | May be reused, but remains reversible |
| **Proven contract** | Reused successfully in a materially different build or sustained real use, with failure behavior, tests, and a compatibility story | Becomes part of the core specification |
| **Rejected or retired** | Evidence showed the idea should not define the engine | Preserve the decision and reason; remove duplicate ownership |

Code existence, a mockup, green unit tests, or an authored delivery report does not by itself establish a proven product contract.

### Consolidation rules

1. Abstract after a concrete success, not before it.
2. One success creates a candidate; successful cross-build reuse earns a contract.
3. Consolidate identity, provenance, lifecycle, permissions, revisions, and receipts before generalized visual abstractions.
4. Preserve one durable object and evidence identity across views; do not copy knowledge into detached artifacts.
5. If two builds invent the same primitive, stop and extract it before a third.
6. If parallel systems own the same concept, choose one canonical owner and migrate or retire the others.
7. Build a connector only when a proving build requires it.
8. Every build leaves both a usable artifact and a learning receipt.
9. Real live-product acceptance outranks detached artifact success.
10. Consolidation accompanies the next proving build; it must not become an endless platform phase.

---

## 3. Product and trust invariants

These are laws, not optional experiments.

1. **No silent production writes.** Preferred, approved, and applied are separate states. A design decision is not source-write permission.
2. **Exact identity and revision.** Every intent, evidence item, artifact, comment, decision, change proposal, and verification receipt identifies its exact target and revision.
3. **Truth scopes remain distinct.** Captured evidence, fixture data, last-known snapshots, live runtime state, preview state, proposed source patches, production source, and external-system state must never masquerade as one another.
4. **Provenance is visible.** The user can inspect source, retrieval time, freshness, transformations, assumptions, and uncertainty.
5. **Permissions are enforced, not merely described.** Read, propose, approve, apply, and external write-back are distinct capabilities.
6. **Material actions require human authorization.** The user can preview scope, risk, and rollback before a consequential change.
7. **Every mutation is reviewable.** Use expected revisions, idempotency, dry runs where applicable, and ordinary undo/history.
8. **One semantic service.** UI actions, agent tools, and automation should operate through the same underlying domain behavior rather than parallel protocols.
9. **One durable identity across views.** Document, Canvas, Graph, Compare, and Review are projections, not separate copies of the same knowledge.
10. **Real verification is named honestly.** “Verified” requires the actual target, runtime, test, or external state—not only the presence of fields in a change set.
11. **Generated runtimes are capability-bounded.** Network, host, storage, popup, and external-action capabilities are explicit and testable.
12. **Sensitive data stays out of early proving builds.** Use synthetic or PHI-free evidence until governance, permissions, retention, and audit behavior are proven.

---

## 4. What currently exists

This is an evidence classification, not a completion claim. The implementation is substantial enough to support a real proving build, but it is split across models and has important trust and runtime gaps.

### Current capability ledger

| Capability | Current evidence | Status now | What it means |
|---|---|---|---|
| Scene-graph editor and spatial canvas | Existing OpenPencil foundation supports pages, frames, layers, selection, layout, undo/history, and spatial organization | Candidate technical foundation | Keep as the spatial and review substrate |
| HTML/CSS/JS board artifact | Versioned HTML boards, Design/Inspect/Interact behavior, responsive controls, revisions, branch/flow/review metadata, and a curated fixture set exist | Strong candidate pattern | The browser-rendered artifact can be the design, while the canvas organizes context around it |
| Typed knowledge workspace | Workspace domain includes typed objects, relations, revisions, projections, provenance fields, permissions metadata, idempotency, dry run, optimistic revision handling, query, and receipts | Candidate technical contract | Strong semantic base, not yet proof of a polished everyday knowledge workflow |
| Multiple projections | Document, Canvas, Graph/Atlas, and Review projections share typed object identity in the implemented vertical slice | Candidate pattern | Technically demonstrates one-object/multiple-view direction; task-level usefulness still needs proof |
| Semantic agent layer | One MCP/service path exposes context, mutation, activation, query, review, change-set, and source-handoff concepts | Candidate technical contract | Correct direction, but schemas, permissions, verification, and target truth need hardening |
| Live application workspace | Real application states, runtime ownership, snapshots, flows, safe variants, review transitions, and source/preview separation are represented | Strong candidate pattern | A credible base for later intent-to-safe-change work |
| Narrated intent direction | Trace implements transcript, selections, edits, ink, screenshots, navigation, stable targets, privacy-aware evidence, editable context, and Copy Context | Strong candidate and proven implementation path | Supports short intent plus screen context, but broad improvement to agent understanding is not yet a proven product outcome |
| Design and workflow skills | Design direction, knowledge canvas, flow states, edit versions, and agent bridge workflows exist | Operational guidance | Useful for consistent agent behavior; not a substitute for product capabilities |
| Figma/Mermaid ingestion experiments | Native Figma parsing, diagram artifacts, and responsive HTML reconstruction experiments exist | Candidate or exploratory | Useful input lanes; they do not establish a universal design compiler |
| Automated evidence | The Build 1 focused run passed 38 tests, 160 expectations, and zero failures; its two-test real-browser acceptance suite also passed | Current technical evidence | Build 1 now has a dependable local domain and browser gate; broader editor/runtime coverage remains separate |

### Technical contracts ready to promote

These behaviors are sufficiently implemented and reused to become shared **technical** contracts now. They do not prove the whole user outcome.

| Contract | Current evidence | Required preservation |
|---|---|---|
| Stable artifact identity and regeneration | An external artifact ID updates the same HTML board rather than creating duplicates | Preserve identity across import, render, review, evidence, and later regeneration |
| Canonical object plus projections | A typed knowledge object can project into multiple views without duplicating identity | Keep content identity shared and view geometry/view state distinct |
| Optimistic revisions, dry runs, and idempotency | Workspace/object revision checks and replayable receipts are implemented and tested | Require expected revision and safe retry behavior at every agent mutation boundary |
| One shared live runtime | A successful handshake is required before claiming Live; the prior owner is truthfully demoted | Never imply multiple live owners when only one runtime is active |
| Explicit truth and lifecycle scopes | Board edit, preview, source proposal, review, approval, readiness, verification, and source apply are separate concepts | Keep these transitions visible and permissioned |
| Evidence-led intent handoff | Trace can produce editable Markdown context from stable semantic events without silently transmitting raw evidence | Preserve source trace separately from the editable context projection |
| Safe controlled-component editing | Stable instance IDs, typed props, controlled slots, and allowlisted insertion update canonical HTML/CSS through revisions | Do not turn the component catalog into arbitrary untyped code injection |
| Focused semantic command layer | Stock scene-graph tools and OpenPencil semantic tools coexist with explicit document/page targeting | Keep one underlying service and make target/scope mandatory |

The mature user experiences built on these contracts remain candidate-level until task evidence passes the proving-build gates.

### What is genuinely strong

- A real editor and spatial scene graph already exist; this does not start from a slideshow mockup.
- HTML/CSS/JS is treated as an executable design artifact instead of being flattened into dead canvas geometry.
- Stable IDs, revisions, idempotency, dry runs, branches, reviews, and receipts point toward a trustworthy agent medium.
- Production, preview, capture, variant, and source concepts are meaningfully separated.
- The system has already explored live application states, flows, knowledge objects, narration, design ingestion, and source handoff.
- The project has enough vertical material to run a genuine intent-to-decision experiment now.

### Where the current implementation is not yet built for the full vision

1. **Build 1 now bridges HTML-board and typed workspace identity for one bounded decision surface.** The artifact points to one canonical `SurfaceRun`, evidence manifest, intent, and receipt; this remains a candidate pattern until it survives another form and legacy-scene migration.
2. **The knowledge experience is implementation-led.** It demonstrates projections and objects, but not yet the fluid authoring, inspection, and decision workflow implied by the vision.
   The declared view switcher exists in code but is not mounted in the active UI; current navigation reaches projections indirectly.
3. **There is no proven presentation-selection layer.** No adaptive planner has yet shown it can choose a document, board, dashboard, presentation, or program better than an explicit user choice.
4. **There is no proven universal presentation specification.** Creating one now would freeze assumptions before the builds reveal which fields matter.
5. **Build 1 now enforces view/edit boundaries in workspace query and mutation paths.** Comment capability, every older semantic command, and connector-specific authorization still require broader enforcement evidence.
6. **Agent schemas remain too loose in important paths.** Broad unknown records make dry-run review, migration, compatibility, and policy enforcement harder.
7. **Source-patch and verification tools overstate their names.** Current behavior can identify source targets and check workspace structure, but does not yet guarantee a real code diff, focused test result, or live-application verification.
8. **The Weekly Decision runtime is capability-bounded, but generic generated HTML remains broader.** Build 1 denies network, navigation, forms, popups, objects, host storage, source writes, and external writes; other board types still need a system-wide policy and adversarial coverage.
9. **Persistence and collaboration are indirect for typed knowledge.** Whole-registry serialization into scene-node metadata is a useful vertical slice, not the final scalable knowledge store. Scene-graph Yjs collaboration may carry it indirectly, but this is not object-level permissioned knowledge collaboration.
10. **No organizational connectors are integrated.** Slack, Linear, Notion, Sentry, and PostHog remain product hypotheses, not current capabilities.
11. **The canonical build path is now recorded but still awkward.** The active engine is the nested Smylr-Elite archive checkout, it is not a Git worktree, and reliable commands use the bundled Bun/Node runtimes. A source/test digest and staging parity check are the current audit substitute.
12. **Build 1 has a dependable focused browser gate, not yet a universal editor gate.** The decision loop, persistence/reload, restrictive runtime, and closed-panel viewport fit pass in Playwright; other HTML/live-component suites still retain their own setup dependencies.
13. **Knowledge query is local and lexical.** It supports useful typed filters, pagination, relations, backlinks, metadata, and revisions over an in-memory workspace; it is not semantic retrieval, connector ingestion, or freshness-ranked organizational search.
14. **HTML is still a special insertion path.** It is dispatched outside the typed workspace insert kinds, which makes the HTML/knowledge split visible in the product plumbing.
15. **Several discovery files are concentrated.** The HTML workspace is roughly 2,330 lines, semantic handlers roughly 591, and projection logic roughly 597. This was efficient during discovery but increases collision, review, and ownership risk as more agents contribute.

### Keep, rework, add, and delay

| Decision | Items |
|---|---|
| **Keep** | Scene graph/editor shell; HTML as first-class executable artifact; stable identity and revision history; one semantic service; dry runs/idempotency/undo; shared live runtime; flow/version/review concepts; explicit source-proposal boundary; short intent plus selected context |
| **Rework during the next build** | Canonical source/build stamp; HTML-to-workspace identity bridge; enforced permission checks; strict semantic envelopes; artifact/evidence lineage; real verification receipts; runtime capability declaration; dependable end-to-end test harness |
| **Add for the next build** | Intent record; evidence manifest; surface run; form rationale; interaction/correction capture; decision receipt; automatic evaluation record |
| **Delay until earned** | Universal `PresentationSpec`; every connector; autonomous source or external write-back; general-purpose “any board becomes any program”; full Notion/Slack/Figma clones; generalized renderer marketplace |

---

## 5. Directional architecture, not a frozen final design

The likely system shape has six responsibilities. These are useful boundaries for experiments, not permission to build six horizontal platforms in advance.

### 5.1 Intent and context

Captures the user's desired outcome, current selection, screen/application state, audience, time/risk constraints, and allowed actions.

Durable primitive from earlier work:

> **Select + short intent + preview + receipt**

Text is sufficient for the first proving build. Narration becomes another input mode after the core loop is observable.

### 5.2 Evidence and knowledge

Resolves source-backed objects, relations, revisions, freshness, permission scope, contradictions, and missing information into a bounded evidence snapshot.

The first build uses local, labeled records. A later build earns the first real connector.

### 5.3 Composition and form choice

Determines what the person needs to do and chooses an established form or bounded interactive surface. It records **why this form** and always permits an override.

This is an open hypothesis. Start with a minimal per-run `SurfaceManifest`; do not create a universal planner schema until repeated builds reveal stable fields.

### 5.4 Renderer and runtime

Renders a document, spatial comparison, review surface, dashboard, presentation, live application view, or bounded HTML program. The renderer never becomes the source of truth for evidence it merely displays.

### 5.5 Interaction and action control

Allows inspect, contribute, compare, resolve, decide, propose, approve, verify, apply, and undo as explicit transitions. Exploration, review, approval, implementation, verification, and source application remain separate.

### 5.6 Learning and receipts

Records what the user changed, rejected, approved, or completed; connects the outcome to the exact intent, evidence snapshot, artifact revision, and action state; and updates the hypothesis/contract ledger.

### Minimal experimental object chain

The next build should use one canonical identity chain:

`IntentRecord → EvidenceManifest → SurfaceRun → Interaction/Corrections → DecisionReceipt`

Invariant fields should include ID, revision, provenance, truth scope, freshness, permission scope, and lineage. Layout-planning fields remain provisional until reuse earns them.

For the next build, typed workspace objects own the intent, evidence, and decision identities. The HTML board is a renderer artifact that references those canonical IDs and exact revisions. It must not create a second evidence or decision system.

---

## 6. Open hypothesis register

| ID | Hypothesis | Consequence if false | Proving build |
|---|---|---|---|
| H1 | A bounded evidence set plus clear intent is enough for an agent to make a more useful decision surface than a conventional written answer | Focus on stronger evidence dialogue or explicit templates before dynamic composition | Build 1 |
| H2 | Documents, boards, and review views can operate as projections over one identity without confusing users | Use one writable primary view and read-only secondary views | Build 2 |
| H3 | Observable intent traits can predict a useful presentation form | Let the user choose a template; postpone adaptive selection | Build 3 |
| H4 | Live organizational signals improve outcomes enough to justify connector complexity | Keep snapshot import and avoid a broad synchronization layer | Build 4 |
| H5 | A generated surface can safely carry a decision into a verified real action | Keep OpenPencil as an inspect/decide/handoff medium | Build 5 |
| H6 | Some jobs materially benefit from a purpose-built generated interactive program | Use established renderers and templates instead | Build 6 |
| H7 | Narrated, screen-aware intent reduces clarification and target misunderstanding | Retain text plus explicit selection as the primary input | Evaluated across Builds 1 and 5 |
| H8 | Successful surfaces can compound into reusable renderer or workflow primitives | Treat generation as bespoke and constrain scope accordingly | Across all builds |

---

## 7. Active proving build: Weekly Decision Surface

This is the immediate next build because it tests the central vision while reusing the most current engine capability and avoiding connector or source-write breadth.

### User job

> “Given the work, bugs, product signals, designs, and evidence in front of us, what should we fix or ship this week?”

The first real dogfood scenario should be OpenPencil deciding its own next priorities from the current implementation evidence and this planning corpus.

### Risky hypothesis

A bounded evidence set and clear decision intent are sufficient for the agent to create a more useful decision experience than a normal prose response.

### Thin end-to-end slice

1. Create 8–12 explicitly labeled evidence records from current OpenPencil implementation findings, plans, tests, failures, and user decisions.
2. Accept a short text intent; allow Trace input only if it is already dependable enough not to dominate scope.
3. Query and assemble the relevant evidence into an immutable manifest with IDs, revisions, truth scopes, freshness, and missing/conflicting evidence.
4. Generate one interactive HTML decision surface inside OpenPencil.
5. Present three recommended priorities with rationale, uncertainty, tradeoffs, and inspectable evidence.
6. Let the user reorder, reject, revise, compare, or approve priorities inside or immediately beside the working artifact.
7. Persist a decision receipt linked to the original intent, evidence manifest, surface revision, corrections, and final choice.
8. Reopen the receipt and reconstruct the exact decision context.

Fixtures or captured evidence are acceptable for this build only when visibly labeled. No fixture may appear live or current.

### Existing capabilities reused

- Typed workspace objects, relations, queries, and mutation service
- HTML/CSS/JS board runtime
- Artifact revisions and branch history
- Review objects and workflow state
- Semantic context/mutation tools
- Stable IDs and receipts
- Text/Trace intent direction

### New work allowed

- `IntentRecord`
- `EvidenceManifest`
- `SurfaceRun` and a minimal form-rationale record
- Artifact-to-evidence lineage
- In-surface correction and decision controls
- `DecisionReceipt`
- Automatic run/evaluation record
- The minimum HTML-board/workspace identity bridge
- The minimum canonical-path, permission, runtime-safety, and test-harness fixes needed to trust this slice

### Explicitly out of scope

- Live Slack, Notion, Sentry, PostHog, or broad connector framework
- External-system write-back
- Automatic source patch application
- Universal presentation compiler
- Generalized “any program” generation
- Full knowledge-editor redesign
- Unrelated canvas polish

### Observable pass gates

Run at least five dogfood sessions. A run passes only if:

1. The user receives a useful surface from one intent in under 60 seconds once the evidence set is available.
2. Every recommendation has inspectable supporting evidence.
3. Fixture, captured, stale, last-known, and live evidence are never confused.
4. The user reaches a decision in under five minutes.
5. There is no more than one major “you misunderstood the job” reconstruction.
6. The user can correct recommendations through the working surface instead of abandoning it for a separate document.
7. The receipt contains intent revision, evidence snapshot, artifact revision, corrections, final choice, actor, and timestamp.
8. Reopening the receipt reconstructs the exact evidence and artifact versions.
9. There are zero silent production-source or external-system changes.
10. The six-part run rubric scores at least 10/12 with no zero in Evidence Quality or Safety and Trust.

Three of five passing runs make the result **provisional**, not universally proven.

### Required build evidence

- Intent snapshot
- Evidence manifest
- Presentation choice and concise rationale
- Artifact ID and revision
- Interaction/correction trace
- Decision receipt
- Timing and clarification count
- Before/after user confidence
- Screenshot or recording of the real surface
- Automated checks and manual rubric
- Learning receipt and consolidation decision

### Pivot rules

- If users only read the board and decide elsewhere, reduce it to a concise brief with anchored decision controls.
- If evidence inspection provides no benefit, simplify it instead of adding more evidence chrome.
- If every run requires bespoke HTML, extract a bounded decision-surface renderer after the repeated need appears.
- If recommendations cannot be traced, stop visual iteration and repair evidence lineage.
- If the same form wins every run, optimize that form rather than pretending adaptive presentation is already valuable.

### Promotion decision after Build 1

Eligible for provisional status after 3 of 5 passing runs:

- Evidence manifest
- Surface run
- Decision receipt
- Artifact-to-evidence lineage

Do **not** formalize a universal `PresentationSpec` after this build.

### Build 1 delivery sequence

#### Phase A — Establish a trustworthy experiment baseline

1. Choose and record the canonical writable implementation path.
2. Establish a Git baseline or an equally explicit immutable backup before overlapping edits.
3. Record the exact startup command, route, host, build stamp, and focused test command.
4. Make the running application display enough identity to prove which source/build it serves.
5. Re-run the 33-test focused technical suite and add one dependable real-canvas smoke path.

This is not a repository-cleanup project. Stop after the experiment can be reproduced and its evidence trusted.

#### Phase B — Build the shared identity and evidence spine

1. Add the minimal typed objects for intent, evidence manifest, surface run, and decision receipt.
2. Reuse existing IDs, expected revisions, dry runs, idempotency receipts, and relations.
3. Make the HTML board reference the canonical surface/evidence IDs rather than own a parallel decision record.
4. Store truth scope, provenance, source revision, freshness, and permission scope for every evidence item.
5. Reject malformed or unauthorized mutation envelopes at the semantic-service boundary.

#### Phase C — Compose the decision experience

1. Create a deterministic OpenPencil evidence fixture pack from 8–12 current facts.
2. Query the pack from one short decision intent.
3. Produce three priority recommendations with evidence, uncertainty, and tradeoffs.
4. Render them in one bounded HTML decision surface using existing OpenPencil/Smylr design primitives.
5. Record why this form was selected without treating the rationale as a universal planner.

#### Phase D — Close the human/knowledge loop

1. Add reorder, reject, revise, compare, and approve controls.
2. Capture corrections as structured interaction events tied to the exact artifact revision.
3. Create the final decision receipt from the actual user action, not the agent's initial recommendation.
4. Reopen the receipt and reconstruct the exact evidence and surface revisions.
5. Confirm that no control can silently write production source or an external system.

#### Phase E — Evaluate, consolidate, and revise the spec

1. Run five real dogfood sessions, including stale, conflicting, and missing-evidence cases.
2. Capture the automatic run record and score the six-part rubric.
3. Compare the result with a normal prose answer for time, corrections, confidence, and decision completion.
4. Hold a build gate: provisional, pivoted, or rejected.
5. Promote only the repeated primitives, retire duplicate paths, and update this document.

### First execution backlog

| Order | Deliverable | Done when |
|---|---|---|
| 1 | Canonical run manifest | Source path, build stamp, route, startup, test, and smoke commands reproduce the same app |
| 2 | Build 1 experiment card | User job, hypothesis, baseline, gates, allowed actions, and fixtures are approved |
| 3 | Evidence fixture pack | 8–12 records carry IDs, revisions, sources, freshness, and truth labels |
| 4 | Minimal shared objects | Intent, evidence, surface, and decision types pass domain/revision/idempotency tests |
| 5 | HTML/workspace identity bridge | One HTML artifact is addressable from the same surface run and evidence lineage |
| 6 | Decision composer | One intent deterministically produces three traceable priority recommendations |
| 7 | Interactive decision controls | Reorder/reject/revise/approve events persist against exact revisions |
| 8 | Reconstructable receipt | Reopening recreates the exact intent/evidence/artifact/decision state |
| 9 | Trust and safety suite | Stale/fixture labels, permission denial, revision conflict, retry, and no-write behavior pass |
| 10 | Five-run gate review | Results, failures, contract promotions, retirements, and next uncertainty are recorded |

### Build 1 implementation checkpoint — 2026-07-13

The first bounded implementation is complete and its evidence is recorded in [`../reports/weekly-decision-surface-build-1.md`](../reports/weekly-decision-surface-build-1.md).

- Implemented the canonical `IntentRecord → EvidenceManifest → SurfaceRun → DecisionReceipt` chain and exact artifact/revision reconstruction.
- Added eight labeled evidence records, three evidence-backed priorities, typed reorder/reject/restore/revise/approve events, restrictive HTML capabilities, enforced workspace permissions, and a durable receipt.
- Fixed the semantic UI/MCP document-scope split by resolving both through the canonical graph root and base page.
- Verified 38 focused tests with 160 expectations, two browser acceptance tests, and a production build.
- Exercised the real served app manually from board revision 1 through approval at revision 6, then reloaded and recovered the exact approved state.
- Completed one screenshot-driven revision and scored the resulting surface 88/100 on the visual rubric.

Gate result: **PROVEN LOCALLY / candidate pattern**. Five deterministic automated scenarios pass, but only one real human dogfood session has been completed. Four real sessions remain for the full five-run review; at least two additional passing sessions are required before the 3-of-5 provisional threshold can be met. No universal `PresentationSpec` is promoted.

---

## 8. Proving-build roadmap

### Build 2 — One Truth, Three Views

**User job:** Explore a decision spatially, read it sequentially, and review its history without maintaining separate copies.

**Build:** Project the same Build 1 objects into a sequential brief, interactive decision board, and review/decision ledger. Edit one shared property and prove correct propagation. Keep canvas geometry view-specific.

**Hypothesis:** Document, Canvas, Graph, and Review can be projections over durable shared identity.

**Pass gates:**

- 100% identity preservation across views
- No duplicated or divergent decision records
- Shared-content edits propagate correctly
- Geometry remains geometry unless a property mutation is explicitly previewed
- Comments remain attached to exact object/artifact revisions
- Historical Build 1 receipts still reconstruct
- The user can explain what is shared and what is view-specific

**Earned consolidation:** A small view-binding contract. Do not generalize all layout metadata.

### Build 3 — Form Choice Challenge

**User job:** Receive the form that best helps with the current job rather than the same board or dashboard every time.

**Build:** Test three bounded jobs—explain, compare/decide, and triage/prioritize—against three established renderers: brief, spatial comparison, and dashboard/triage. The agent records why it chose the form; the user can override.

**Hypothesis:** A small set of observable intent traits can predict useful presentation form.

**Pass gates:**

- Chosen form scores at least 4/5 in 70% of runs
- Override rate below 30%
- Completion time or major corrections improve versus plain prose
- Every run records “why this form”
- Provenance survives all renderers
- The system prefers existing renderers when they fit

**Earned consolidation:** Only after success, extract `PresentationSpec v0` from fields actually used across Builds 1–3.

### Build 4 — Live Evidence

**User job:** Make the same weekly decision using current, refreshable organizational evidence.

**Build:** Add one read-only source—preferably Linear for this workflow. Add Sentry or PostHog only after the first adapter proves stable identity, freshness, permissions, failure handling, and value.

**Hypothesis:** Live signals improve the decision enough to justify synchronization complexity.

**Pass gates:**

- Stable external-to-workspace identity mapping
- Refresh without duplication
- Source time, retrieval time, and staleness visible
- Last-known snapshot preserved and labeled during outage
- Permission failures leak no content
- At least one decision improvement is attributable to live evidence

**Earned consolidation:** The demonstrated `SourceAdapter` and `EvidenceSnapshot` behavior—not a universal connector platform.

### Build 5 — Decision to Verified Action

**User job:** Turn an approved decision into a safe, reviewable real change and prove what happened.

**Build:** Create a change set, resolve live-container/source ownership, produce a real proposed diff, preview/compare in the real application, run targeted checks, attach verification, and require explicit approval before apply or merge.

**Hypothesis:** A dynamic surface can become a trustworthy operating interface without confusing board, preview, proposal, source, and external action.

**Pass gates:**

- Zero unapproved writes
- Every action declares target, scope, base revision, risk, and rollback
- Preview and production visibly distinct
- Checks run against the real route/application
- Verification attaches to the exact change-set revision
- Explicit approve, reject, revise, and undo transitions
- Final outcome links back to the originating intent and evidence

**Earned consolidation:** An action envelope covering proposal, approval, verification, apply receipt, and rollback reference.

### Build 6 — Open-Ended Interactive Model

**User job:** Explore a problem that does not fit a document, board, or dashboard through a small adjustable tool.

**Build:** Use a bounded scenario such as priority weighting, capacity planning, or tradeoff simulation. Generate an HTML tool from a fixed evidence snapshot; save the resulting scenario/decision receipt.

**Hypothesis:** Purpose-built interactive programs sometimes produce better reasoning than established renderers.

**Pass gates:**

- Serves a job established renderers could not serve well
- Inputs, outputs, evidence dependencies, and capabilities are explicit
- Same evidence snapshot reproduces the artifact
- Responsive and keyboard usable
- No undeclared network or host access
- Better or faster outcome than a static presentation
- At most one repair before useful operation

**Earned consolidation:** A bounded `InteractiveSurfaceSpec` only after two different successful interactive models.

---

## 9. Evaluation system

### North-star metric: Intent-to-Outcome Rate

Percentage of runs where the person completes the intended decision or action with:

- Traceable evidence
- A useful surface
- No critical misunderstanding
- A durable outcome receipt
- No safety violation

Rendering an artifact alone does not count.

### Supporting measures

- Time to first useful surface
- Time to decision or action
- Major reconstruction count
- Form override rate
- Evidence coverage and unsupported-claim count
- Freshness/staleness disclosure rate
- User confidence before and after
- Interaction completion rate
- Receipt completeness
- Cross-view divergence
- Existing-renderer reuse rate
- Time and cost of the second similar build
- Verified-action pass rate
- Unauthorized mutation count, target zero
- Later reopening or reuse of the outcome

Early measurements are directional. Their first job is to expose failure modes and establish a baseline, not manufacture statistical certainty.

### Six-part run rubric

Score each dimension from 0–2:

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Intent fidelity | Wrong job | Partly right | Correct job and outcome |
| Evidence quality | Unsupported | Incomplete | Sufficient and traceable |
| Form fitness | Obstructive | Usable | Materially helpful |
| Interaction utility | Decorative | Some control | Enables the outcome |
| Knowledge continuity | Lost | Partial record | Complete reusable receipt |
| Safety and trust | Unsafe or misleading | Caveated | Clear scopes and controls |

Passing score: **10/12 or better**, with no zero in Evidence Quality or Safety and Trust.

### Automatic run record

Every run should capture:

- Intent and visible context
- Evidence IDs, sources, revisions, truth scopes, and freshness
- Form selected, alternatives considered, and rationale
- Artifact ID and revision
- Important interactions, overrides, and corrections
- Decision or action receipt
- Test and verification evidence
- Final rubric and gate result

### Evaluation suites

- Deterministic fixture scenarios
- Missing, stale, conflicting, irrelevant, and permission-blocked evidence
- Cross-view identity and historical replay
- Renderer-selection comparisons
- Generated HTML capability and safety tests
- Real dogfood tasks
- Regression replays from successful and failed runs

---

## 10. 30/60/90-day execution sequence

The dates are sequencing assumptions, not promises detached from evidence. A failed gate changes the next build.

### Days 0–30: prove the complete loop once

- Establish one canonical checkout, build stamp, route, runtime command, and focused test command—only enough hygiene to trust the experiment.
- Create the first evidence fixture pack and automatic run record.
- Implement Weekly Decision Surface.
- Run at least five real dogfood sessions.
- Repair critical evidence, interaction, identity, safety, and receipt failures.
- Hold the first evidence gate and promote only provisional behavior.

**Day-30 proof:** A real intent becomes an evidence-backed interactive decision, and the exact decision context is recoverable as knowledge.

### Days 31–60: test reuse and form variation

- Build One Truth, Three Views.
- Resolve only identity and lifecycle problems exposed by that build.
- Run Form Choice Challenge against prose and explicit template selection.
- Create `PresentationSpec v0` only if stable fields survive both builds.
- Hold the second evidence gate and retire failed abstractions.

**Day-60 proof:** Shared knowledge supports multiple useful forms, and there is evidence about whether form selection actually helps.

### Days 61–90: add reality and consequence

- Add one read-only live source.
- Test freshness, outages, deduplication, provenance, and permissions.
- Build Decision to Verified Action.
- Complete at least one safe real-application change loop.
- Attempt the open-ended interactive model only if earlier gates remain healthy.
- Publish the first proven-contract specification and updated hypothesis ledger.

**Day-90 proof:** Current evidence can drive a trusted decision and an explicitly approved, verified action whose outcome returns to durable knowledge.

---

## 11. Workstreams and ownership

These workstreams run through the proving builds. They are not independent platform projects.

| Workstream | Responsibility | Immediate output |
|---|---|---|
| Product and experiment | Define user job, hypothesis, gate, baseline, and dogfood sessions | Build 1 test card and five-run schedule |
| Semantic core | Own canonical identity, revisions, evidence lineage, permission checks, and receipts | Intent/evidence/surface/decision chain |
| Experience composition | Choose and assemble the smallest useful form | One bounded decision renderer plus rationale |
| Runtime and renderers | Render safely and expose declared capabilities | HTML runtime capability manifest and tests |
| Action and verification | Keep propose/approve/verify/apply separate | Honest verification receipt; no apply in Build 1 |
| Quality and observability | Capture timings, corrections, failures, and replayable runs | Automatic run record and 12-point rubric |
| Spec stewardship | Promote, revise, reject, and consolidate after evidence review | Updated ledgers and revision history |

For a small team, people or agents may cover multiple workstreams. Ownership means accountability for the evidence, not a reason to create separate subsystems.

---

## 12. Risk register

| Risk | Leading signal | Response |
|---|---|---|
| Demo overfitting | Every run requires custom code | Require repeated runs and later reuse before promotion |
| Premature platform design | Large schemas appear before user proof | Formalize only after repeated successful use |
| Parallel state silos | HTML, knowledge, review, and live state disagree | Make canonical identity a hard Build 1–2 gate |
| Attractive but unhelpful UI | The user leaves the surface to decide | Measure completion and correction inside the artifact |
| False synthesis | Recommendations cannot expose evidence | Block completion on evidence coverage |
| Stale knowledge | Old evidence appears current | Store and display source and retrieval time |
| Unsafe generated HTML | Undeclared network or host access | Capability manifest, sandbox policy, adversarial tests |
| Tool overclaiming | “Verified” only means fields are present | Require actual target/runtime/test evidence |
| Connector explosion | Integration work consumes the roadmap | Add one read-only source at a time |
| Silent action | Agent changes source/external state | Explicit capability, preview, approval, and receipts |
| Spec churn without history | Prior decisions vanish | Append-only learning and decision ledger |
| Wrong source tree | Artifact and live product diverge | Canonical checkout, route, build stamp, and startup proof |
| Test harness blindness | Unit tests pass while real canvas cannot initialize | Pair focused tests with real visual/runtime acceptance |
| Sensitive data exposure | Early tests ingest clinical records | Keep pilots PHI-free until governance passes |
| Local maximum | Current HTML/canvas strengths define every future answer | Run Form Choice Challenge and allow simpler forms to win |
| Endless consolidation | Platform work delays user outcomes | Permit only consolidation required by the active slice |

---

## 13. Decision rules for choosing the next build

Score candidate builds from 1–5 on:

- User value if successful
- Learning value about the north-star loop
- Consequence of the uncertainty being wrong
- Ability to run end to end with real evidence
- Reuse of existing capability
- Safety and reversibility
- Time to observable result

Prefer the build with the highest combined user and learning value, not the largest feature count.

A build should not start until it names:

- One user job
- One primary risky hypothesis
- Observable pass/fail gates
- Truth scope of every input
- Allowed and forbidden actions
- Existing contracts reused
- New one-off work allowed
- Evidence the build will emit
- Pivot/abort rules
- Consolidation decision if it succeeds

---

## 14. Build-close learning receipt

Append one record for every proving build:

```md
## Build receipt: <name>

- Build ID and artifact revision:
- User job:
- Risky hypothesis:
- Baseline:
- Evidence sources and truth scopes:
- Allowed actions:
- Runs completed:
- Gate result: PROVEN LOCALLY | PROVISIONAL | PROMOTED | PIVOTED | REJECTED
- Human outcome:
- Trust/safety outcome:
- What worked:
- What failed:
- User corrections and overrides:
- Candidate patterns created:
- Contracts promoted:
- Duplicate paths retired:
- Hypotheses revised or rejected:
- Spec changes caused by this build:
- Highest-value next uncertainty:
```

No proving build is complete until this receipt exists.

---

## 15. Decisions made now

1. OpenPencil is an intent-to-experience system, not a clone of any single work application.
2. The north-star loop is intent → evidence → interactive model → action/decision → durable learning.
3. The program uses build-first, evidence-driven specification.
4. HTML/CSS/JS remains a first-class executable artifact; the spatial canvas provides arrangement, context, flow, comparison, critique, and handoff.
5. The typed workspace domain is the candidate owner for durable intent, evidence, and decision identity.
6. UI and agents use one semantic service.
7. Production remains the source of truth; all material application or external changes require explicit permission and verification.
8. The active proving build is Weekly Decision Surface; its implementation is locally proven, and the next gate is completing the remaining real dogfood sessions before Build 2 promotion work.
9. A universal presentation compiler, connector platform, and arbitrary-program contract are delayed until proving builds earn them.
10. This document is revised by evidence, not protected from it.

## 16. Decisions deliberately left open

- The final persistence and collaboration backend
- The final renderer/plugin model
- Whether agent-selected form materially beats user-selected templates
- The exact fields of `PresentationSpec v0`
- Which live connector follows Linear, if Linear proves useful
- Whether narration is primary, optional, or situational
- Which generated interactive programs deserve promotion into reusable products
- How far source application should be automated after safe proposal/verification is proven
- Whether the current nested implementation becomes the canonical repository or is migrated

---

## 17. Rejected and retired directions

These decisions remain visible so future work does not accidentally recreate them.

| Direction | Status | Reason |
|---|---|---|
| A second OpenPencil agent protocol for knowledge work | Rejected | One semantic service and contract layer avoids divergent behavior |
| Static image or diagram as live application truth | Rejected | Exports can explain, but cannot claim runtime, route, source, or interaction identity |
| Flattening canonical HTML into canvas layers | Retired as the primary path | HTML/CSS/JS remains the executable artifact; the canvas organizes it |
| “Preferred” automatically means apply | Rejected | Preference, approval, verification, and source application are distinct |
| Trace silently sends source evidence to an agent | Rejected | Editable preview and explicit Copy Context preserve user control |
| Build all connectors before a complete workflow | Rejected | A proving build must earn each connector |
| Freeze a universal `PresentationSpec` now | Rejected for the current phase | Stable fields must emerge across Builds 1–3 |
| Treat a polished one-way board as task completion | Rejected for decision workflows | The user must be able to inspect, contribute, compare, resolve, or decide |
| Claim “any board can become any program” from one demo | Rejected as a conclusion | Requires at least two useful open-ended interactive models and safety evidence |

## 18. Spec stewardship protocol

At every proving-build close, update:

1. Current capability ledger
2. Proven technical/product contract ledger
3. Open hypothesis register
4. Validation and failure evidence
5. Consolidation queue
6. Rejected/retired directions
7. Risk register
8. Revision history

Do not silently rewrite prior evidence. When a claim changes status, record the build receipt that caused the change. A future agent should be able to tell the difference between the north star, a trust invariant, existing code, a locally successful behavior, and a proven reusable contract.

---

## 19. Existing evidence and plan sources

This master plan consolidates rather than replaces the detailed design records below:

- [`../plans/html-first-openpencil.md`](../plans/html-first-openpencil.md) — HTML-first artifact and runtime direction
- [`../plans/live-app-edit-workspaces.md`](../plans/live-app-edit-workspaces.md) — production/draft/variant/review/change-set lifecycle
- [`../plans/narrated-intent-trace.md`](../plans/narrated-intent-trace.md) — narrated intent, semantic targets, evidence, and Copy Context
- [`../plans/openpencil-skill-system.md`](../plans/openpencil-skill-system.md) — typed workspace and single-semantic-service direction
- [`../reports/figma-to-html-workstream-2026-07-13.md`](../reports/figma-to-html-workstream-2026-07-13.md) — fidelity and responsive reconstruction evidence
- [`../reports/openpencil-knowledge-workspace-delivery.md`](../reports/openpencil-knowledge-workspace-delivery.md) — implemented vertical-slice record; capability evidence, not final product validation
- [`../../openpencil-design-mcp-recommendations.md`](../../openpencil-design-mcp-recommendations.md) — live identity, viewport, capture, and agent-tool findings
- [`../../openpencil-design-research-2026-07-13.md`](../../openpencil-design-research-2026-07-13.md) — research behind inspect/contribute/compare/resolve surfaces

---

## 20. Revision history

### v0.2 — 2026-07-13

- Recorded the completed Weekly Decision Surface implementation and its local proof.
- Updated the capability and gap ledger for the canonical identity bridge, workspace permission enforcement, bounded decision runtime, canonical run path, and focused browser gate.
- Classified the result as a candidate pattern rather than provisional because the real five-session dogfood gate is still open.
- Linked the detailed Build 1 receipt and kept `PresentationSpec` deliberately unformalized.

### v0.1 — 2026-07-13

- Established the intent-to-experience north star.
- Adopted build-first, emergent specification as the operating method.
- Classified current implementation as technical foundations and candidate patterns rather than declaring the vision complete.
- Identified the HTML-board/workspace split, permission enforcement, runtime safety, verification truth, canonical path, and test harness as immediate rework.
- Selected Weekly Decision Surface as the first complete proving build.
- Defined six proving builds, measurable gates, promotion rules, a 30/60/90 sequence, and a learning-receipt format.
