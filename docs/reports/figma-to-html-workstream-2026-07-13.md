# Figma-to-HTML workstream for OpenPencil

## Decision

Use two explicit output lanes and hand both to the existing HTML Board as normal HTML/CSS/JS:

1. **Absolute-fidelity export** for visual comparison, review, and archival snapshots.
2. **Component-aware responsive HTML** for production-shaped prototypes and later source handoff.

Do not treat the absolute export as responsive production code. Do not introduce a second iframe, runtime, scene graph, or HTML document schema.

The receiving contract is the current `createHtmlBoardFrame(store, html, css, js)` path in OpenPencil. The generated HTML carries a stable artifact receipt; the HTML Board continues to own the SceneNode ID, schema migration, revisions, undo, sandboxing, viewport presets, Inspect/Interact behavior, and workflow state.

## Architecture

### Lane A: absolute fidelity

```text
Figma local copy (.fig)
  -> OpenPencil readFigFile
  -> SceneGraph
  -> sceneGraphToDesignDocument
  -> exportHTMLBundle({ html: "standalone" })
  -> embedded Figma artifact receipt + viewport attributes
  -> current HTML Board
```

Use this lane when the question is “does the browser output look like the selected Figma frame?” It deliberately produces a fixed canvas and absolute positioning at the standalone boundary.

Relevant existing implementation:

- `packages/core/src/io/formats/fig/read.ts`
- `packages/dom-css/src/from-scene-graph.ts`
- `packages/dom-css/src/html-export.ts`
- `packages/cli/src/commands/export.ts`

Figma lets users with at least view access save a local `.fig` copy on any plan if copying has not been restricted. Figma also warns that the proprietary format may change and recommends supported APIs for third-party integrations, so this lane is a snapshot/compatibility path rather than the long-term semantic API boundary: <https://help.figma.com/hc/en-us/articles/8403626871063-Save-a-local-copy-of-files>.

### Lane B: responsive, component-aware HTML

```text
Node-specific Figma URL
  -> get_design_context (reference code + screenshot + design metadata)
  -> variable definitions
  -> library/component discovery when available
  -> Code Connect enrichment when available
  -> reconcile with production component APIs
  -> author semantic HTML/CSS/JS with breakpoints and component receipts
  -> embedded Figma artifact receipt + viewport attributes
  -> current HTML Board
```

Use this lane when the question is “how should this become maintainable responsive UI?” Figma documents that `get_design_context` returns agent-friendly design context, not production-ready code; the agent is expected to adapt it to the target framework and codebase: <https://developers.figma.com/docs/figma-mcp-server/server-returning-web-code/>.

Code Connect is an enrichment layer, not an HTML exporter. It gives the MCP response actual imports, prop mappings, snippets, and source paths for connected components: <https://developers.figma.com/docs/figma-mcp-server/code-connect-integration/>.

## Approach matrix

| Approach | What it is good at | Current test/result | Decision |
| --- | --- | --- | --- |
| Figma MCP `get_design_context` | Node-scoped screenshot, reference code, metadata, Code Connect context | Tool is connected; authenticated plan verified. A real call is pending a node-specific URL. | Primary input for Lane B. |
| Code Connect | Maps Figma components/variants to real code components and props | Current account is Starter; Code Connect requires a Dev or Full seat on Organization or Enterprise. | Use only after plan/library prerequisites are satisfied. Do not block the first responsive pilot on it. |
| Figma libraries | Reusable components, variables, and styles | Starter can create local components/styles but cannot publish a shared library. | Query subscribed libraries only after a real file key exists; do not invent a parallel catalog. |
| `.fig` import + `@open-pencil/dom-css` standalone export | Deterministic Figma-compatible snapshot through OpenPencil’s existing parser and exporter | Tested successfully on the local `flow-review.fig` artifact. | Primary input for Lane A. |
| `.fig` import + DOM/CSS fragment export | Preserves flex/grid structure present in the SceneGraph | Tested successfully, but fixed dimensions still overflow at phone width. | Useful diagnostic or starting material, not responsive production output. |
| Figma REST file JSON | Official node/component/style JSON and image references | Evaluated as a fallback; no established OpenPencil adapter exists in this checkout. | Do not build a new adapter until MCP and `.fig` lanes prove insufficient. |

