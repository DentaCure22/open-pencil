---
name: openpencil-design-director
description: Direct the visual design of OpenPencil, Figma-like canvases, Notion-like knowledge views, product-flow boards, comparison surfaces, and mixed design work. Use when creating or substantially revising visible OpenPencil content, especially when the agent must improve hierarchy, composition, product fidelity, density, navigation, or aesthetic quality rather than merely create valid scene nodes.
---

# OpenPencil Design Director

Compensate for weak default visual instincts with reference-conditioned design, explicit view selection, reusable composition patterns, and screenshot-based rejection. A valid scene graph is not a designed experience.

## Core product model

Treat OpenPencil as two coordinated products:

- Figma/FigJam spatial work: infinite canvas, pages or sections, large design evidence, selection, focus, comparison, connectors, and collaboration.
- Notion knowledge work: typed objects, sparse document hierarchy, multiple views over shared data, linked evidence, and focused side-detail instead of showing everything simultaneously.

Do not combine every capability into one mega-board. The same objects may have Overview, Focus, Compare, Knowledge, and Review projections.

## Required workflow

1. Diagnose the job before drawing.
   - State the user's decision or task in one sentence.
   - Inspect the real product, current canvas, nearby native chrome, and product tokens.
   - Capture the current design as a baseline when redesigning existing work.
   - When a live product route exists, capture it before authoring any replacement screen. The capture is the source image; reconstruction is only a last-resort fallback.

2. Condition on references.
   - Choose two or three relevant visual references from the supplied reference pack or current product examples.
   - Extract a concrete visual grammar: information density, section scale, type scale, color restraint, borders, spacing, navigation, and interaction.
   - Copy principles and proportions, never branding or proprietary content.
   - Treat the real product capture as the first reference. Figma and Notion are interaction and composition references, not a white-card visual skin.
   - When freehand node composition remains weak, use the native external-design bridge in `references/native-design-bridge.md`: borrow layout discipline, import native editable structure, then critique the rendered result.
   - When exact CSS geometry or interaction is the requirement, use the hybrid HTML surface in `references/html-board-surface.md` instead of converting the design back into auto-layout nodes.

3. Select one primary view archetype.
   - Overview: orientation and the smallest useful map.
   - Focus: one primary artifact plus contextual detail.
   - Compare: two or three alternatives with visible differences.
   - Knowledge: document or collection view with linked evidence.
   - Review: decision, comments, risks, and handoff readiness.
   - Use separate pages or clearly separated top-level sections when more than one archetype is needed.

4. Write the visual brief before scene nodes.
   - Name the focal object, reading direction, navigation model, and maximum visible objects.
   - Define type, spacing, radius, surface, border, and semantic-status tokens.
   - Specify what is intentionally hidden, collapsed, or moved to another view.
   - Name the distinctive visual anchor from the product and the exact proportion of the view it must occupy.

5. Make a structure pass.
   - Create the top-level section and the focal artifact first.
   - Size from content outward; do not stretch content to fill an arbitrary board.
   - Use repeated geometry only for repeated meaning.
   - Keep real screens or source-backed captures visually dominant.
   - Place annotations beside or directly over the exact product area they describe. Do not separate evidence and explanation into unrelated card collections.
   - If a real capture is available, never redraw the screen with placeholder rectangles, fake miniature UI, or decorative approximations.
   - For an interactive HTML board, keep the browser-rendered design inside one spatial frame and place flow links, comments, versions, and receipts in the native canvas layer.

6. Make a polish pass.
   - Use product tokens and reusable components before hardcoded primitives.
   - Refine hierarchy, density, alignment, labels, status treatment, and interaction cues.
   - Remove explanatory prose that compensates for unclear layout.

