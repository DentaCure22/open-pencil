# Fluid project territory: external UI and implementation patterns

Research snapshot: 2026-08-26.

## Bottom line

Keep the project territory as an ordinary frame in the scene graph and let an
app-owned overlay provide the fluid skin. The strongest spatial tools keep
containment literal and predictable even when their presentation differs:
children use parent-relative coordinates and travel with their container
([tldraw](https://tldraw.dev/sdk-features/frame-shape),
[Miro](https://developers.miro.com/docs/boards)); drag-in, drag-over, drag-out,
and drop are distinct phases
([tldraw](https://tldraw.dev/sdk-features/drag-and-drop)); and the active valid
destination owns a crossing object instead of the old parent detaching it first
([tldraw](https://tldraw.dev/sdk-features/drag-and-drop)).

That supports the branch's current direction: a quiet semi-transparent
territory, a separate flat title seam, deformation only during movement, a
deliberate detach threshold, and destination-container precedence. The fluidity
should communicate tension and membership; it should not become the membership
algorithm itself.

## Method and source count

Exa discovery reviewed 42 results across seven targeted searches. Seven
Firecrawl Developer Index searches then checked implementation contracts and
official source. The conclusions below rely on the 10 strongest first-party
sources: official product documentation, official SDK documentation, an
official repository source file, and W3C/CSSWG specifications.

## What established spatial tools do

| Pattern | Primary-source evidence | Implication for OpenPencil |
| --- | --- | --- |
| A visible area is still a real container, not a loose selection. | tldraw frames have a labeled header, clip children, store child positions relative to the frame, and move descendants with the frame ([official frame docs](https://tldraw.dev/sdk-features/frame-shape)). | Preserve the existing `FRAME` as the hierarchy owner; the fluid surface is its presentation. |
| Users expect more than one way to establish membership. | Figma sections accept content when a section is drawn or moved over objects, resized over objects, or when objects are moved into the section ([Figma Help](https://help.figma.com/hc/en-us/articles/9771500257687-Organize-your-canvas-with-sections)). | Keep ordinary frame movement/reparenting behavior; the overlay must not create a second interaction model. |
| Parent motion must preserve the internal arrangement. | Miro stores child coordinates relative to the parent's top-left corner, moves children with the parent, and converts them back to board coordinates when the parent relationship is removed ([Miro developer docs](https://developers.miro.com/docs/boards)). | Moving the territory should feel like moving a normal object because it is one; only its skin deforms transiently. |
| Crossing containers is a stateful drag, not a single geometric check. | tldraw separates `onDragShapesIn`, `onDragShapesOver`, `onDragShapesOut`, and `onDropShapesOver`; its `nextDraggingOverShapeId` lets the next container handle a crossing instead of first reparenting to the page ([official drag-and-drop docs](https://tldraw.dev/sdk-features/drag-and-drop)). | Preview acceptance while moving, commit membership on release, and let a valid destination win over detach-to-page. |
| Different products intentionally choose different containment tests. | tldraw detects a drag target by the cursor point and front-to-back hit order, while frame creation encloses only siblings fully inside the new frame ([drag docs](https://tldraw.dev/sdk-features/drag-and-drop), [frame docs](https://tldraw.dev/sdk-features/frame-shape)). Excalidraw's official source treats full containment, boundary intersection, or containing the frame as overlap, and updates membership only for selected elements during a drag ([source](https://github.com/excalidraw/excalidraw/blob/b2e81e38a6fde8b3cb5dfdf2f2fb651323ad309d/packages/element/src/frame.ts#L148-L157), [membership update](https://github.com/excalidraw/excalidraw/blob/b2e81e38a6fde8b3cb5dfdf2f2fb651323ad309d/packages/element/src/frame.ts#L697-L739)). | A hybrid center-overshoot plus overlap-ratio rule is a defensible OpenPencil choice: center motion signals intent, while retained overlap prevents accidental detach at the edge. |
| Parent policy and visual sizing are separate controls. | React Flow exposes `parentId`, movement `extent`, and `expandParent` independently ([node API](https://reactflow.dev/api-reference/types/node)); its official parent-child example attaches by dragging over a group and detaches through an explicit action ([example](https://reactflow.dev/examples/grouping/parent-child-relation)). | Keep auto-expansion and explicit/pinned containment as later policy experiments, not requirements for the first fluid skin. |

## Recommended interaction contract

1. **Move the territory:** translate the frame and all descendants as one undoable
   move. The overlay may lean in the motion direction, but it returns to its
   stable resting contour after release.
2. **Move a child within the territory:** keep its membership while its center is
   near the boundary or a meaningful portion still overlaps. Show deformation
   and a quiet edge cue during the preview.
3. **Move a child into another valid territory:** the destination wins. Do not
   briefly detach to the page; tldraw explicitly carries the next drag target so
   the outgoing container can yield to it
   ([official drag-and-drop contract](https://tldraw.dev/sdk-features/drag-and-drop)).
4. **Move a child into empty canvas:** detach only after the center deliberately
   clears the edge and retained overlap falls below the chosen threshold. Commit
   the reparent on release so move plus membership change is a single undo step.
5. **Cancel or undo:** restore position, parent, z-order, and the resting contour.
   tldraw carries initial parent IDs and indices specifically so a drag can
   restore the original relationship and ordering
   ([official drag-and-drop contract](https://tldraw.dev/sdk-features/drag-and-drop)).

The current 10–24 world-pixel center overshoot and 58% retained-overlap cutoff
should be treated as a product-tuned hysteresis rule, not an industry standard.
The external evidence supports deliberate crossing and overlap-aware membership;
it does not prescribe those exact numbers.

## Recommended visual implementation

- Render the fluid surface behind the frame's children and keep the title in a
  separate zoom-stable overlay. This preserves a flat readable seam while the
  lower boundary can bend without distorting text.
- Use four independent horizontal and vertical corner radii for the resting and
  drag contours. CSS defines each corner as a quarter ellipse and proportionally
  reduces radii if adjacent curves would overlap
  ([CSS Backgrounds and Borders](https://www.w3.org/TR/css-backgrounds-3/#border-radius)).
  Compute radii from frame width and height, then clamp them before the browser's
  own overlap correction so very small and very wide frames remain intentional.
- Update deformation from presented drag geometry only, and transition the inset,
  radii, border, and fill back to rest. CSS Transitions are explicitly designed
  to interpolate computed values after a property changes
  ([CSS Transitions](https://www.w3.org/TR/css-transitions-1/#transitions)). A short
  ease-out is preferable here to a bouncy spring because membership feedback
  should settle faster than the user's next action.
- Pair `backdrop-filter` with a partially transparent fill; the Filter Effects
  specification notes that the filtered backdrop is not visible unless some of
  the element is semi-transparent
  ([Filter Effects Level 2](https://drafts.csswg.org/filter-effects-2/#BackdropFilterProperty)).
  Keep blur and saturation restrained so content remains the highest-contrast
  layer.
- Do not introduce SVG paths, metaballs, or a physics dependency yet. Elliptical
  radii plus bounded edge insets already provide responsive asymmetry, use the
  browser's box painting and hit-free overlay, and leave scene geometry unchanged.

## Adopted now vs. future experiments

| Adopted now | Future experiment |
| --- | --- |
| Existing frame remains the hierarchy and movement owner. | Optional `Fit territory to content`, analogous to tldraw's frame helper ([official docs](https://tldraw.dev/sdk-features/frame-shape)). |
| Fluid app overlay replaces only the frame's native paint. | Optional locked/pinned child types that cannot leave a project, a policy tldraw exposes through `canRemoveChildrenOfType` ([official docs](https://tldraw.dev/sdk-features/drag-and-drop)). |
| Flat project-name seam is separate from the deforming surface. | Explicit detach affordance or modifier for users who want deterministic removal, similar in intent to React Flow's explicit detach action ([official example](https://reactflow.dev/examples/grouping/parent-child-relation)). |
| Deform only while the frame or a direct child has presented motion. | Parent auto-expansion near an edge, comparable to React Flow's `expandParent` ([node API](https://reactflow.dev/api-reference/types/node)). |
| Destination frame wins; empty-canvas release uses deliberate detach hysteresis. | Velocity-aware tension after the fixed threshold is validated with real documents. |
| Reparent and position settle as one undoable gesture. | Nested project territories after front-to-back destination precedence and group-drag cases have dedicated tests. |

## Validation cases worth keeping

- Small child, large child, and grouped selection crossing each edge.
- Child crossing directly from one project territory to another overlapping one.
- Frame and child selected together, which Excalidraw intentionally treats
  differently from dragging only the child
  ([official source](https://github.com/excalidraw/excalidraw/blob/b2e81e38a6fde8b3cb5dfdf2f2fb651323ad309d/packages/element/src/frame.ts#L790-L858)).
- Undo after detach and after destination reparent, including z-order restoration.
- Very small, very wide, and very tall frames at low and high zoom.
- Reduced-motion mode: settle without the 150ms contour transition while keeping
  the acceptance/detach state legible.

