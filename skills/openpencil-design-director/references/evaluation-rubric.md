# Screenshot-based design evaluation

Score the rendered artifact, not the prompt or scene graph. Return both a number and specific visual feedback.

## Hard gates

Any failure caps the result at 59/100:

- the primary task or decision is not identifiable within five seconds
- important content clips, overlaps, or becomes unreadable
- the design falsely presents illustrative content as live or production-backed
- the view requires extensive prose to explain its basic layout
- Focus or Compare lacks a reviewable product screen or equivalent primary artifact
- obvious accidental dead space or uncontrolled crowding dominates the composition
- a live or captured product screen was available but a fake reconstruction dominates instead
- the claimed variants do not expose identifiable changed pixels or controls

## Weighted score

### Information architecture — 20

- one clear job per view
- appropriate Overview, Focus, Compare, Knowledge, or Review archetype
- progressive disclosure instead of simultaneous exposure
- obvious entry point and navigation

### Product fidelity and evidence — 20

- real or clearly labeled illustrative product evidence is dominant
- recognizable product density, proportions, components, and terminology
- state/version differences are visible in the artifact
- distinctive product geometry survives the composition instead of being normalized into generic cards

### Visual hierarchy and readability — 20

- strong focal point
- deliberate type scale and contrast
- readable labels and body copy at intended zoom
- supporting information remains subordinate

### Spatial composition — 15

- balanced mass, margins, alignment, and grouping
- size derives from content
- connectors and relationships are simple and unambiguous
- no accidental dead zones

### Restraint and visual system — 10

- product tokens or a coherent fallback system
- limited accent use and semantic status color
- controlled border, radius, and elevation language
- no card-on-card proliferation

### Interaction and navigation — 10

- pages/sections or views are independently focusable
- selection reveals detail without obscuring the main view
- overview and detail zooms both work

### Source truth and safety — 5

- live, captured, illustrative, draft, approved, and source-applied states remain distinct

## Passing bands

- 90–100: exceptional and ready to present
- 80–89: polished and usable
- 70–79: directionally sound but requires revision
- 60–69: structurally understandable, visually weak
- below 60: reject

## Feedback format

Return:

1. total score and category scores
2. hard-gate failures
3. the three highest-impact changes
4. one thing to preserve
5. overview-zoom result
6. detail-zoom result

## Evidence policy

- The creator's self-score is never proof of improvement.
- Save the baseline and candidate screenshots side by side and name the exact visual differences.
- A user rejection overrides a passing self-score and becomes a regression fixture.
- When a real product capture exists, verify that it is the dominant visual evidence and that any overlay is clearly separable from the captured pixels.
- Reject descriptions such as "more polished" or "cleaner" unless the screenshot shows the concrete hierarchy, density, fidelity, or composition change.
