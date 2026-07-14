# Semantic tool contract

## Shared mutation envelope

Every semantic mutation should accept:

- `document_id`
- `page_id`
- `expected_revision`
- `idempotency_key`
- `dry_run`

Every result should return:

- affected stable IDs
- new revision
- undo/history entry ID
- warnings and conflicts
- preview/source scope

## Key distinction

`Scene graph changed` is not the same as `live app preview changed`, and neither is the same as `source changed`.

Return these scopes explicitly:

- `board`
- `live-preview`
- `workspace-metadata`
- `proposed-source-patch`
- `source`

## Preconditions

- `mutate_workspace_graph(operation=transition, status=Approved)` requires review-ready status.
- `create_change_set` requires selected approved/preferred objects.
- `propose_source_patch` requires owner/source evidence or returns `source_target_unresolved`.
- Apply/Merge requires explicit approval plus successful verification evidence.
- A manual HTML-board source mapping is only declared sidecar metadata until repository resolution verifies it. A built-in live component can carry repository-verified evidence only when its registry descriptor, exact source file/export, renderer fixture, route, selector, and canonical wrapper all match. Use one shared exact-match contract across the registered catalog; neither form is a `propose_source_patch` result.
- An HTML-board implementation request is an authorization packet, not an Apply command. It must preserve exact board revision and source targets, report `sourceUnchanged: true`, and require a visible diff plus explicit approval.

## MCP decision

Keep one OpenPencil MCP server. Register semantic tools beside the existing `ALL_TOOLS` scene-graph registrations, route them through the same document/page target envelope, and back them with application services rather than direct store mutation. If the same command API must also serve in-app agents, implement the service first and expose it through both MCP and the app.

Schema v6 already implements source mapping and implementation-request generation as direct application services. No new MCP is needed for the HTML-first pivot today; later MCP exposure should wrap these services rather than fork their lifecycle or receipt semantics.

HTML-board creation, typed component-property edits, and controlled-slot component insertion use direct application services today. The app service owns canonical HTML/CSS mutation, stable component-instance IDs, slot allowlist enforcement, revision history, protected-board checks, and undo. Future MCP tools should call that same service instead of writing iframe DOM or plugin data directly, and should return a refusal for ambiguous instances, unknown registry entries, or components the selected slot does not accept.

Connected-workflow framing is also an application service. `Fit flow` walks the exact HTML-board origin relationships in both directions, temporarily frames the connected boards with panel-aware viewport insets, then restores the user's single-board selection. It changes only camera and selection state, not HTML-board revisions or source. No separate MCP is required; a future remote focus command should wrap this service as a non-document mutation.

Repository-backed live component insertion also stays in the direct app service. The sandbox bridge reports only exact internally registered renderer routes and exact placeholder rectangles; OpenPencil renders the real application component in a trusted cross-origin overlay while the user-authored HTML iframe remains without same-origin access. Generate the registry from a curated fixture input validated against the current repository inventory, source file, exact exported symbol, and Storybook evidence; inventory membership by itself is not renderer authorization. The current version-8 generated catalog covers Accordion, Alert, Avatar, Badge, Button, Calendar, Card, Checkbox, DropdownMenu, Input, Progress, RadioGroup, Select, Separator, Slider, Switch, Table, Tabs, Textarea, and Tooltip through one common path. The service attaches repository-verified source evidence only to the next exact Preferred revision. This is sufficient for the current slice; it does not justify a second MCP server.
