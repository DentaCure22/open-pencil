# Board guide specification

## Required regions

1. Guide card: title, purpose, legend, miniature example.
2. Production row: protected real states arranged left to right.
3. Version columns: Draft and Alternate frames beneath their source state.
4. Decision edge: Preferred, Review, and Change Set objects at the end or lower-right.

## Layout contract

- Horizontal gap between flow states: one consistent large spacing token.
- Vertical gap between source and versions: one consistent medium spacing token.
- Keep connectors orthogonal and avoid crossings.
- Align frames by headers, not arbitrary screenshot edges.
- Keep guide content visible at fit-to-board zoom.
- When side panels are open, fit the active comparison into the unobscured canvas using explicit left, right, top, and bottom insets. Do not center against the full browser window.
- Use a restrained accent system: production neutral, active violet/blue, review amber, approved green, archived gray.
- Keep the guide around 15-22% of the composed board height and visually quieter than the real screens.
- Use a deliberate outer margin, one large horizontal rhythm, one medium vertical branch rhythm, and one compact internal card rhythm.
- Keep related screen cards equal in width and preview height unless a true product-state difference requires otherwise.
- Preserve enough detail inside every screen that users can recognize the route and understand the state without reading its annotation.

## Guide copy

- Title: `How this board works`
- Primary legend: `Flow goes across`
- Secondary legend: `Versions branch down`
- Source cue: `Start from the real app`
- Safety cue: `Production stays unchanged until an approved change set`

## Quality bar

- A first-time user can identify the start, direction, alternatives, and decision point in five seconds.
- No label is dependent on hover.
- No state is represented as live unless it has a valid route/scenario identity.
- The guide uses the native OpenPencil shell and product tokens rather than a detached dashboard.
- The composition has a clear focal point, balanced density, consistent geometry, and no accidental dead zones.
- Typography has at least three deliberate levels: board title, state title, and supporting/status copy.
- Status color is semantic and restrained; it never replaces labels.
- Connectors are aligned, orthogonal, non-crossing, and visually subordinate to screens.
- Screen previews resemble the real product; generic skeletons are allowed only as explicitly labeled illustrative fallbacks.
- The board has been exported and visually inspected after the final layout pass.

## Automatic rejection conditions

Reject and refine the board if any of these are true:

- the guide is larger or louder than the screen flow
- cards use inconsistent padding, radii, widths, or header treatments without reason
- most of the screen preview is empty or generic placeholder space
- the user must read long prose to understand the direction or branch relationship
- more than one accent competes within a single status role
- important text clips, truncates, or becomes unreadable at fit-to-board zoom
- arrows cross frames, labels, or other connectors
- the exported image reveals obvious imbalance, crowding, or excessive dead space
