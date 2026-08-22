# OpenPencil Project Instructions

These instructions apply to the whole repository. A nested `AGENTS.md` may add
constraints for its subtree. Explicit user instructions and higher-level safety
rules remain authoritative.

OpenPencil is a Vue 3 design editor built on CanvasKit and Yoga, delivered as a
Tauri desktop app and browser application. Read `package.json`, workspace
package manifests, and live source for exact versions, scripts, exports, and
enabled libraries. Product direction lives in
`packages/docs/development/roadmap.md`.

## Source-of-truth order

1. Explicit user requirements and current project instructions.
2. Live repository source, package exports, configuration, tests, and schemas.
3. Rendered or deployed state when the task depends on runtime truth.
4. Published documentation for supported public behavior.
5. Historical notes and plans for navigation only; revalidate material claims.

Do not infer current behavior from names, old plans, screenshots, or saved Board
state alone. Preserve `unknown` when evidence is incomplete.

## Scope and working tree

Identify whether the user asked to explain, audit, diagnose, change, or build.
Reviews and diagnoses do not authorize implementation. Keep changes inside the
named outcome and its necessary dependencies.

The worktree may contain substantial unrelated work. Preserve it. Never reset,
overwrite, stage, format, or commit unrelated changes. Do not move or delete a
file until references, framework discovery, package exports, and tests have been
checked. Prefer recoverable operations for broad destructive work.

A prompt sent from an OpenPencil Board card is Board work, even when its wording
is vague. Activate `/skill:openpencil` before searching. Unless the prompt
already supplies the exact current page, call read-only
`openpencil_board_where` once to establish it and prefer any relevant selected
object IDs it returns. Use `rg` on the compact `workspace.index.jsonl` only when
the target is still unresolved, read `trace-context.json` and
`trace-events/*.jsonl` for vague speech or pointing, then use ordinary
coding-agent file tools on exact `workspace.json` records. Keep reads and
verification compact instead of printing full nodes. Do not call
`dispatch_work`, `board_go`, or `set_theme`; do not use mutation helpers, grep
this repo for Board names, or load the whole Board into model context.

## Projects

Known homes for Board workers. Add a line when a new project joins. Pi starts in
this Open Pencil workspace; the other entries are exact absolute paths a worker
may select when the brief requires repo work. They are not automatically
attached roots. Board names are not a reason to search these repos. Search the
Board first, then pick from this list only for actual repo work and read that
repo's `AGENTS.md`. Use the listed path as written. Do not rebuild an Archives
or MacBook Pro path.

Board agents run through resident Pi RPC sessions. Sidebar CHATS and Board cards
share the same local-authority threads. Dispatched Board workers get normal Pi
file tools plus read-only `board_where` and `board_screenshot`; the parent
controls remain unavailable.
General Pi chats may still use connected apps. Do not `require` or `import` from
a Node workshop.

- Open Pencil — `/Users/omar/Documents/Open Pencil` — this repo and native Board work
- Smylr — `/Users/omar/Documents/Smylr-Elite` — live iframe / dental app

The Codex plugin MCP exposes `dispatch_work`, `board_where`, `board_screenshot`,
`board_go`, and `set_theme`. `board_where` and `board_screenshot` are shared
read-only context. Dispatch, camera hops, and light/dark remain parent-only.
`dispatch_work` starts a worker directly or continues the exact prior worker.
Workers edit files and never receive the parent controls. The full MCP catalog
in `packages/mcp` remains for CLI and tests;
`board_context` is off the plugin, not deleted from that catalog.

## Monorepo boundaries

- `packages/scene-graph` owns framework-agnostic graph state, node types,
  primitives, geometry, copy/snap/undo, variables, instances, and hit testing.
- `packages/pen` owns shared pen and vector-edit helpers.
- `packages/kiwi` owns low-level Kiwi schema/runtime, codec, container, GUID,
  and parse helpers without SceneGraph policy.
- `packages/fig` is the publishable `.fig` package boundary.
- `packages/core` owns framework-agnostic editor, renderer, layout, Figma API,
  tools, clipboard, codegen, and document I/O policy.
- `packages/dom-css` owns DOM/CSS/JSX/Tailwind projection and browser/headless
  CSS adapters.
- `packages/vue` is the headless Vue SDK and primitive/composable layer.
- `packages/cli` owns headless CLI commands and agentfmt output.
- `packages/mcp` owns the optional MCP server and filesystem/server-only tools.
- `packages/docs` owns the published VitePress documentation.
- `src/` owns the Tauri/Vite application shell and app-specific integrations.

Use public workspace exports across package and app boundaries. Do not import
another package's internal source. Prefer targeted public subpaths when they
make dependency intent clearer. Keep browser DOM out of core packages.

## Editor architecture

`packages/core/src/editor/` is the framework-agnostic editor core.
`createEditor()` assembles `EditorContext` and domain action modules. Add new
behavior to the nearest domain module rather than growing unrelated files.

Share editor state through `EditorContext`, not app or Vue imports. Route core
selection changes through `ctx.setSelectedIds()` and tool changes through
`ctx.setActiveTool()` so typed editor events remain complete. App code should
use editor actions rather than direct state assignments.

The app editor session under `src/app/editor/session/` wraps core with reactive
state and app services. Active-editor and tab ownership stay in their existing
app domains.

## Automation, tools, and AI

- Framework-agnostic tool operations live under `packages/core/src/tools/**`
  as typed `ToolDef` objects executed against `FigmaAPI`.
- Add tools to the correct registry so intended AI, eval, CLI, and MCP consumers
  can discover them.
