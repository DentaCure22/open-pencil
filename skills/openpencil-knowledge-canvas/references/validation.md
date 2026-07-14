# Knowledge canvas validation matrix

Run the checks relevant to the objects and views used. Do not claim capabilities that were not exercised.

## Object and persistence checks

- Create nested document blocks; reorder them; verify reading order and undo.
- Create a Collection with Records and two Saved Views; verify properties, filters, sorts, and Record identity remain shared.
- Place the same block in Document and Canvas views; edit content once; verify both projections update.
- Move the Canvas projection; verify Document order does not change implicitly.
- Create typed graph edges; verify labels, direction, and relationships survive reload.
- Create a true alternate through `$openpencil-edit-versions`; verify parent and independent revision.
- Switch pages/views and reload; verify stable IDs, geometry, relationships, and content persist.
- Rename a property and relation; verify stable IDs and backlinks remain intact.

## Graph checks

- Verify the selected layout matches the declared graph type.
- Walk each directed edge and confirm its source, target, label, and condition.
- Detect connector crossings, cycles where unexpected, orphan nodes, and ambiguous unlabeled edges.
- Confirm the graph remains readable at fit-to-board and detail zoom.

## Live App Block checks

- Activate one block and verify route, scenario, viewport, source revision, and container identity.
- Activate a second block and verify the shared runtime transfers while the first becomes a truthful capture/preview.
- Reopen the first block and verify its isolated patch replay and selected container.
- Simulate runtime unavailable/auth required; verify the block remains identified and is not presented as live.
- Verify inactive, stale, illustrative, and live states have distinct labels.
- Verify board edits and preview edits do not change production source.

## Review and source-safety checks

- Confirm comments and decisions attach to exact object IDs and revisions.
- Confirm moving an object into a visual zone does not change lifecycle status.
- Confirm Preferred does not imply Approved or Applied.
- Confirm source patching requires owner/source evidence and returns a proposed diff.
- Confirm apply/merge remains unavailable without explicit approval and successful verification.

## Visual QA

1. Inspect at fit-to-board zoom.
2. Inspect at readable-detail zoom.
3. Run overlap, color, typography, and spacing analysis when available.
4. Export the primary composition.
5. Inspect for clipping, truncation, weak contrast, poor connector routing, inconsistent geometry, vague placeholders, and accidental dead space.
6. Revise at least once after inspection.

Reject a substantial board that is only generic rectangles, unlabeled screenshots, disconnected prose cards, or a visually polished mock that falsely implies a healthy live application.
