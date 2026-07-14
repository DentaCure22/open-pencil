---
name: openpencil-flowchart-maker
description: Create polished, editable OpenPencil flowcharts from the duplicated Figma Flow Chart kit or its native primitives. Use when mapping product journeys, processes, decisions, sitemaps, user personas, design-thinking exercises, or live application flows that need a clean visual guide and professional board composition.
---

# OpenPencil Flowchart Maker

Create quiet, legible flowcharts that feel deliberately designed. Reuse the duplicated Figma Flow Chart kit before drawing replacements, use Mermaid when automatic layout is the better source of truth, and reject visually weak boards after screenshot review.

## Source template

Use the duplicated Figma Flow Chart kit with file key `OEpZ66fGl7KqlbcbAiRrUc` as the preferred source library. Its useful native vocabulary is:

- structure: `Page`, `Section`
- steps and decisions: `Modal`, `Choice`, `Option`
- supporting meaning: `Quote`, `Label`, `Check`
- relationships: `Straight`, `Curve`, and `Flow` connectors
- example compositions: `Sitemap`, `User Persona`, and `Design Thinking`

Read [references/template-grammar.md](references/template-grammar.md) before selecting primitives or composing the board. Reuse the kit's proportions and connector behavior; adapt its content, hierarchy, and color to the user's actual job.

## Required workflow

1. Define the job before drawing.
   - State the question the chart must answer in one sentence.
   - Identify the audience, start, finish, primary path, and only the meaningful branches.
   - Choose exactly one initial chart family: linear flow, decision flow, sitemap, persona map, or design-thinking map.
   - Choose one reading direction for the entire primary chart: left to right by default, or top to bottom when the canvas or content clearly favors it.

2. Inspect and import before recreating.
   - Look for an already imported kit page, local `.fig`, or Figma clipboard selection from file `OEpZ66fGl7KqlbcbAiRrUc`.
   - Prefer copying a matching kit example or primitive set into the working page.
   - Preserve native OpenPencil frames, text, shapes, components, and connector endpoints. A flattened image is reference evidence, never the finished chart.
   - When the full kit is unnecessary, import only the primitive family and example required for this chart.
   - If import is unavailable, recreate the grammar with native editable nodes and report that the result is a reconstruction.

3. Choose the editing model.
   - Use native kit primitives when the user needs direct shape, connector, or component editing in OpenPencil.
   - Use Mermaid rendered inside an HTML Board when automatic layout, source-controlled diagrams, responsive presentation, or fast regeneration matters more than dragging individual shapes.
   - For the Mermaid route, preserve the validated `.mmd` source with the rendered artifact. The SVG or PNG is a view of the source, not the source itself.
   - Read [references/html-board-handoff.md](references/html-board-handoff.md) and use its wrapper contract. Do not fork or reimplement the HTML Board renderer.
   - State the result honestly as `Native editable`, `Mermaid source-editable`, or `Rendered reference`.

4. Write a compact visual brief.
   - Name the focal path, reading direction, node count, branch count, and intended review zoom.
   - Set one spacing system, one node-width family, one corner-radius family, and one connector style.
   - Use a neutral surface palette plus one accent. Reserve semantic colors for decisions, warnings, and completed outcomes.
   - Define what will be omitted or moved to a separate detail view.

5. Build the information skeleton.
   - Place the start, primary steps, decisions, and outcome before decoration.
   - Keep the happy path on one stable axis and attach exceptions on the nearest open side.
   - Align sibling nodes and distribute them evenly. Size nodes from their labels instead of stretching them to fill the canvas.
   - Make connectors short, directional, attached to node edges, and free of crossings whenever possible.
   - Add connector labels only when the route is ambiguous; label decision exits with short choices such as `Yes` and `No`.

