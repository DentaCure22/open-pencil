# OpenPencil skill and contract organization

Status: skill family and native knowledge-workspace vertical slice implemented  
Date: 2026-07-12

## Canonical skill source

Use `/Users/omar/Documents/Open Pencil/skills` as the canonical editable source for OpenPencil-specific skills in this umbrella workspace.

Treat these as projections, not separately maintained sources:

- `~/.codex/skills/openpencil-*` — installed personal skills.
- project-local `.agents/skills/openpencil-*` — optional discovery projection when a specific implementation checkout requires it.

The canonical source packages are:

- `skills/openpencil-design-director`
- `skills/openpencil-knowledge-canvas`
- `skills/openpencil-agent-bridge`
- `skills/openpencil-edit-versions`
- `skills/openpencil-flow-states`

Install every projection from canonical source. Do not hand-edit both locations.

## Product-code boundary

The current implementation lives outside this umbrella repo at:

`/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base`

The implementation now includes a neutral `src/app/workspace` domain for typed objects, revisions, views, runtime activation, lifecycle, serialization, queries, and command results. Smylr-specific route/container behavior remains behind the automation and live-runtime adapters.

The native UI lives in `src/app/workspace-ui` with small controllers for view projection, persistence, insertion, runtime ownership, and object actions. It exposes Canvas, Document, Graph/Atlas, and Review projections without duplicating the underlying object identity.

## Diagram routing boundary

- Use native OpenPencil objects for board content, durable knowledge objects, real application states, versions, reviews, live embeds, and cross-view identity.
- Use Mermaid or another static diagram format for disposable explanation/export only.
- Never let a static diagram claim live route identity or production state.

## MCP direction

Keep one OpenPencil MCP server and one underlying application service.

Reuse and extend the existing semantic commands. The first knowledge-canvas slice needs only one new general read command, `query_workspace_items`, for paginated search, backlinks, relation traversal, and metadata filters at workspace scale.

Extend:

- `get_openpencil_context` with selected typed objects, current view, runtime owner, preview health, and revision context.
- `mutate_workspace_graph` with typed blocks, Collections, Records, Saved Views, relations, and view projections.
- `activate_workspace_item` with atomic outgoing capture, shared-runtime transfer, hydration result, and truthful fallback status.

Optional Atlas discovery can later add `start_flow_discovery`, `get_flow_discovery_status`, and `review_flow_discovery` without creating a second MCP server.

## Audit disposition

The vertical slice resolves the highest-risk audit items:

- Durable workspace objects and semantic mutation envelopes now have one typed code model.
- Workspace IDs use Web Crypto.
- Revision conflicts, dry runs, idempotency receipts, lifecycle preservation, pagination, backlinks, and relation traversal are covered by focused tests.
- One shared live runtime is enforced across page workspaces and becomes Live only after a successful handshake.
- Scene-backed persistence keeps the workspace attached to the OpenPencil document.
- The existing MCP server gained knowledge query/mutation coverage; no second agent protocol was introduced.

Follow-on depth can add richer inline document/database editing, geometry write-back after manual canvas movement, stronger automatic graph layout, and source-backed screenshot capture. These are enhancements to the validated vertical slice rather than missing safety foundations.

These are implementation audit findings, not claims that the current skill package changed product source.

## Validation gate

1. Validate skill YAML and internal references.
2. Run the written routing scenarios.
3. Install from the canonical directory.
4. Exercise P0 knowledge-canvas checks against the real semantic service.
5. Create and export a mixed document/canvas/graph/live-app board.
6. Inspect at overview and detail scale and revise once.

Current validation evidence:

- 36 feature files pass type-aware project lint.
- 20 focused domain, persistence, UI, and MCP tests pass.
- Full Vue type-check introduces no knowledge-workspace errors; the checkout still has unrelated existing `dom-css`, live asset, embed, and overlay errors.
- `artifacts/openpencil-workflows/06-knowledge-canvas-self-test.png` was exported from the live local board and inspected after the second visual pass.

Run the canonical package and installation check with:

```sh
bash tools/skill-sync/sync_openpencil_skills.sh check
```

The corresponding `install` mode adds only missing skill directories and refuses to overwrite drifted installed copies.