7. Run the screenshot critic.
   - Inspect Overview at fit-to-section zoom and Focus/Compare at readable-detail zoom.
   - Focus each top-level view independently and capture it at review zoom; a distant fit-all canvas is orientation evidence, not visual-quality proof.
   - If page creation or page switching is not visibly synchronized with the OpenPencil navigator, use separate named top-level frames on the current visible page instead of claiming an invisible page is reviewable.
   - Treat geometry analyzers as supporting evidence when their text bounds disagree with the visible renderer; record the mismatch and judge clipping from the focused screenshot.
   - Score with `references/evaluation-rubric.md` and include actionable failure feedback.
   - Reject any hard-gate failure or total below 80/100.
   - Revise at least once after screenshot inspection; a substantial redesign normally needs two revisions.
   - Self-scoring is diagnostic only. It is not completion evidence and cannot overrule visible screenshot problems or user rejection.
   - User rejection turns that output into a negative example. Record the failure pattern and verify that the next screenshot no longer contains it.

8. Preserve product truth.
   - Mark reconstructed screens `Illustrative preview`.
   - Distinguish active live application, saved capture, draft preview, and production source.
   - Never imply that canvas work changed source code.

## Default Figma/Notion composition

When the user has not chosen a direction, begin with one strong Focus or Review view. Add linked views only when they answer a separate decision:

1. State Focus: one large real screen and a narrow contextual rail.
2. Flow Overview: four to six states, minimal metadata, no detailed documentation.
3. Version Compare: production and up to two alternatives, equal geometry, changed pixels visible.
4. Knowledge Detail: concise brief plus linked records/evidence; open deep detail separately.

Each view must remain useful and readable on its own.

## Quantitative guardrails

- One focal object per view.
- No more than six primary objects in Overview.
- No more than three alternatives in Compare.
- Screen evidence should occupy at least 55% of Focus or Compare visual area.
- When a production capture exists, it should occupy at least 65% of the first review view.
- Guidance should occupy no more than 15% of a substantial view.
- Use at least three type levels and no more than five in one view.
- Use one product accent plus restrained semantic status colors.
- Use one outer rhythm, one relationship rhythm, and one compact internal rhythm.
- Keep body copy readable at detail zoom; avoid tiny copy intended only to make a screenshot look busy.
- Use no more than three annotations per screen before moving detail to Knowledge or Review.

## Automatic rejection

Reject and redesign when any of these are true:

- overview, focus, knowledge, and review content are crammed into one artboard
- the board resembles a generic dashboard or pastel flowchart more than the product
- miniaturized screens are decorative rather than reviewable
- most surfaces are containers inside containers without semantic need
- large dead zones exist because parent frames were sized before content
- a legend or paragraph is required to explain the primary reading direction
- low-contrast tints flatten the hierarchy
- repeated cards have no clear focal point
- reconstructed product UI is presented as live or production-backed
- a live capture was available but the screen was redrawn as wireframes, skeletons, or decorative miniatures
- alternatives are labeled as different but the changed UI pixels cannot be identified without reading prose
- Figma or Notion inspiration is represented mainly by pale backgrounds, pills, and rounded white cards
- the agent's own numeric score is the only evidence that the design improved
- screenshot critique identifies obvious imbalance, clipping, unreadable copy, or weak product fidelity

## Skill evaluation

Treat this file as candidate agent instructions, not as proven optimization. Use `references/evaluation-rubric.md`, `references/eval-scenarios.md`, and `references/negative-examples.md` for baseline-versus-candidate testing. Keep train, validation, and test scenarios separate. If GEPA is used, return a score plus actionable textual feedback, choose one budget knob, save run evidence, and do not claim optimization until the held-out target-model score improves. A user-rejected design must remain in the regression set even if it previously received a high self-score.

## Coordination

- Use `$openpencil-agent-bridge` for tool and source-safety decisions.
- Use `$openpencil-knowledge-canvas` for shared typed objects and cross-view identity.
- Use `$openpencil-flow-states` for state identity and transitions.
- Use `$openpencil-edit-versions` for draft, alternate, compare, review, and change-set lifecycle.
- This skill owns visual direction and may reject technically correct output from those skills.

## Completion report

Report the chosen references, view archetypes, rejected iterations, final screenshot evidence, live-versus-illustrative status, and source-change status. Report numeric scores as internal diagnostic results unless an independent or held-out evaluator produced them.