6. Apply the kit grammar.
   - Use `Page` for destinations or major screens, `Modal` for temporary overlays, `Choice` for a decision point, and `Option` for a selectable branch.
   - Use `Section` only for meaningful phases or domains, not as a decorative wrapper around every cluster.
   - Use `Label`, `Quote`, and `Check` sparingly for orientation, evidence, and confirmed outcomes.
   - Prefer `Flow` connectors for the primary journey, `Straight` connectors for compact hierarchies, and `Curve` connectors only when they clarify a secondary relationship.
   - Do not turn every node into a card inside another card. Most of the chart should sit directly on the board.

7. Guide the user on live-flow boards.
   - When mapping a live application flow, create a small guide before or beside the chart.
   - Show the reading direction, start cue, meanings of production/reference versus draft/alternate states, and how to open or follow a state.
   - Keep the guide below 15% of the main composition and use a miniature visual example instead of explanatory paragraphs.
   - Make source-backed application states visually dominant and mark reconstructed states `Illustrative preview`.
   - When edit versions branch from states, keep journey progression on the primary axis and versions on the perpendicular axis.

8. Make a restraint pass.
   - Replace sentences with labels of one to five words wherever meaning survives.
   - Keep titles, section labels, node labels, and optional annotations to four visible type levels or fewer.
   - Remove redundant legends, ornamental badges, nested backgrounds, repeated descriptions, and any container that adds no grouping meaning.
   - Preserve generous outer margins, consistent node padding, and visibly equal gaps.

9. Run screenshot QA and revise.
   - Capture the full chart at fit-to-view and the main decision area at readable detail zoom.
   - Judge the rendered screenshots, not only scene-graph coordinates.
   - Score both views with [references/eval-checklist.md](references/eval-checklist.md).
   - Reject any hard-gate failure or score below 85/100.
   - Revise at least once after screenshot inspection. Re-check spacing, centering, reading order, connector routing, text density, and visual balance after the revision.
   - Treat user rejection as a failed evaluation. Record the visible failure pattern and ensure it is absent from the next screenshot.

## Composition limits

- Default to 5–9 primary nodes in one overview; split larger systems into linked sections or views.
- Keep node copy to a short title and, only when essential, one brief supporting line.
- Use at most one surrounding container level inside a top-level section.
- Use one accent color plus no more than three restrained semantic colors.
- Keep the primary path visually stronger than secondary branches.
- Keep guidance under 15% of the main composition.
- Keep all labels readable at the intended review zoom.
- Do not use miniature application screenshots as decoration; they must remain reviewable or open into a focused view.

## Automatic rejection

Reject and redesign when any of these are visible:

- mixed reading directions on the primary path
- excessive prose or a legend required to understand the basic route
- containers nested inside containers without distinct semantic meaning
- uneven spacing, drifting baselines, or labels that are not optically centered
- connector crossings that can be removed by reordering nodes
- many colors with no semantic system
- identical visual weight for primary steps, secondary notes, and metadata
- flattened screenshots or images used in place of editable chart nodes or preserved Mermaid source
- empty canvas added merely to make the board feel large
- a polished guide paired with an unpolished chart
- a distant full-board screenshot presented as the only quality evidence

## Coordination

- Use `$openpencil-design-director` when the board needs broader visual direction or multiple view archetypes.
- Use `$openpencil-flow-states` when the nodes represent persistent application states with transitions and edit-version branches.
- Use `$openpencil-edit-versions` when a step has Draft, Alternate, Preferred, Review, Approved, or Archived variants.
- Use `$openpencil-agent-bridge` for semantic board operations, import capability, and source-safety decisions.
- Use `$mermaid-skill` to generate, validate, render, and visually review `.mmd` sources before wrapping them for an HTML Board.

The HTML Board implementation owns sandboxing, responsive viewports, Inspect/Interact behavior, persistence, and undo. This skill only hands it validated HTML/CSS plus diagram provenance; it must not duplicate that runtime.

This skill owns flowchart composition and may reject output that is technically connected but visually unclear.

## Completion report

Report the chosen chart family and reading direction, imported kit source or reconstruction status, reusable primitives, main path and branches, guide status for live flows, editing model (`Native editable`, `Mermaid source-editable`, or `Rendered reference`), preserved source location, screenshot views inspected, evaluation result, and the revision made after visual review.
