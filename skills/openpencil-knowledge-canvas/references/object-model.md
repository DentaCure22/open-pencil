# Knowledge canvas object model

The workspace is a typed object graph with multiple views. Canvas geometry is a projection, not the object's identity or lifecycle.

## Shared record

Every durable object should record:

- stable ID and object type
- document, page, workspace, and optional collection
- parent, children, and ordered document position when relevant
- canvas geometry and group when relevant
- typed relationships and backlinks
- base revision, current revision, creator, and timestamps
- status, permissions, comments, and provenance
- view visibility, collapsed state, and view-specific presentation
- source, route, scenario, capture, or change-set references when relevant

Mutations should use expected revisions, idempotency keys, native undo/history, and dry-run summaries for destructive or lifecycle-changing work.

## Primary object types

### Document block

Kinds: heading, paragraph, bulleted list, numbered list, task, quote, callout, code, divider, table, image, file, and embed.

Document blocks retain meaningful reading order independently of their canvas coordinates. Nested blocks keep parent and ordered-child identity.

### Collection, Record, and Saved View

A Collection provides Notion-like structured information without turning every workspace object into a database row. A Record has a stable ID, typed properties, relations, and a content body made from Document Blocks.

Saved Views project the same Collection through table, board, list, gallery, calendar, graph, or canvas layouts. Each view stores filters, sorts, grouping, visible properties, and view-specific geometry without duplicating records.

Property and relation IDs remain stable when labels change. Moving a card between visual board columns changes a property only when that behavior is explicit and previewed.

### Canvas object

Kinds: ink, shape, frame, sticky note, annotation, connector, spatial group, and evidence marker.

Canvas objects may be intentionally spatial without joining the semantic graph. A connector becomes a Graph Edge only when it has a declared relationship type.

### Graph Node and Graph Edge

A Graph Node records graph kind, node role, label, domain data, and layout constraints. A Graph Edge records source, target, direction, relationship type, label, and optional confidence or condition.

Do not infer semantic relationships solely from proximity or an unlabeled decorative line.

### Design artifact

Kinds: component, instance, pattern, token, asset, mockup, responsive state, and design annotation.

Record source ownership and whether an edit is local, a preview branch, a reusable asset proposal, or a proposed source change.

### Live App Block

A Live App Block represents a real route and scenario, not an iframe-shaped rectangle. Its contract is defined in [live-app-block.md](live-app-block.md).

### Review object

Kinds: comment, question, decision, comparison, approval, status marker, acceptance criterion, and change-set reference.

Review state changes explicitly. Moving an object into a visual lane does not silently approve, archive, or submit it.

## Cross-view identity

The same stable object may appear in multiple views through view references. Editing its content updates all projections; changing one projection's geometry does not reorder the document unless the user performs an explicit reorder operation.

Examples:

- A paragraph in Document view may appear as a note card in Canvas view.
- A Live App Block may appear as a screen node in Graph/Atlas and as evidence in Review.
- A design component may appear inside a mockup and in an Assets collection without being duplicated.
- A Collection Record may appear in a table, task board, and canvas while keeping one property and relation record.

When a true independent alternative is required, create a version with an explicit parent and use `$openpencil-edit-versions`.