Official plan references:

- MCP access and rate limits: <https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/>
- Code Connect availability: <https://developers.figma.com/docs/code-connect/>
- Library publishing availability: <https://help.figma.com/hc/en-us/articles/360025508373-Publish-a-library>
- REST file JSON endpoint: <https://developers.figma.com/docs/rest-api/file-endpoints/>

## Current plan and API constraints

The connected Figma account reports:

- Tier: `starter`
- Seat: `Full`
- Remote MCP: connected

Figma’s current access page describes Starter read access as up to six MCP read calls per month. `whoami` is exempt from those read limits. The first node pilot should therefore avoid exploratory calls and start with `get_design_context`, which already includes a screenshot by default. Add `get_variable_defs` only when the design actually uses variables.

Code Connect is currently blocked by plan: it requires Organization or Enterprise. Code Connect UI also requires a published library component. Library publishing itself is unavailable on Starter.

The node URL must include `node-id`. The pilot builder rejects a file-only URL rather than guessing a node. A node URL is sufficient for the MCP lane; the deterministic `.fig` lane additionally needs a saved local `.fig` copy or another compatible snapshot.

## Stable HTML Board handoff

The handoff is a standalone HTML document. When it already contains its own styles and scripts, pass it as:

```text
html = complete standalone document
css  = ""
js   = ""
```

The root contains:

```html
<main
  data-openpencil-width="1600"
  data-openpencil-height="1160"
  data-openpencil-component="FigmaExport"
  data-openpencil-variant="absolute-fidelity"
  data-artifact-id="figma-<file-key>-<node-id>"
>
```

The document also embeds non-executable artifact metadata:

```html
<script type="application/vnd.openpencil.figma+json" data-openpencil-artifact>
  {
    "artifactId": "figma-<file-key>-<node-id>",
    "diagramType": "figma-node",
    "editingModel": "figma-source-absolute-export",
    "kind": "figma-to-html-board",
    "renderFormat": "html-absolute",
    "renderer": "@open-pencil/dom-css",
    "source": "https://www.figma.com/design/...?...node-id=...",
    "sourceHash": "<sha256>",
    "title": "<selection title>"
  }
</script>
```

For the responsive lane, use:

- `editingModel: "responsive-html-with-component-receipt"`
- `renderFormat: "html-responsive"`
- `renderer: "figma-mcp/get_design_context"`
- `data-openpencil-variant="component-aware-responsive"`

The stable `artifactId` is source identity. The receiving board’s SceneNode ID is editor identity. Regeneration updates the same artifact; revisions and undo remain inside the current HTML Board.

The live HTML Board source moved from schema v3 to v4 while this audit was running, and the v4 work added artifact metadata and artifact-ID reuse. That confirms the right boundary: external handoff code should not serialize or pin the internal `HtmlBoardDocument` schema. It should provide normal HTML/CSS/JS and let the receiving API migrate/store it.

### Current and staged insertion paths

- **Current live path:** Code panel importer -> `Place as HTML Board` -> `createHtmlBoardFrame`.
- **Staged, not currently live in the source checkout:** `upsert_html_board` under `patch-stage/html-board-mcp`, with explicit document/page targets, idempotency, revision checks, dimensions, and interaction mode.

Do not call or depend on `upsert_html_board` until the HTML Board workstream explicitly agrees to and merges that staged command.

## Fixture pilot completed

Source:

- `artifacts/native-layout-kit/flow-review.fig` (92 KB Figma-compatible `.fig`, not an LFS pointer)

Generated outputs:

