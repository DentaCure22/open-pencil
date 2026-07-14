---
name: openpencil-edit-versions
description: Create, organize, compare, review, and promote safe edit versions of real live-application screens or containers in OpenPencil. Use when a user asks to branch production into a draft, preserve alternate designs, compare variants, mark a preferred direction, archive an option, or package approved visual work into a change set without silently changing production.
---

# OpenPencil Edit Versions

Treat the real production screen as the source of truth and keep every experiment isolated until the user explicitly approves a change set.

Use `$openpencil-design-director` before creating a visible comparison. It owns reference conditioning, Focus/Compare composition, screen prominence, screenshot scoring, and rejection of weak visual output.

## Non-negotiable rules

- Work on the actual OpenPencil canvas and native inspector around the real app.
- Preserve production, stable node identity, the app's undo/history, and existing user work.
- Never imply that saving a draft changes source code.
- Never apply or merge a change set without explicit authorization and a visible diff.
- Prefer semantic OpenPencil operations over browser clicks or blind file rewrites.
- Keep token, owner, route, source, and container context; do not reduce edits to vague visual instructions.
- Treat every version board as a polished design-review artifact, not a collection of labeled rectangles.

## Choose the operation

- Production experiment -> `Branch to Edit`.
- Unfinished work -> `Save Draft`.
- Independent alternative -> `Save as Variant` or `Branch from Here`.
- Journey state -> use `$openpencil-flow-states` after creating the version.
- Feedback request -> `Send to Review`.
- Accepted direction -> mark `Preferred`, then create a change set.
- Rejected but useful direction -> `Archive`; do not delete it.

## Workflow

1. Resolve the real source.
   - Record document, page, route, node ID, owner/source evidence, viewport, tokens, and base revision.
   - For an HTML board, capture its exact `{ boardId, revision, schemaVersion }` reference and resolve that snapshot before branching. Never bind a version to an ambiguous "latest" board state.
   - Confirm whether the selection is Production, Draft, Variant, Review, or Change Set.

2. Create a small guide on the board before branching.
   - Show `PRODUCTION -> DRAFTS/VARIANTS -> PREFERRED -> CHANGE SET`.
   - Pin production at the top or left and place alternatives beneath or beside it.
   - Add a short legend stating that production stays unchanged.
   - Use native OpenPencil styling and the product's real tokens.

3. Establish the visual system before duplicating screens.
   - Inspect the real product screen, nearby native OpenPencil chrome, and existing board tokens.
   - Set one consistent width, header treatment, corner radius, internal padding, and preview scale for related versions.
   - Give Production the strongest stable anchor; use restrained accents for Draft, Alternate, Review, Preferred, and Approved.
   - Keep the guide compact enough that the actual design work remains the focal point.

4. Capture the baseline.
   - Store original values and a stable source version.
   - Preserve the production frame as a linked reference, not a disconnected copy.

5. Create and edit the version.
   - Give it a meaningful name and optional intent note.
   - Apply edits through OpenPencil preview/patch operations.
   - Ensure selection changes do not erase edits.
   - Make the visible difference legible inside the screen preview; do not rely only on a `What changed` label.
   - Preserve real content density and component proportions instead of replacing the screen with generic skeleton blocks.

6. Persist the version.
   - Record parent, source, route, patch list, canvas position, status, notes, and preview.
   - Keep the originating HTML-board revision reference on the version record; responsive CSS and viewport changes are part of that revision.
   - Keep screenshot data separate from metadata when storage size matters.

7. Compare and decide.
   - Compare production and related variants visually and semantically.
   - Show token, layout, responsive, and structural differences.
   - Mark one option Preferred only when the user decides; keep the others available.
   - Keep comparison annotations concise, aligned, and visually subordinate to the screens being compared.

8. Review and promote.
   - Attach feedback to the exact object and revision.
   - Package approved pages, assets, tokens, states, and acceptance criteria into a change set.
   - Keep implementation, verification, and application as explicit later transitions.

9. Run the visual refinement pass.
   - Check frame alignment, type hierarchy, padding rhythm, connector routing, color restraint, preview legibility, and status contrast.
   - Remove accidental empty space and balance the production anchor against its branches.
   - Run overlap/color/type/spacing analysis when available, export the board, inspect the image, and revise at least once.

10. Verify.
   - Reopen each saved version.
   - Confirm its patch replays against the intended source and reset restores production.
   - Confirm production remains unchanged until an approved apply/merge step.
   - Confirm the board reads correctly at fit-to-board zoom and that important design differences remain visible at normal review size.

## Tool fallback

Use `$openpencil-agent-bridge` to select the semantic control path. If the required board or live-container commands are unavailable, produce the exact proposed command plan and missing capability list; do not fake success through mouse automation.

## Completion report

Report the source object, created versions, comparison decision, change-set status, validation evidence, and any source drift or missing semantic tool.

For the lifecycle and required metadata, read [references/lifecycle.md](references/lifecycle.md). Before designing version frames, read [../openpencil-agent-bridge/references/visual-quality.md](../openpencil-agent-bridge/references/visual-quality.md).
