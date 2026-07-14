# Views and layout conventions

Views are projections over shared typed objects. Choose one primary view per task and keep secondary views purposeful.

## Document view

Use for sequential reading, specifications, briefs, research, decisions, and meeting notes.

- Preserve heading hierarchy and ordered block structure.
- Keep line length readable and use tables only for repeated-field comparison.
- Embed diagrams or live states beside the text that explains them.
- Use backlinks and source references instead of duplicating background material.

## Canvas view

Use for spatial thinking, mixed media, brainstorming, workshops, comparisons, and design exploration.

- Establish zones or groups only when they communicate ownership or stage.
- Use repeated geometry and consistent spacing within each family of objects.
- Avoid turning every paragraph into a card or every group into a dashboard panel.
- Keep freeform content available without allowing it to obscure primary reading paths.

## Collection views

Use table, board, list, gallery, or calendar projections for repeated records with shared properties.

- Keep one Record identity across all saved views.
- Store filters, sorts, grouping, and visible properties on the Saved View.
- Do not infer a lifecycle change from spatial movement unless the view explicitly maps position to a property.
- Use Canvas or Graph view instead when relationships and spatial reasoning matter more than repeated fields.

## Graph or Atlas view

Use for relationships, flows, dependencies, architecture, entities, decisions, and discovered application states.

### Flowchart or journey

- Primary direction: left to right.
- Exceptions and alternate versions branch vertically.
- Use short transition labels only where they add information.
- Keep connectors orthogonal and avoid crossings.

### Mind map or concept map

- Use radial or clustered placement around one clear central concept.
- Limit hierarchy depth visible at once; collapse secondary clusters when needed.
- Label non-obvious relationships; color clusters, not individual nodes randomly.

### Architecture map

- Group by system boundary, trust boundary, layer, or owner.
- Distinguish data flow, control flow, and dependency when more than one is present.
- Keep external actors and storage visibly distinct from internal services.

### Dependency graph

- Use a directed acyclic layout where the domain permits it.
- Surface cycles, blocked nodes, and critical path explicitly.
- Do not imply time order when the edge only means ownership or reference.

### Entity relationship diagram

- Use consistent entity geometry, attribute hierarchy, key markers, and cardinality.
- Route relationships orthogonally and keep labels close to their edges.

### Decision tree

- Use top-down direction, mutually exclusive branch labels, and visible terminal outcomes.
- Separate evidence from the decision edge so annotations do not resemble choices.

### App Atlas

- Use real source-backed screen or state captures when possible.
- Record route, scenario, discovery source, confidence, and review status.
- Keep the global Atlas separate from focused journey boards: Atlas shows the territory; a flow board shows one path through it.

## Review view

Use for comparison, feedback, decisions, version status, and change-set readiness.

- Keep production/reference visually stable.
- Make differences visible in the artifact, not only in explanatory copy.
- Attach comments and decisions to exact objects and revisions.
- Treat Preferred, Approved, Verified, and Applied as separate states.

## Visual system

- Use native product tokens before inventing a palette.
- Use at least three type levels for a substantial board.
- Keep production neutral; reserve blue for active/flow, violet for drafts, amber for review/loading, green for approved/success, and gray for archived.
- Use one large outer/group rhythm, one medium relationship rhythm, and one compact internal rhythm.
- Inspect both fit-to-board composition and readable-detail presentation.
