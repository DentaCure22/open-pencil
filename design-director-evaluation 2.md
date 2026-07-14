# OpenPencil Design Director self-test

Date: 2026-07-12

Scenario: Dental Chart flow, active charting focus, safe edit-version comparison, and knowledge detail.

This is a same-scenario baseline-versus-candidate self-test. It validates that the seed skill can materially improve one real board. It is not held-out proof and it is not a GEPA optimization run.

## Outcome

| Criterion | Baseline | Candidate | Evidence |
| --- | ---: | ---: | --- |
| Information architecture | 6/20 | 18/20 | One mega-board became four independently focusable views. |
| Product fidelity and evidence | 10/20 | 17/20 | Product UI dominates Overview, Focus, and Compare; all reconstructed screens are labeled illustrative. |
| Visual hierarchy and readability | 7/20 | 18/20 | Clear focal statement, restrained type scale, and readable review zoom. |
| Spatial composition | 6/15 | 13/15 | Consistent 1600×1000 frames, balanced columns, and one job per view. |
| Restraint and visual system | 4/10 | 9/10 | Neutral Figma/Notion surfaces, one blue accent, and restrained semantic colors. |
| Interaction and navigation | 6/10 | 9/10 | Named top-level frames, consistent four-view navigation, and reliable layer-tree focusing. |
| Source truth and safety | 5/5 | 5/5 | Illustrative, draft, preferred, and production states remain explicit. |
| **Total** | **44/100 — reject** | **89/100 — polished and usable** | Candidate clears the 80-point threshold. |

Hard-gate result: pass at focused review zoom. The primary decision is identifiable within five seconds, product evidence is reviewable, and no production claim is implied.

## Revisions made after screenshot inspection

1. Replaced the single mixed mega-board with Overview, Focus, Compare, and Knowledge views.
2. Moved the result onto the existing visible OpenPencil page after proving that newly created automation pages did not appear in the workspace navigator.
3. Increased inter-view gutters and made focused per-view screenshots the quality gate because the distant CanvasKit fit-all/export path can show transient black occlusion blocks.

## Review evidence

- [Flow Overview](artifacts/design-director/overview-reviewed.png)
- [Active Charting Focus](artifacts/design-director/active-chart-reviewed.png)
- [Versions Review](artifacts/design-director/versions-reviewed.png)
- [Knowledge Detail](artifacts/design-director/knowledge-reviewed.png)

## What to preserve

The strongest improvement is progressive disclosure: the board shows the journey first, the application state second, the alternatives third, and the design reasoning only when requested.

## Remaining validation

Run the seed skill against the held-out scenarios in `references/eval-scenarios.md` before calling it generally optimized. The next useful tests are a patient scheduling flow and a non-clinical knowledge workspace.
