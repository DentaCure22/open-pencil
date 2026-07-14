---
name: openpencil-knowledge-canvas
description: Author and organize polished OpenPencil knowledge workspaces that combine Notion-like writing, infinite-canvas drawing, structured graphs, design artifacts, and safely embedded real application states. Use when a user wants to write, map, diagram, brainstorm, design, document, or organize mixed content on an OpenPencil board; create flowcharts, architecture maps, mind maps, dependency graphs, ERDs, or app atlases; embed a live application beside notes and designs; or expose the same workspace through document, canvas, graph, and review views.
---

# OpenPencil Knowledge Canvas

Build one typed workspace that can be viewed as a document, spatial canvas, graph, or review surface. Preserve the difference between authored board content, saved application evidence, an active live application, preview edits, and production source.

The result must feel intentionally designed. A technically valid pile of text boxes, rectangles, screenshots, or generic cards is not complete.

## Coordinate specialized skills

- Use `$openpencil-design-director` before substantial visible composition; it owns reference selection, view archetypes, visual direction, screenshot scoring, and rejection of technically valid but weak design.
- Use `$openpencil-agent-bridge` to choose the safe control path, inspect the real workspace, and distinguish board, live-preview, metadata, proposed-patch, and source scopes.
- Use `$openpencil-flow-states` for user journeys and application-state sequences.
- Use `$openpencil-edit-versions` for drafts, alternatives, comparisons, review, and promotion.
- Keep this skill in control of mixed-content organization, cross-view identity, knowledge structure, and overall visual composition.

## Core object rule

Create typed objects, not visually similar substitutes. Every durable object has a stable ID, type, content or source reference, revision, parent or collection, canvas geometry when applicable, relationships, and view metadata.

Use these primary types:

- Document block — heading, paragraph, list, task, quote, code, callout, table, or media.
- Collection — database-like records with properties, relations, and saved table, board, list, gallery, or calendar views.
- Canvas object — ink, shape, frame, annotation, connector, or spatial group.
- Graph object — typed node or edge with a declared graph and layout role.
- Design artifact — component, token, mockup, asset, variant, or design note.
- Live App Block — route- and scenario-backed application state with runtime and capture evidence.
- Review object — comment, decision, comparison, status, or change-set reference.

Read [references/object-model.md](references/object-model.md) before defining or changing durable workspace objects.

## Workflow

1. Resolve the workspace and intent.
   - Inspect the current document, page, selected objects, user-created content, tokens, live runtime health, and revision.
   - Determine whether the user needs writing, exploration, explanation, a decision, a product change, or a mixture.
   - Preserve existing layout and authorship unless rearrangement is requested or clearly required for legibility.

2. Choose objects and views.
   - Select the smallest set of typed objects that represents the work honestly.
   - Choose one primary view: Document, Canvas, Graph/Atlas, or Review.
   - Add secondary views only when they clarify the same underlying objects; do not duplicate content into disconnected copies.
   - Read [references/views-and-layouts.md](references/views-and-layouts.md) for view and graph conventions.

3. Establish orientation.
   - For a complex board, add a compact native guide explaining the title, purpose, reading direction, legend, and live-versus-static meaning.
   - For a simple note or small diagram, use a clear title and visible structure instead of a large guide.
   - Keep guidance visually quieter than the authored work.

4. Author content before decoration.
   - Write concrete headings, labels, relationships, decisions, and examples.
   - Preserve real product terminology and recognizable application content.
   - Use links and backlinks when two objects refer to the same concept, source target, or live state.
   - Keep annotations near the objects they explain.

5. Build the structure pass.
   - Establish a clear focal point, reading direction, groups, hierarchy, repeated geometry, and connector routing.
   - Apply the correct convention for the graph type rather than forcing every graph into a flowchart.
   - Keep document reading order meaningful even when blocks also have spatial positions.

6. Handle real application content safely.
   - Read [references/live-app-block.md](references/live-app-block.md) before creating, activating, editing, or representing a Live App Block.
   - Attach route, scenario or fixture, viewport, source revision, runtime status, and capture provenance.
   - Use one shared runtime for the selected active block; keep inactive states as source-backed captures or lightweight previews.
   - Label reconstructed or unavailable-runtime substitutes `Illustrative preview`.
   - Never imply that a board edit, capture, or live-preview edit changed production source.

7. Build the polish pass.
   - Use native OpenPencil and product tokens where available.
   - Refine typography, spacing, density, borders, status color, preview fidelity, and connectors.
   - Use at least three deliberate type levels on a substantial board.
   - Prefer a restrained semantic palette and repeated spacing/radius rules.
   - Remove accidental dead space, redundant prose, vague placeholders, and unnecessary chrome.

8. Verify across views and scopes.
   - Confirm stable IDs and relationships survive switching among Document, Canvas, Graph/Atlas, and Review.
   - Confirm only one intended Live App Block owns the active shared runtime.
   - Confirm snapshots remain visually distinct from live states and preview changes remain distinct from source changes.
   - Run overlap, color, typography, and spacing analysis when available.
   - Export the primary composition, inspect it at fit-to-board and readable-detail scale, and revise at least once.
   - Use [references/validation.md](references/validation.md) for the completion matrix.

## Graph routing

Choose native OpenPencil objects when the result belongs on the board, mixes with user-authored content, carries durable identity, or represents real application states, versions, reviews, or live embeds. Use a static Mermaid-style diagram only for a disposable explanation or export that does not need OpenPencil identity, interaction, or live runtime behavior.

- User or application journey: horizontal directed flow; use `$openpencil-flow-states` when states are real application states.
- Mind map or concept map: radial or clustered organization with short relationship labels.
- Architecture map: layered boundaries with explicit interfaces and data/control direction.
- Dependency graph: directed acyclic layout where possible; surface cycles and blockers rather than hiding them.
- Entity relationship diagram: consistent entity geometry, cardinality, and orthogonal relationships.
- Decision tree: top-down choices with mutually exclusive branch labels and visible outcomes.
- App Atlas: source-backed screen/state nodes, labeled transitions, discovery confidence, and review status.

## Tool fallback

Use the existing OpenPencil MCP server or equivalent in-app command service; do not create a second agent protocol. Stock scene-graph tools are sufficient for ordinary text, shapes, connectors, layout, analysis, and export. Semantic commands are required for durable typed objects, cross-view identity, live runtime activation, versions, review transitions, and source-aware work.

If typed workspace mutation is not available, create a truthful illustrative composition only when useful, label it appropriately, and report the missing command rather than pretending generic scene nodes are durable knowledge objects.

Read [references/semantic-capabilities.md](references/semantic-capabilities.md) when implementing, reviewing, or reporting tool coverage.

## Completion report

Report the workspace, primary and secondary views, objects created or changed, graph convention, live versus static states, runtime owner, visual-QA evidence, source-change status, and any missing semantic capability.
