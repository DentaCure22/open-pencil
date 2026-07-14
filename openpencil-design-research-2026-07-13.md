# OpenPencil design research — critique working surfaces

Date: 2026-07-13

## Problem observed

The latest Dental Chart board is cleaner and uses real production evidence, but it behaves like a polished review slide. It explains an authored conclusion instead of creating a place where a team can inspect the product, contribute feedback, compare a changed region, and resolve a decision.

## External reference findings

### Figma design critiques

Source: https://www.figma.com/blog/design-critiques-at-figma/

- Critique should unblock work, generate ideas, improve quality and consistency, and share context.
- The author should state the context and the feedback they want and do not want.
- Detailed inspection happens in the actual Figma artifact, not in a detached presentation.
- Workshop-style critique leaves ample canvas room and uses location-aware contributions.
- Process changes should be treated as experiments and revised from use.

### Figma engineering critiques

Source: https://www.figma.com/blog/how-we-run-eng-crits-at-figma/

- Critique is early feedback, not an approval ceremony.
- The open canvas carries screenshots, prompts, and context while reviewers contribute in parallel.
- Scope and framing come first; iteration and refinement follow.

### Figma comments

Source: https://help.figma.com/hc/en-us/articles/360039825314-Guide-to-comments-in-Figma

- Comments stay in the original design file.
- A comment is attached to an exact canvas region.
- Discussion detail can be managed without replacing the artifact.

### Notion database views and side peek

Source: https://www.notion.com/help/views-filters-and-sorts

- One underlying collection can be viewed in multiple useful forms.
- Side peek opens selected detail while the collection remains interactive.

## Rules extracted for OpenPencil

1. Lead with a compact feedback contract: `Feedback wanted`, `Not evaluating`, and the current review stage.
2. Keep the captured product as the dominant working artifact.
3. Attach no more than three contributions to exact product regions.
4. Open the selected contribution in a side-peek panel while keeping the product visible.
5. Show a proposed branch through changed pixels inside the real product region, not through explanatory labels alone.
6. Include an obvious contribution or resolution affordance.
7. Prefer an open critique composition over a large hero title, explainer rail, or decorative lifecycle footer.

## Candidate evaluation metric

This is a manual candidate refinement, not a held-out optimization result.

- Hard gates: real capture remains dominant; requested and excluded feedback are visible; exact anchors are visible; selected side detail is visible; proposed edit changes identifiable pixels.
- Regression: the result must not retain the rejected hero-title plus one-way explanation-rail structure.
- Screenshot review: inspect both the exported board and the live OpenPencil canvas, then revise at least once.
