# Mermaid to HTML Board handoff

Use this contract when Mermaid provides the diagram layout and OpenPencil's HTML Board provides the interactive presentation surface.

## Boundary

- Mermaid owns diagram syntax, validation, automatic layout, and the rendered SVG or raster preview.
- The flowchart skill owns diagram choice, information restraint, visual theme, board composition, and screenshot QA.
- The HTML Board owns browser rendering, sandboxing, responsive viewport controls, Design/Inspect/Interact modes, persistence, and undo.
- Native OpenPencil objects own surrounding comments, review markers, flow-state relationships, edit-version branches, and approvals.

Do not add a second iframe runtime or a parallel HTML document model. Hand a normal HTML document to the existing HTML Board.

## Required artifact fields

Each wrapped diagram must retain:

- `artifactId`: stable across regeneration
- `kind`: `mermaid-diagram`
- `title`
- `diagramType`
- `source`: complete validated `.mmd` text
- `sourceHash`: SHA-256 of the source
- `renderer`: `@mermaid-js/mermaid-cli`, `kroki`, or another explicitly named renderer
- `renderFormat`: prefer `svg`; allow `png`, `jpg`, or `webp` as a fallback
- `editingModel`: `mermaid-source`

Embed this record in the HTML as non-executable JSON. HTML Board schema v6 parses and retains the same record as first-class artifact metadata while preserving the original script block in canonical HTML:

```html
<script type="application/vnd.openpencil.mermaid+json" data-openpencil-artifact>
  {"artifactId":"checkout-flow","kind":"mermaid-diagram","editingModel":"mermaid-source"}
</script>
```

Escape `<` as `\u003c` when serializing the JSON so diagram text cannot close the script tag.

## Build wrapper

After the Mermaid skill validates and renders the source, run:

```bash
node scripts/mermaid-html-board.mjs \
  --source checkout-flow.mmd \
  --render checkout-flow.svg \
  --output checkout-flow.html \
  --title "Checkout flow" \
  --diagram-type flowchart \
  --artifact-id checkout-flow
```

The output is a standalone HTML document that can be placed into the current HTML Board with an empty external CSS field. The wrapper is presentation glue only; edit the `.mmd`, revalidate, rerender, and overwrite the same HTML artifact when the flow changes.

On placement, OpenPencil maps the artifact identity to `{ boardId, revision, schemaVersion }`. Regenerating the same `artifactId` updates the existing board, keeps its `boardId`, advances its revision, and retains the prior revision snapshot.

## Schema v6 decision and handoff lifecycle

Treat the artifact identity and the board decision identity as related but distinct:

- `{ artifactId, sourceHash, source, renderer, editingModel }` identifies the Mermaid artifact and its provenance.
- `{ boardId, revision, schemaVersion }` identifies the exact OpenPencil design decision being reviewed.
- A revision-sidecar comment annotates the exact board revision without creating a false design revision or changing the Mermaid source hash.
- `Preferred` selects a reviewed revision. Creating a change set from it is proposal-only and must continue to report the source as unchanged and not applied.
- Before a change set can be created, at least one declared repository-relative source target must be attached to that exact Preferred revision. This sidecar mapping does not alter the Mermaid artifact, its source hash, or the board design revision.
- Workspace readiness may export an implementation-request packet containing the full artifact identity, canonical HTML/CSS/JS, exact source targets, and acceptance criteria. The packet is not an executor: it requires repository resolution, a visible diff, explicit authorization, focused tests, and real-app verification.
- Approval and workspace readiness do not prove that production source changed. Only strict verification evidence against the real application may produce a verified source receipt.
- Do not regenerate or directly edit a board protected as production, change-set, approved, or verified. Branch from the protected revision instead. Editing an in-review or Preferred draft returns it to draft and clears the stale decision state.
- Preserve native undo/redo for comments, decision transitions, change-set markers, and board mutations.

The HTML Board owns this lifecycle. The Mermaid wrapper must not encode workflow status or invent approval, application, or verification receipts.

## Placement rules

- Use one diagram per HTML Board unless the user explicitly asks for a catalog.
- Keep the diagram as the dominant surface; avoid a card inside another card.
- Put explanation, comparisons, comments, and version branches on the native canvas around the board.
- Use the HTML Board's responsive presets rather than hand-authoring separate fixed frames for Desktop, Tablet, and Phone.
- Keep a stable artifact and board ID so regeneration updates the existing surface instead of creating duplicates.

## Acceptance checks

Before handoff:

1. The `.mmd` validates through the chosen renderer.
2. The wrapper contains the full source and matching SHA-256 hash.
3. The diagram is legible at fit-to-board and readable-detail zoom.
4. No label is clipped and the reading direction is unambiguous.
5. Design, Inspect, and Interact modes remain owned by the existing HTML Board.
6. The editing model is labeled `Mermaid source-editable`; do not imply that individual SVG paths are native OpenPencil nodes.
7. Regenerating the same artifact overwrites the same output and preserves the stable artifact ID.

## Semantic command boundary

If agent automation is added, extend the existing OpenPencil MCP with one idempotent command such as `upsert_html_board`. It should accept explicit document, page, board, and artifact IDs plus an expected base revision. Schema v6 source mapping and implementation-request services already exist in the app and do not require a new MCP; expose those application services through the current OpenPencil server only when an authorized executor is added. Do not create a second MCP server for diagrams.
