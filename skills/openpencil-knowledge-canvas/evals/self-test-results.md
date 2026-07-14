# Self-test results

Date: 2026-07-12  
Scope: static package validation and scenario routing  
Runtime note: a local OpenPencil MCP board service was exercised after the static checks. See `visual-self-test.md` for the first export, detected dead-space issue, prepared revision, and pending second-pass approval.

## Package checks

- PASS — `SKILL.md` frontmatter parses as YAML and declares the expected name and trigger description.
- PASS — `agents/openai.yaml` parses and provides display name, short description, and default prompt.
- PASS — all links from `SKILL.md` resolve to package references.
- PASS — the main workflow explicitly coordinates `openpencil-agent-bridge`, `openpencil-flow-states`, and `openpencil-edit-versions` instead of duplicating them.
- PASS — object, view, live-runtime, visual QA, and source-safety contracts are represented.

## Scenario routing

### Product brief plus live route

PASS. The skill selects a Document or Canvas primary view, uses shared typed objects, requires route/scenario/runtime truth for the Live App Block, routes preview work through the bridge, and keeps annotations separate from source changes.

### Architecture graph

PASS. The skill chooses architecture boundaries and labeled interfaces rather than a generic flowchart. The semantic contract distinguishes board, live-preview, workspace metadata, proposed source patch, and source.

### Automatically explored App Atlas

PASS WITH CAPABILITY GAP. The skill keeps discovered states proposed until review and separates a global Atlas from focused flows. Actual exploration still needs the optional discovery operations documented in `references/semantic-capabilities.md`.

### Notion-like research workspace

PASS. The skill uses one typed object graph, Document/Canvas/Graph projections, Collections with shared Records and Saved Views, and independent document order versus canvas geometry.

### Runtime failure

PASS. The skill forbids a live claim, preserves route/scenario identity, and requires `Captured`, `Stale`, `Auth required`, `Unavailable`, or `Illustrative preview` labels as appropriate.

### Production promotion request

PASS. Preferred, Approved, Verified, and Applied remain separate; source work requires owner/source evidence, proposed diff, verification, and explicit apply/merge authorization.

## Remaining integration gate

Before calling the skill fully product-validated, rerun the prepared second visual pass, inspect its exported image, and exercise the remaining P0 persistence and real-runtime checks in `references/validation.md` against the OpenPencil semantic service.
