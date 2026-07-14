# OpenPencil design-agent MCP recommendations

Date: 2026-07-12

## Is an MCP needed?

Yes—for live OpenPencil work, but a second MCP is not needed. The stock OpenPencil server already owns document identity, scene-graph mutation, viewport control, export, and verification. The skill should own visual judgment and must use the existing targeting contract correctly. A static image generator can make a mockup, but it cannot safely branch a real application state, preserve edit versions, or leave a reviewable board in the live editor.

The stock MCP was already enough to prove the core loop:

- inspect pages and nodes
- render reusable JSX into scene-graph frames
- find and replace named views
- hide a preserved baseline
- select nodes and run structural analyses
- export raster previews

The revamp also already exposes `list_documents` and accepts `document_id` plus `page_id` on stock tool calls. The corrected test bound every call to `tab-1` / `0:2`, rendered the board in the visible client, applied a real Smylr capture, and exported the intended root. This removes the need for a separate identity MCP; the bridge skill must enforce explicit targeting.

## What broke during the self-test

1. **Multiple live clients were ambiguous when scripts omitted target fields.** Untargeted calls landed in a different connected OpenPencil document. The current stock API fixes this when the agent calls `list_documents` and passes `document_id` and `page_id` on every later operation.
2. **Page lifecycle was not visibly synchronized.** `create_page` and `switch_page` succeeded in the automation graph, but the new page did not appear in the workspace navigator. Rendering into the existing visible page was reliable.
3. **Viewport focus was missing.** `select_nodes` changed graph selection but did not reliably focus the visible canvas. The layer tree plus `Shift+2` was required.
4. **Raster export transport was easy to misuse.** The PNG arrived as an MCP image content block, not the parsed JSON payload expected by the first client implementation.
5. **Image-filled frames with overlay children produced black occlusion blocks at reduced zoom and in CanvasKit export.** Moving the image fill to a leaf rectangle and keeping annotations as sibling overlays fixed the tested board.
6. **Geometry analysis over-reported text collisions.** Small flex-contained text nodes retained default 100×100 geometry, producing hundreds of overlap warnings that were not visible in focused screenshots.

## Recommended revamp tools

### P0 — required stock-MCP usage now

- Call `list_documents` before every mutation session.
- Bind every subsequent tool call to the chosen `document_id` and `page_id`.
- Use returned root IDs for subtree inspection and export instead of untargeted name searches.
- Reject ambiguous targeting rather than falling back to the active client.

### P0 — remaining ergonomic improvements

- `get_live_context`: extend the existing document target with workspace ID, container ID, route, connection count, and mutation owner.
- `claim_live_context`: optionally bind a whole session so callers do not have to repeat target fields and reject calls when the bound client disconnects.
- `focus_nodes`: select nodes and fit the visible camera to them in one verified operation.
- `create_workspace_view`: create/rename/switch a page or section and confirm it is visible in the workspace navigator and persisted.
- `capture_view`: capture the actual visible editor viewport or a named root at review zoom, with renderer status.
- `export_image`: always return the same structured metadata plus an image content block or a confirmed scoped path.

### P1 — needed for higher-quality design iteration

- `render_transaction`: create or replace several named roots atomically and return stable IDs, positions, warnings, and rollback information.
- `analyze_subtree`: run overlaps, contrast, typography, and spacing for specific roots with measured text bounds and clip awareness.
- `get_design_context`: expose product tokens, reusable components, native chrome measurements, and nearby screen references.
- `compare_views`: produce a source-aware diff between production and up to two draft versions.

### P2 — useful for skill evaluation

- `record_design_eval`: attach rubric scores, screenshot evidence, iteration IDs, and feedback to a view version.
- `list_eval_scenarios`: expose train, validation, and held-out scenarios without leaking held-out answers into the design pass.

## Recommended division of responsibility

| Agent skill | MCP |
| --- | --- |
| Chooses Overview, Focus, Compare, Knowledge, or Review | Resolves the exact live document and page |
| Defines hierarchy, density, type, color, and composition | Creates, updates, selects, focuses, and exports nodes |
| Rejects weak screenshots and revises | Returns deterministic screenshots and scene diagnostics |
| Preserves live/draft/approved/source meaning | Enforces container identity, version isolation, and safe handoff |

The important design decision is to keep taste and critique in the reusable skill while making the MCP deterministic and document-aware. Adding “make it pretty” to the MCP would hide failures; adding identity, focus, capture, and verification tools would make the skill reliable.

## Critique-workspace rerun findings — 2026-07-13

The rebuilt Dental Chart critique workspace confirmed four additional reliability requirements for the revamped agent loop:

1. **Resolve the current local token at runtime.** The browser-spawned MCP token changes across restarts. Builders should read the attached token from the local health contract instead of embedding a development token.
2. **Make revision visibility explicit.** Replacing or revising a named root can inherit a hidden state from an older candidate. A revision transaction should return the new root and guarantee it is visible, or expose a dedicated `promote_candidate_view` operation that hides prior candidates and shows the selected one atomically.
3. **Expose renderer readiness.** Repeated image fills can be present in the scene graph before CanvasKit is ready to export them, causing transient black tiles. `capture_view` or `export_image` should wait for decoded image resources and return a renderer-ready receipt instead of forcing the caller to use a timing delay.
4. **Verify the actual visible camera.** `viewport_zoom_to_fit` changed graph state but did not consistently update the attached browser view. `focus_nodes` should acknowledge the live viewport, report the resulting zoom and bounds, and fail when UI synchronization does not occur.

These do not justify a second MCP. They refine the existing stock MCP around session identity, atomic candidate promotion, resource readiness, and live-camera verification—the deterministic mechanics the design skill needs in order to iterate safely.
