# Interactive HTML board surface

Use a live HTML board when exact browser layout, responsive behavior, or interaction matters more than editing every visual element as a separate scene node.

## Architecture

- HTML/CSS/JS is the visual and interaction layer inside a sandboxed iframe.
- The enclosing OpenPencil frame remains the spatial object for selection, pan, zoom, resize, duplication, comments, flow edges, and version identity.
- Store HTML, CSS, and JavaScript as separate canonical fields with the frame so the Code panel and agents can revise the board without a lossy DOM-to-auto-layout conversion.
- Treat `{ boardId, revision, schemaVersion }` as the stable HTML-board reference. Source, responsive style, token, and viewport changes create a new revision and retain the previous HTML/CSS/JS/viewport snapshot; no-op edits must not manufacture revisions.
- Preserve generator identity as optional, non-executable artifact metadata. For Mermaid handoffs, retain `artifactId`, `sourceHash`, full source, renderer, and editing model; regeneration with the same artifact ID updates the same board and creates a revision.
- Use a dedicated `MessageChannel` per iframe load for editor-to-runtime inspection data; retain source-window validation only as a compatibility fallback.
- Treat Inspect as a deliberate sandbox runtime boundary. Design and Interact share the live runtime; entering Inspect may recreate the isolated runtime so the mode is guaranteed before pointer input.
- Keep production source, live application containers, HTML design boards, and native scene nodes explicitly labeled. An HTML board is a design artifact, not proof of a production source change.
- Keep the inspector progressively disclosed. The rendered HTML screen stays dominant; workflow actions and summaries remain compact, and raw HTML/CSS/JS is collapsed outside active Draft editing.

## Choose the rendering path

- Live HTML board: interactive prototypes, exact CSS spacing, responsive designs, or animation.
- Native HTML-to-layers import: individual text/frame editing is required and small browser-to-auto-layout differences are acceptable.
- Native scene nodes: diagrams, connectors, comments, annotations, flow identity, version metadata, and lightweight guides.
- Live app container: the real production application must be inspected or previewed.

## Quality gate

