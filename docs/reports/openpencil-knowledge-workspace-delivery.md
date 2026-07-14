# OpenPencil knowledge workspace delivery

Date: 2026-07-12  
Status: implemented and validated in the live OpenPencil checkout

## Outcome

OpenPencil now has one typed knowledge-workspace foundation that can represent writing, Collections and Saved Views, canvas objects, graphs, design artifacts, review objects, and safely embedded real application states. The same stable object can be projected into Canvas, Document, Graph/Atlas, and Review views without creating disconnected copies.

The implementation is installed in:

`/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base`

## Product implementation

- `src/app/workspace` — typed objects, operations, revisions, idempotency receipts, queries, backlinks, relations, serialization, persistence contracts, and one-runtime registry safety.
- `src/app/workspace-ui` — native view projection, scene-backed persistence, insert actions, object actions, runtime activation, and focused controller composition.
- `src/components/workspace` — view switcher, typed insert menu, object inspector, and truthful runtime/review status.
- Existing Pages, Design, and Toolbar surfaces expose the workspace without a detached dashboard.
- `packages/mcp` and the existing automation bridge expose typed query and mutation semantics through the existing OpenPencil MCP server.

## MCP decision

No second MCP server is needed. Stock scene-graph tools remain appropriate for ordinary board drawing, analysis, and export. The existing semantic service now adds:

- `get_openpencil_context` workspace identity, revision, view, selection, runtime owner, and preview health
- `query_workspace_items` paginated search, filters, backlinks, relations, and changed-revision queries
- `mutate_workspace_graph` typed knowledge-mutation batches with dry-run, optimistic revision, and idempotency requirements

The live MCP smoke test confirmed all three tools are registered and callable. A dry-run typed mutation returned workspace scope without changing revision.

## Skill system

Five canonical packages are validated and synchronized with the installed Codex skill directory:

- `openpencil-agent-bridge`
- `openpencil-design-director`
- `openpencil-edit-versions`
- `openpencil-flow-states`
- `openpencil-knowledge-canvas`

The Design Director package owns reference conditioning, view archetype choice, screenshot critique, and rejection of visually weak output. The other skills keep ownership of agent safety, flow states, version lifecycle, and typed mixed-content organization.

## Validation

- Type-aware project lint: 36 feature files, zero warnings or errors.
- Focused Bun tests: 20 passed, 0 failed, 83 expectations.
- Live semantic smoke: context, query, and typed dry-run mutation passed.
- Visual self-test: second-pass board rendered through the live app/MCP, exported, and inspected.
- Full Vue type-check: no knowledge-workspace errors; unrelated existing `dom-css`, live asset, embed, and overlay errors remain in the checkout.

## Visual evidence

Primary export:

`/Users/omar/Documents/Open Pencil/artifacts/openpencil-workflows/06-knowledge-canvas-self-test.png`

Board location in OpenPencil:

- Page: `Dental Chart` (`0:3`)
- Root frame: `Dental Chart Workflow — Polished` (`0:4`)

The board demonstrates a horizontal application journey, vertical edit branches, a mixed Document/Collection/Live App knowledge area, and an explicit review-to-change-set handoff.

## Follow-on depth

The safety and identity foundation is complete. Natural next product increments are richer inline block/database editing, geometry write-back after direct canvas movement, stronger automatic graph layout, and source-backed capture generation inside native projections.
