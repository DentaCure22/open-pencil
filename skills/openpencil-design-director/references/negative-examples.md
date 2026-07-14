# Negative examples

## Rejected Dental Chart board — 2026-07-12

Artifacts:

- `/Users/omar/Documents/Open Pencil/artifacts/design-director/overview-reviewed.png`
- `/Users/omar/Documents/Open Pencil/artifacts/design-director/active-chart-reviewed.png`
- `/Users/omar/Documents/Open Pencil/artifacts/design-director/versions-reviewed.png`
- `/Users/omar/Documents/Open Pencil/artifacts/design-director/knowledge-reviewed.png`

Observed failures:

- Fake miniature dental screens replaced the recognizable production interface.
- Repeated pale rounded cards flattened the hierarchy and made every view feel interchangeable.
- The variants were mostly different labels and skeleton rectangles rather than visible UI changes.
- The knowledge surface imitated a light Notion skin but not document hierarchy, linked records, or progressive disclosure.
- The board used Figma/Notion as a visual style reference instead of as spatial and interaction grammar.
- A self-awarded 89/100 obscured obvious screenshot weaknesses and was rejected by the user.

Regression rule: do not call a later result improved unless the screenshots visibly remove these patterns. Preserve this fixture even after the skill changes.
# Rejected spacing-drift example

- Regression fixture: `artifacts/native-layout-kit/flow-review-rejected-spacing.png` (or the earlier `flow-review-live.png` when the named copy is unavailable).
- Failure: browser-authored spacing was converted into auto-layout, creating loose vertical islands and weakening shared alignment.
- Required correction: use the live HTML surface for exact CSS geometry, tighten the board to one outer rhythm, and verify the Design and Interact screenshots separately.
