# Native design bridge metric

This is a candidate quality gate, not a claim of held-out optimization.

## Hard gates

- The result imports as a native `.fig` document with editable frames and text.
- A real production capture is present and occupies at least 55% of the main review row.
- Surface nesting is at most one level deep.
- The composition uses no more than four text sizes.
- All authored spacing values come from the 4/8 px scale.
- The board has one focal artifact and no more than three primary flow states.
- The exported render contains no missing image tile or clipped primary label.

## Visual acceptance

- Reading direction is obvious without a legend.
- The active state, the edit branch, and the source handoff are distinguishable at a glance.
- Guidance is short and visually subordinate to the product capture.
- Alignment is shared across the header, flow rail, capture, and review panel.
- Empty space separates groups instead of extra container layers.

## Regression fixtures

Reject a candidate if it recreates any of these previously rejected patterns:

- explanatory paragraphs spread across the board
- nested pale cards with little hierarchy
- miniature fake product screens
- decorative pills used as the main visual language
- inconsistent centering or arbitrary spacing