- `artifacts/figma-to-html-pilot/flow-review.absolute.html` — 99.6 KB
- `artifacts/figma-to-html-pilot/flow-review.structural-fragment.html` — 93.9 KB
- `artifacts/figma-to-html-pilot/flow-review.html-board.html` — final current-HTML-Board handoff
- `artifacts/figma-to-html-pilot/build-handoff.mjs` — receipt/viewport wrapper

Browser verification:

| Check | Absolute standalone | Structural fragment |
| --- | ---: | ---: |
| Source-backed nodes | 99 | 99 |
| Computed absolute nodes | 99 | 0 |
| Computed flex nodes | 28 | 28 |
| Natural canvas | 1600 x 1160 | 2144 x 1280 when opened directly |
| Phone-width overflow at 390 px | 4.10x | 5.50x |

The phone test proves that removing top-level absolute positioning does not make the exported design responsive. The responsive lane must intentionally choose component structure, fluid sizing, and breakpoints.

The final handoff was re-rendered and verified with:

- `artifactId = figma-fixture-flow-review`
- `data-openpencil-width = 1600`
- `data-openpencil-height = 1160`
- `data-openpencil-variant = absolute-fidelity`
- 99 source nodes and 99 absolute nodes
- metadata source hash `8362e6858cdc9559e1871968ea47a944dc0324605f4923586b2d75d14b3239f1`

The builder also passed a node-URL parsing test (`node-id=12-34` normalized to `12:34`) and rejected a Figma URL without `node-id`.

## Node-specific pilot runbook

When a node URL is available:

1. Parse the file key and normalize `node-id` from `12-34` to `12:34`.
2. Call `get_design_context` once with the screenshot included and Code Connect enabled by default.
3. Call `get_variable_defs` only if variables are present or required for fidelity.
4. If the plan is upgraded and the file uses published libraries, call `get_libraries`, scope `search_design_system` to relevant library keys, and read existing Code Connect mappings.
5. Identify production component candidates from the codebase. Confirm real props/variants; never invent component props from layer names.
6. Produce two independently labeled artifacts:
   - absolute-fidelity HTML from the matching `.fig` snapshot when available;
   - component-aware responsive HTML from MCP context and confirmed code semantics.
7. Wrap each artifact with `build-handoff.mjs` using the same stable Figma URL-derived artifact ID plus a lane suffix when both need to coexist.
8. Place or update the artifact through the current HTML Board entrypoint.
9. Verify Desktop, Tablet, and Phone. The responsive lane must not horizontally overflow at 390 px.
10. Record visual differences and unresolved component mappings. Do not claim a production source change.

Example wrapper command after responsive HTML has been authored:

```bash
node artifacts/figma-to-html-pilot/build-handoff.mjs \
  --input-html artifacts/figma-to-html-pilot/<node>.responsive.html \
  --output artifacts/figma-to-html-pilot/<node>.html-board.html \
  --mode component-aware-responsive \
  --width 1440 \
  --height 900 \
  --figma-url 'https://www.figma.com/design/<file-key>/<name>?node-id=<x>-<y>' \
  --source-snapshot artifacts/figma-to-html-pilot/<node>.design-context.md \
  --title '<selection title>'
```

## Acceptance criteria for the real node pilot

- The URL is node-specific and accessible to the authenticated Figma account.
- MCP screenshot and reference context are saved as evidence.
- Absolute and responsive lanes have different labels and are never conflated.
- Existing production components are used only when mapping evidence exists.
- The responsive artifact works at 1440, 1024, 768, and 390 px without page-level horizontal overflow.
- Assets and fonts have explicit provenance or a documented substitution.
- The same artifact ID regenerates the same HTML Board instead of creating a duplicate.
- Design, Inspect, and Interact remain owned by the existing sandboxed HTML Board.
- No OpenPencil live source file is modified by this workstream without explicit agreement.

## Remaining input

The only required input for the real MCP pilot is an accessible Figma Design URL containing `node-id`. For the deterministic absolute lane, also provide or save a matching `.fig` local copy if possible.

