# Semantic capability contract

Keep one OpenPencil MCP server or equivalent in-app command service. Reuse the existing scene-graph, live-container, workspace-version, flow, comparison, and change-set capabilities.

## Existing capabilities to reuse

- `get_openpencil_context`
- `inspect_live_container`
- `edit_live_container`
- `upsert_board_guide`
- `mutate_workspace_graph`
- `activate_workspace_item`
- `compare_workspace_items`
- `create_change_set`
- `propose_source_patch`
- `verify_change_set`
- stock scene-graph render, text, shape, connector, layout, page, component, variable, analysis, export, and viewport tools

## Knowledge-workspace extensions

Prefer extending cohesive services over adding one tool per block type.

### Extend `get_openpencil_context`

Return typed object schemas, ordered document structure, current view metadata, active runtime slot, preview health, source/base revision, and small selected-object neighborhoods.

Do not use the context response as an unbounded workspace dump.

### Extend `mutate_workspace_graph`

Perform typed batch operations such as:

- upsert, reorder, nest, move, resize, group, or archive objects
- connect or disconnect typed relationships
- attach or detach an existing object from a view
- create a true version or reference without duplicating identity accidentally
- bind a Live App Block to route/scenario/source evidence
- set view metadata without changing the underlying object's lifecycle
- upsert collection schemas, records, properties, relations, and saved views

Every mutation uses document/page IDs, expected revision, idempotency key, dry run, stable IDs, native undo/history, and explicit result scope.

### Add `query_workspace_items`

Use one scoped, paginated read tool for full-text and metadata search, relation traversal, backlinks, and filters by block type, collection, tag, route, source target, status, or changed-since revision. Return stable object references and concise excerpts rather than reconstructed copies.

This is the only new general MCP tool required for the first knowledge-canvas contract. Small selected neighborhoods still come from `get_openpencil_context`; stock reads still inspect scene nodes.

## Optional discovery operations

Atlas-style exploration may later use:

- `start_flow_discovery`
- `get_flow_discovery_status`
- `review_flow_discovery`

Discovery results remain proposed until reviewed. They should record route, action, resulting state, evidence, confidence, and failure reason. Accepted results become ordinary typed workspace objects through the extended `mutate_workspace_graph` operations.

## Shared mutation envelope

Every semantic mutation accepts:

- `document_id`
- `page_id`
- `expected_revision`
- `idempotency_key`
- `dry_run`

Every result returns affected stable IDs, new revision, undo/history entry ID, warnings/conflicts, and explicit scope: `board`, `live-preview`, `workspace-metadata`, `proposed-source-patch`, or `source`.
