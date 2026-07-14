# OpenPencil Design Director evaluation

Date: 2026-07-12

Scenario: Dental Chart design-review board built from the real Smylr `/dental-chart` surface.

This remains a same-scenario skill test. It is not held-out proof and it is not a GEPA optimization run.

## Corrected outcome

The earlier four-board result and its self-awarded 89/100 are rejected. The user correctly identified that the screenshots still looked generic. The old output is now a negative regression fixture, not a passing candidate.

The replacement uses one Review/Focus view with:

- the real product capture as roughly three quarters of the visual evidence
- three annotations placed on exact product regions
- one narrow decision rail instead of repeated white cards
- one compact lifecycle strip for production, edit, review, and source handoff
- explicit live-capture and source-unchanged labels

## Visible changes from the rejected board

| Rejected pattern | Replacement |
| --- | --- |
| Fake miniature dental screens | Real `/dental-chart` capture |
| Four interchangeable pale boards | One focused dark review canvas |
| Text-described variants | No variant is claimed until changed pixels exist |
| Figma/Notion as a white-card skin | Figma-like spatial review plus Notion-like progressive detail |
| Self-score as proof | Baseline/candidate screenshots and user review are the evidence |

## Revision log

1. Captured the live Smylr Dental Chart.
2. Rebuilt the canvas around that capture and removed the four generic views.
3. Rejected the first replacement screenshot because rail and footer text clipped.
4. Constrained text geometry and tightened the review copy.
5. Replaced the image-filled overlay frame with a leaf image rectangle; this removed CanvasKit black occlusion at reduced zoom.
6. Bound every MCP operation to explicit `document_id: tab-1` and `page_id: 0:2`, which put the board in the visible client.

## Review evidence

- [Real product capture](artifacts/design-director/real-dental-chart.png)
- [Clean board export](artifacts/design-director/real-product-review-v1.png)
- [Unobstructed live canvas](artifacts/design-director/real-product-review-live-clean.png)

## Current status

The replacement is visually stronger and the live canvas is left at fit-to-board zoom with side panels closed. Source code was not changed. The design skill still needs held-out billing and inventory tests before it can be described as optimized.
