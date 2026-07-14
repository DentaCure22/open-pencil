---
name: openpencil-agent-bridge
description: Choose and operate the safest agent-control path for OpenPencil, including stock scene-graph MCP tools, live-app container identity, workspace versions, flow states, previews, review transitions, and explicit source-patch handoff. Use when an agent must inspect or manipulate an OpenPencil board, when deciding whether MCP is needed, when defining missing agent tools, or when preventing browser automation and scene-graph edits from being mistaken for production changes.
---

# OpenPencil Agent Bridge

Treat MCP as a transport, not the product contract. The required capability is a small semantic command layer backed by OpenPencil's real state, stable IDs, undo/history, and live-container bridge.

Any command path that creates visible board content must also meet the OpenPencil visual-quality contract. Functional scene nodes are not a finished design.

## Decide whether MCP is needed

- Explanation, planning, or read-only source review: MCP is optional.
- Deterministic board creation or editing: use MCP or an equivalent callable app command API.
- Exact interactive design rendering: use a sandboxed HTML board controlled through the same semantic command layer; do not round-trip it through DOM-to-auto-layout conversion.
- Live production-container inspection or preview: require the live-app container bridge.
- Source patching: require owner/source evidence, a proposed diff, tests, and explicit user approval.
- If semantic commands are unavailable, report the missing command contract; do not substitute click automation.

Because OpenPencil already registers its tool definitions through `@open-pencil/mcp`, prefer extending that server with semantic workflow tools rather than creating a second agent protocol.

## Existing stock layer

Use stock tools for scene-graph work: selection/node reads, render, layout/style/text changes, resize/reparent/batch update, pages, components, variables, analysis, diff, export, and viewport control.

Do not treat stock scene nodes as proof that a Smylr live DOM element or source component changed.

## Required semantic layer

The minimum useful surface is ten cohesive workflow tools. HTML boards are currently an in-app primitive; an MCP command for them is intentionally deferred until the interaction model stabilizes.

1. `get_openpencil_context` — document, page, route, canvas mode, live selection, owner/source evidence, tokens, workspace graph, preview health, and base revision.
2. `inspect_live_container` — stable live selection, owner/source evidence, tokens, computed styles, bounds, and isolated changes.
3. `edit_live_container` — immediate, undoable token/CSS preview against the selected real container.
4. `upsert_board_guide` — idempotently create/update the native guide scaffold.
5. `mutate_workspace_graph` — typed operations for create version, create flow, upsert state, connect states, and lifecycle transition.
6. `activate_workspace_item` — place the real shared runtime on one state and replay its patches.
7. `compare_workspace_items` — visual, token, layout, responsive, and structural diff.
8. `create_change_set` — package approved objects, acceptance criteria, source targets, and risks.
9. `propose_source_patch` — return a narrowly scoped diff; never silently write source.
10. `verify_change_set` — run targeted checks and attach evidence before Apply/Merge is allowed.
Prefer a few cohesive tools over exposing every internal store mutation.

## Safety contract

- Every mutation accepts stable IDs and an expected base revision.
- Every mutation participates in native undo/history.
- Create/update commands are idempotent through caller-supplied IDs or idempotency keys.
- Preview mutations remain isolated from production source.
- Destructive or lifecycle-changing commands support dry-run summaries.
- Review, approval, source patch, and apply are separate transitions.
- No `apply_source_patch` tool should bypass explicit approval and verification.

## Agent workflow

1. Read context and the workspace graph.
2. Resolve the live selection and source evidence.
3. Create or update the board guide.
4. Perform semantic version/flow operations.
5. Preview and compare.
   - For an HTML board, exercise its interactions in the sandbox and capture the resulting state without implying that production source changed.
6. Transition to review or preferred only with the user's decision.
7. Create a change set and propose a source patch.
8. Verify in the real app before requesting Apply/Merge authorization.

## Visual-quality gate

For any board, guide, flow, comparison, or version frame:

1. Inspect the real product screen and its available color, type, spacing, radius, border, and elevation tokens.
2. Make a structure pass that establishes one clear focal point, consistent frame geometry, and an obvious reading direction.
3. Make a polish pass that improves typography, density, alignment, status styling, connectors, and screen fidelity.
4. Use stock analysis tools such as `analyze_overlaps`, `analyze_colors`, `analyze_typography`, and `analyze_spacing` when available.
5. Export the relevant nodes as images and inspect them at fit-to-board and readable-detail scale.
6. Fix clipping, weak contrast, uneven padding, vague placeholders, and ambiguous hierarchy before reporting completion.

Do not accept blank wireframe cards, giant unused whitespace, rainbow status colors, dashboard-like chrome detached from OpenPencil, or labels that explain a layout the layout itself fails to communicate.

If the real application cannot hydrate, label substitute screens `Illustrative preview`; never present a gradient, skeleton, or reconstructed mock as a real production capture.

## Completion report

State which layer was used: stock MCP, semantic MCP, direct app API, or read-only fallback. List mutations, stable IDs, undo/preview evidence, source-patch status, and missing capabilities.

Read [references/semantic-tools.md](references/semantic-tools.md) when implementing or reviewing the tool API. Read [references/visual-quality.md](references/visual-quality.md) before creating or judging visible board content.