- Set an explicit board viewport with `data-openpencil-width` and `data-openpencil-height` on the root.
- Use one outer rhythm, one relationship rhythm, and one compact internal rhythm.
- Verify Design, Inspect, and Interact modes.
- In Inspect mode, click a meaningful element and confirm its selector, dimensions, and computed style summary reach the editor without same-origin access.
- Visual property edits must write back to canonical CSS with undo/history. Desktop edits use the base cascade; Tablet and Phone edits use explicit scoped media-query blocks.
- Prefer CSS custom properties for reusable design tokens and expose them through a compact, collapsed-by-default token editor. A token update must remain canonical CSS and create an undoable revision.
- Use `data-openpencil-component`, `data-openpencil-variant`, and `data-openpencil-prop-*` for declarative component identity inside independent HTML work. Treat these as design metadata until a real production component/source binding is attached.
- Give every editable component instance a stable `data-openpencil-component-id`. Repeated component types may be edited only through a unique instance ID; type-only mutations must still refuse ambiguous matches.
- Declare controlled insertion points with `data-openpencil-slot`, a short `data-openpencil-slot-label`, and an explicit comma-separated `data-openpencil-slot-accepts` allowlist. Never insert a component the slot did not declare.
- Insert registered board components through the canonical HTML-board service. The service owns the next stable instance ID, canonical HTML insertion, once-only registered CSS block, revision creation, protected-state checks, and undo. Do not mutate the rendered iframe DOM.
- A live production component must remain the real application renderer, not a hand-reconstructed lookalike. Keep a stable placeholder in canonical HTML, then place the tightly routed application iframe in an OpenPencil-owned overlay at the placeholder's exact board-local rectangle. The user-authored HTML sandbox must remain without same-origin access; only the verified cross-origin application iframe may use its own scripts and same-origin runtime. Resolve renderer routes from the internal registry rather than a permissive slug pattern. Preserve registry ID, repository, repository-relative file, exported symbol, selector, renderer route, overlay profile, and stable instance ID. Build the registry from a checked-in generated catalog whose curated fixture input is validated against the current component inventory, source file, exact export, and Storybook evidence. Inventory membership alone does not make a component live or repository-verified. The current version-8 contract contains 20 source-backed fixtures: Accordion, Alert, Avatar, Badge, Button, Calendar, Card, Checkbox, DropdownMenu, Input, Progress, RadioGroup, Select, Separator, Slider, Switch, Table, Tabs, Textarea, and Tooltip. Embedded fixtures must render with a deterministic light theme so a dark host preference cannot turn the trusted overlays into unreadable black blocks. In Inspect, select the placeholder; in Interact, enable the trusted overlay. A popover-based fixture may expand its trusted interaction viewport downward while keeping the canonical placeholder fixed.
- When a controlled slot is selected, foreground its compact component choices and keep visual-style fields behind a `Styles` disclosure. Show up to three choices directly; use one native chooser plus one Add action for a larger allowlist. Keep raw HTML/CSS/JS collapsed so the live board remains the Focus view.
- Make HTML the primary start path when the page is empty: one centered `New live board` action on the canvas, the HTML inspector selected by default, and a first-class `Design with HTML` Insert action. Keep the empty state calm; do not stack dashboards or nested cards around it.
- Declare compact typed controls with `data-openpencil-control-*`; use `data-openpencil-options-*` for select values and `data-openpencil-bind-*` for either `text` or a safe `attribute:data-*|aria-*` binding. A component name must resolve uniquely. If duplicate names make the target ambiguous, refuse the mutation instead of guessing.
- A typed component-property update must write the canonical HTML, create an undoable board revision, and visibly update the rendered pixels. Metadata-only properties that have no supported binding stay hidden from the editable control list.
- Keep JavaScript in its own source field, inject it only inside the sandboxed board runtime, and prove one real interaction in Interact mode.
- Confirm the revision badge advances after a real edit and that both the prior and current revision resolve before attaching versions, comments, or flow states.
- Before editing a protected board, create an exact-revision branch below it. Put next states to the right and use native links. Use `Fit flow` to frame the entire connected set—not only the selected board—within the visible canvas insets so side panels never cover it. Focus/Shift+2 on a single HTML-board selection must use the same panel-aware inset calculation.
- Review is an explicit revision transition with feedback scope. Handoff copies a structured exact-revision receipt and must say that source remains unchanged.
- Keep revision comments outside the HTML/CSS/JS revision envelope so discussion does not create false design history. Use a small native marker near the board, not a detached dashboard.
- Treat Preferred as a user decision only. A change set is proposal-only, pins its exact Preferred source revision, and requires separate approval, workspace checks, test evidence, and real-app verification before any receipt can claim source application.
- Before creating a change set, attach at least one repository-relative source target to the exact Preferred revision. Manual mappings remain `declared`. A built-in live component may become `repository-verified` only when its canonical wrapper exactly matches an internally verified catalog descriptor whose file and renderer fixture are checked in the real repository. Apply this as one shared registry contract across the catalog; do not create bespoke verification logic per fixture. Mapping or clearing a target is undoable sidecar work and must not create a design revision.
- A workspace-checked board may copy an implementation request, but that packet must preserve the canonical HTML/CSS/JS and artifact metadata, identify exact source targets, say `sourceUnchanged: true`, and require a visible diff plus explicit authorization. Do not label it Apply or Merge.
- Never expose a casual Apply action from the board inspector. Production, proposed change sets, Approved boards, and Verified boards stay protected; editing resumes on a new branch.
- In Interact mode, exercise at least one real interaction and inspect the resulting screenshot.
- Keep scripts sandboxed; do not grant same-origin access to the OpenPencil host.
- Preserve a native route for comments, connections, review state, and source handoff receipts.

The implementation lives in OpenPencil under `src/app/html-board/`, `HtmlBoardEmbeds.vue`, `HtmlBoardCodePanel.vue`, `HtmlFirstCanvasWelcome.vue`, and the Insert/Code inspector entry points.