- Keep app tool wiring thin and create `FigmaAPI` from the active editor.
- CLI commands own CLI UX and agentfmt formatting; do not hand-roll output.
- MCP-only filesystem or server tools remain in `packages/mcp`.
- Do not make the app silently start optional MCP transports. Their absence is
  a normal supported state.
- Keep prompts near their owning core or app domain.

CLI inspection commands should support `--json`. Use the project agentfmt
helpers rather than raw `console.log` presentation.

## Code Objects and Board Experiences

A trusted app-like Board surface is one persisted Code Object frame owned by
`src/app/code-object/`. Preserve its source/descriptor, serializable state,
attachments, transforms, interaction mode, Undo/Redo, duplication, connectors,
and persistence. Registered UI blocks are configured through serializable props;
do not copy their component source into generated objects.

A Board Experience under `src/app/board-experience/` coordinates ordinary
native objects or Code Object frames. It must not create a parallel hidden
editor, non-selectable HUD, or second mutable Board runtime. Code Objects and
Board Experiences use `src/app/board-permissions/` for bounded operations.

Mermaid remains one source-backed frame rendered to SVG. Preserve source-owner
identity and do not materialize generated native diagram children.

## Code organization

- Inspect neighboring ownership and naming before adding or moving files.
- App services, state, and integrations live under `src/app/**`; route/layout
  views under `src/views/**`; app UI under `src/components/**`.
- `src/components/ui/**` is the reusable visual primitive layer and must not
  import app stores, services, or feature panels.
- Package-local code uses the package's established alias or nearby relative
  imports. App cross-directory imports use `@/`.
- Keep multi-file domains in a domain folder rather than repeated filename
  prefixes or new root-level component files.
- Vue component files use PascalCase. Component composables use camelCase.
  Other domain files and folders use lowercase or kebab-case unless they are
  conventional entrypoints.
- Private repository tooling belongs under `tools/<domain>/` with focused tests.
  `scripts/` is limited to small compatibility entrypoints.
- Use existing named types and shared primitives. Avoid `any`, non-null
  assertions, duplicated structural types, and module-level mutable component
  state.
- Use `crypto.getRandomValues()` instead of `Math.random()` where stable secure
  identity is required.
- Guard browser APIs explicitly in framework-agnostic code.
- Prefer established dependencies over custom implementations; inspect the
  relevant package manifest and current upstream documentation first.

Architecture boundaries are enforced by `bun run check:arch` and related
checks. Fix the boundary instead of bypassing the rule.

## UI conventions

- Use Reka UI and existing wrappers for accessible primitives.
- Follow the existing `ui`/tailwind-variants slot pattern; do not add families
  of one-off class props.
- Prefer `v-model`, emitted events, normal props, or owned UI over imperative
  slot actions and ref plumbing.
- Keep shortcut identity in the command registry and format it at render time.
  Labels and translations must not embed platform-specific shortcut text.
- Browser and Tauri menus share the canonical menu schema. Regenerate native
  menu output after changing it.
- Use Tailwind for ordinary styling. Avoid component `<style>` blocks, native
  `title` attributes, raw SVG, and Unicode icons when established primitives
  exist.
- Preserve pointer ownership, focus, containment, splitter sizing, and keyboard
  behavior when refactoring interactive controls.

## Rendering and file formats

- Canvas rendering uses CanvasKit, not DOM. Keep repaint-only and scene-mutation
  versioning separate and avoid subscriptions to repaint state when graph events
  are sufficient.
- Preserve zoom-independent selection chrome, unclipped-child visibility,
  resize throttling, stable reparenting, and immediate layout recomputation.
- Pixel-affecting renderer changes require targeted committed visual coverage in
  addition to engine tests.
- `.fig` low-level schema/runtime belongs in `packages/kiwi`; SceneGraph import,
  export, and interpretation policy remains in core until deliberately moved.
- Keep browser fallbacks for file APIs and verify `.fig` round trips when file
  format behavior changes.
- Tauri capabilities are explicit. Inspect `desktop/Cargo.toml`,
  `desktop/capabilities/**`, and `desktop/tauri.conf.json` before adding desktop
  filesystem or shell behavior.

## Tests and verification

Place tests by ownership:

- app E2E: `tests/e2e/**/*.spec.ts`
- Figma automation: `tests/figma/**/*.spec.ts`
- engine/unit: `tests/engine/**/*.test.ts`
- shared helpers: `tests/helpers/**`
- standalone packages: their established package `tests/**`

Inspect `package.json` before running commands. Common gates include:

- `bun run check` — lint, type, architecture, and package checks
- `bun run format` — formatting and import sorting
- `bun run test:dupes` — source duplication
- `bun run test:tools` — private tooling tests
- `bun run test:unit` — engine/unit tests
- `bun run test` — Playwright E2E and visual tests

Run focused checks first, then broader gates in proportion to risk. Re-read every
modified file and inspect the final focused diff. Distinguish source/test proof,
saved Board state, and rendered pixels. Report blocked or unavailable checks as
unverified, never passed.

## Documentation, releases, and publishing

Update `CHANGELOG.md` for user-facing changes and `README.md` when public setup
or capabilities change. Published documentation lives under `packages/docs/**`;
keep speculative plans out of it.

Treat `.github/workflows/**`, package manifests, `desktop/tauri.conf.json`, and
`CHANGELOG.md` as release truth. Do not duplicate release package lists or
deployment triggers here. Use Conventional Commits for normal development and
the established release commit format for releases.

Do not commit, tag, publish, deploy, or apply remote changes unless explicitly
authorized. Completion reports should state what changed, what was verified,
and any real remaining limitation.
