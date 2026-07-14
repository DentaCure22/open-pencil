# OpenPencil visual-quality contract

Use this contract for every guide, flow, version board, comparison, review lane, or change-set visual created by an agent.

## Design intent

The board should feel like a polished product-design review inside native OpenPencil. It should not look like a generic flowchart, wireframe kit, detached dashboard, or AI-generated collection of cards.

## Discovery before drawing

Inspect, in order:

1. the real product screen or closest available production capture
2. existing OpenPencil frames and user-created board content
3. product tokens for canvas, surface, text, border, status, spacing, radius, and elevation
4. native OpenPencil shell density and control styling
5. existing components that can be reused rather than reconstructed

If these inputs are unavailable, use a quiet neutral fallback system and label the result illustrative.

## Composition

- Establish one primary reading direction and one secondary branch direction.
- Use a compact guide, a dominant production/state region, and a clearly separated decision edge.
- Keep outer margins generous and even; eliminate accidental dead zones.
- Align by screen headers and card edges, not by arbitrary screenshot content.
- Use repeated geometry to make relationships obvious before labels are read.
- Keep annotations close to the object they explain.

## Screen fidelity

- Prefer actual live frames, captures, or source-backed components.
- Preserve recognizable navigation, content density, component proportions, and key data regions.
- A state difference must be visible in the preview itself.
- Do not use a gradient as a screen substitute.
- Do not fill most of a screen with empty white rectangles or skeletons unless the state is genuinely Loading.
- Mark reconstructed or simplified screens `Illustrative preview`.

## Type and color

- Use at least three deliberate type levels: board title, object/state title, and supporting/status copy.
- Prefer sentence case; reserve uppercase for short status chips and tiny cues.
- Maintain readable contrast and avoid gray-on-gray supporting text.
- Use one semantic color per role: blue current/flow, violet draft/alternate, amber review/loading, green approved/success, gray archived.
- Keep production surfaces neutral and let the product screen remain the visual focus.

## Geometry and spacing

- Related frames share width, header height, radius, border, and internal padding.
- Use one large gap for journey states, one medium gap for vertical branches, and one compact gap inside cards.
- Connectors use a consistent weight, radius, arrow treatment, and label position.
- Avoid shadows on every surface; use border and subtle elevation only where hierarchy needs it.

## Two-pass requirement

### Pass 1: structure

- establish hierarchy, reading direction, frame sizes, grouping, and connector routing
- attach real route/scenario/version identity
- verify that the board is understandable without decorative styling

### Pass 2: polish

- refine typography, spacing, color, density, screen fidelity, labels, status chips, and annotations
- remove unnecessary chrome and prose
- balance the composition at fit-to-board zoom

## Visual QA

Before completion:

1. inspect at fit-to-board zoom
2. inspect at readable screen-review zoom
3. run overlap, color, typography, and spacing analysis when available
4. export the primary composition as an image
5. inspect the export for clipping, truncation, weak contrast, imbalance, vague placeholders, and accidental empty space
6. revise at least once after visual inspection

Do not report a board as polished unless the exported image passes this review.
