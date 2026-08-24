# OpenPencil Project Instructions

OpenPencil is a Vue 3 design editor built on CanvasKit and Yoga. Read the live
source and package manifests for exact versions, scripts, exports, and enabled
libraries. Product direction lives in `packages/docs/development/roadmap.md`.

## Package boundaries

- `packages/scene-graph` owns framework-agnostic graph state, node types,
  geometry, copy/snap/undo, variables, instances, and hit testing.
- `packages/pen` owns shared pen and vector-edit helpers.
- `packages/kiwi` owns the low-level Kiwi schema, codec, container, GUID, and
  parse helpers without SceneGraph policy.
- `packages/fig` is the publishable `.fig` package boundary.
- `packages/core` owns the framework-agnostic editor, renderer, layout, Figma
  API, tools, clipboard, codegen, and document I/O policy.
- `packages/dom-css` owns DOM, CSS, JSX, Tailwind projection, and browser or
  headless CSS adapters.
- `packages/vue` is the headless Vue SDK and primitive/composable layer.
- `packages/cli` owns headless CLI commands and agentfmt output.
- `packages/mcp` owns the optional MCP server and filesystem/server tools.
- `packages/docs` owns the published VitePress documentation.
- `src/` owns the application shell and app-specific integrations.

Use public workspace exports across package and app boundaries. Do not import
another package's internal source. Prefer targeted public subpaths when they
make dependency intent clearer. Keep browser DOM out of core packages.

## Verification

Use Bun from the repository package manager. Run the narrowest relevant check
first, then broaden in proportion to the change:

- Focused unit test: `bun test <test-file>`
- Unit suite: `bun run test:unit`
- Lint and type/package checks: `bun run lint` and `bun run check`
- Production build: `bun run build`
- Browser suite: `bun run test`

Re-read modified files and inspect the focused diff. Source, persisted Board
state, browser pixels, and interaction are separate proof levels; report only
what the performed check establishes.

## Documentation and releases

Update `CHANGELOG.md` for user-facing changes and `README.md` when public setup
or capabilities change. Published documentation belongs under
`packages/docs/**`; keep speculative plans out of it.

Treat `.github/workflows/**`, package manifests, and `CHANGELOG.md` as release
truth. Do not commit, tag, publish, deploy, or apply remote changes unless the
user explicitly asks.
