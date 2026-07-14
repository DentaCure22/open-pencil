# OpenPencil HTML-first design pivot

## Product decision

OpenPencil will treat a versioned HTML/CSS/JS document as the primary visual design artifact. The browser-rendered surface is the design, not an import preview that must be converted into Figma-style auto-layout nodes.

Native canvas objects remain essential, but their job changes: they own spatial composition, selection, page organization, flow edges, comments, edit versions, review state, evidence, and source handoff.

## Research-derived boundaries

- Separate model and view. GrapesJS keeps a component/project model as the source of truth and uses a separate canvas view. OpenPencil should likewise persist a structured HTML-board document and render it in a browser surface.
- Isolate the runtime. GrapesJS uses an iframe canvas. OpenPencil uses a sandboxed iframe so interactive design code cannot control the editor host.
- Treat code as a first-class component medium. Framer renders code components on canvas, in preview, and in published output, and surrounds them with property controls and explicit render targets.
- Make responsive CSS native. Webstudio exposes full CSS, attributes, custom breakpoints, and CSS pasting rather than flattening web layout into drawing primitives.
- Keep product systems constrained. Builder's components-only mode and token controls show how a visual editor can use real design-system components without giving every user unconstrained styling.

## OpenPencil architecture

1. `HtmlBoardDocument` is a versioned structured model containing separate HTML, CSS, JavaScript, runtime policy, viewport metadata, workflow state, and optional input-artifact identity.
2. `HtmlBoardEmbeds` renders that model inside a sandboxed iframe positioned by the native scene frame.
3. The HTML inspector edits the source model and provides responsive viewport controls.
4. Design mode selects and arranges the board; Inspect mode identifies DOM elements and reads computed styles; Interact mode sends normal pointer input into the real browser runtime.
5. The DOM bridge uses a dedicated `MessageChannel` per iframe load while the iframe remains sandboxed without same-origin access. A validated `postMessage` path remains only as a compatibility fallback.
6. Visual property and token controls write undoable CSS overrides to the canonical document. The current viewport determines base, tablet-only, or phone-only scope.
7. Flow states and edit versions reference exact HTML-board revisions. Production remains protected; edit branches go down, flow states go right, and every creation is undoable.
8. Independent HTML components declare design identity with `data-openpencil-component`, stable per-instance `data-openpencil-component-id` values, variants, and typed metadata attributes. Bound text/select/boolean controls update the canonical HTML, create a revision, and remain undoable; a stable instance ID may disambiguate repeated component types, while ambiguous type-only edits still refuse mutation. Controlled slots declare a stable name, label, and component allowlist; the built-in board registry can insert an accepted component into canonical HTML/CSS with one undoable revision. Schema v6 attaches explicit repository-relative source targets to the exact Preferred revision as sidecar metadata. Manual mappings remain declared. A generated catalog now derives 20 curated live fixtures—Accordion, Alert, Avatar, Badge, Button, Calendar, Card, Checkbox, DropdownMenu, Input, Progress, RadioGroup, Select, Separator, Slider, Switch, Table, Tabs, Textarea, and Tooltip—from the checked-in Smylr component inventory. Generation refuses stale inventory, missing source files, missing exact exports, or uncovered Storybook evidence, then supplies one version-8 registry/renderer contract to both applications. Embedded evidence uses a deterministic light theme so the same component cannot become an unreadable dark block when the host follows a dark system preference. Canonical HTML placeholders stay inside the isolated board while OpenPencil positions tightly allowlisted application iframes over the exact placeholder rectangles for real CSS and interaction; only an exact catalog match yields a repository-verified binding on the next Preferred revision. Popover fixtures may receive a larger trusted interaction viewport without moving their canonical placeholder.
9. Mermaid and other generators may provide non-executable artifact metadata. OpenPencil preserves `{ artifactId, sourceHash, source, renderer, editingModel }`, keeps a stable board ID when that artifact regenerates, and advances the board revision.
10. Revision comments and source targets live in sidecar plugin data so discussion and handoff preparation do not manufacture design revisions. Preferred, proposal-only change sets, approval, workspace readiness, and source verification each retain an exact `{ boardId, revision, schemaVersion }` source reference and a truthful source receipt.
11. A workspace-checked change set may export an implementation request containing canonical HTML/CSS/JS, exact source targets, acceptance criteria, and the input-artifact identity. The packet explicitly says source is unchanged and requires repository resolution, a visible diff, explicit authorization, focused tests, and real-app verification. It is not an executor.

## Staged rewrite

- Slice 1 — live HTML primitive: sandboxed render, Design/Interact toggle, source editing. Implemented.
- Slice 2 — first-class shell: HTML is the default inspector, the empty canvas has a centered one-click live-board start surface, the Insert menu exposes HTML as a canonical design medium, and the structured document schema and responsive presets are implemented.
- Slice 3 — DOM inspect: hover/select overlay, stable element path, computed-style panel, dedicated mode bridge, and selection refresh across viewports. Implemented.
- Slice 4 — component system: canonical JavaScript, sandboxed interactions, CSS-token controls, responsive visual CSS controls, declarative component identity, stable per-instance IDs, editable typed component properties, a built-in board-component registry, and allowlisted controlled-slot insertion are implemented. The repository-backed contract is generated from a curated 20-fixture intersection of the current 754-component Smylr inventory: Accordion, Alert, Avatar, Badge, Button, Calendar, Card, Checkbox, DropdownMenu, Input, Progress, RadioGroup, Select, Separator, Slider, Switch, Table, Tabs, Textarea, and Tooltip. Source/catalog tests prove inventory freshness, every file/export, Storybook coverage, renderer fixture, and overlay profile; the HTML sandbox reports exact placeholder rectangles from an exact route allowlist; OpenPencil owns the trusted overlays; and exact matching creates repository-verified bindings at Preferred. Larger controlled-slot catalogs use one compact chooser rather than a wall of buttons. Further catalog growth must continue through the same generated, source-verified path rather than introducing one-off renderer routes.
- Slice 5 — versions and flows: revision snapshots, exact refs, safe vertical branches, horizontal flow states, board guide, exact-revision comments, explicit Review and Preferred decisions, proposal-only change sets, approval, workspace readiness, structured handoff receipts, undo/redo, and a connected-workflow `Fit flow` action that frames every related board between the side panels are implemented.
- Slice 6 — production handoff: artifact-to-board identity, exact-revision source mappings, proposal-only change sets, approval, workspace readiness, strict verification evidence, truthful receipts, and a copyable implementation-request packet are implemented. Repository resolution and an authorized source-application executor remain external; OpenPencil deliberately exposes no casual Apply action.

## Non-goals

- Rebuilding HTML as thousands of drawing nodes.
- Claiming an HTML design changed production source.
- Running unsandboxed design scripts in the editor host.
- Treating raw HTML strings alone as sufficient persistence; editor identity and history require a structured document envelope.
