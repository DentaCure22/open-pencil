# Figma-to-HTML pilot artifacts

This directory contains a non-invasive preflight for the OpenPencil Figma-to-HTML workstream. It does not modify the live HTML Board implementation.

## Deliverables

- `flow-review.absolute.html` — existing OpenPencil `.fig -> SceneGraph -> @open-pencil/dom-css` standalone export.
- `flow-review.structural-fragment.html` — structure-preserving fragment export used to compare layout behavior.
- `flow-review.html-board.html` — final standalone artifact with stable source metadata and viewport attributes for the current HTML Board.
- `flow-review.html-board.png` — browser verification of the final handoff.
- `flow-review.absolute-phone.png` and `flow-review.structural-phone.png` — evidence that both export modes remain fixed-width at phone size.
- `build-handoff.mjs` — wraps an existing HTML export with a node-specific Figma receipt. It does not call Figma or create another runtime.

## Current import path

In OpenPencil’s Code importer:

1. Paste the complete contents of `flow-review.html-board.html` into HTML.
2. Leave the external CSS and JavaScript fields empty.
3. Choose `Place as HTML Board`.

The HTML Board owns the SceneNode, sandbox, revisions, undo, responsive presets, and interaction modes.

## Build the local fixture again

```bash
/Users/omar/.bun/bin/bun run open-pencil -- export \
  '/Users/omar/Documents/Open Pencil/artifacts/native-layout-kit/flow-review.fig' \
  --format html \
  --html standalone \
  --css inline \
  --assets inline \
  --fonts none \
  --output '/Users/omar/Documents/Open Pencil/artifacts/figma-to-html-pilot/flow-review.absolute.html'

/Users/omar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  '/Users/omar/Documents/Open Pencil/artifacts/figma-to-html-pilot/build-handoff.mjs' \
  --input-html '/Users/omar/Documents/Open Pencil/artifacts/figma-to-html-pilot/flow-review.absolute.html' \
  --output '/Users/omar/Documents/Open Pencil/artifacts/figma-to-html-pilot/flow-review.html-board.html' \
  --mode absolute-fidelity \
  --width 1600 \
  --height 1160 \
  --source-file '/Users/omar/Documents/Open Pencil/artifacts/native-layout-kit/flow-review.fig' \
  --source-snapshot '/Users/omar/Documents/Open Pencil/artifacts/native-layout-kit/flow-review.fig' \
  --source-label 'artifacts/native-layout-kit/flow-review.fig' \
  --artifact-id figma-fixture-flow-review \
  --title 'Flow review Figma-to-HTML pilot'
```

## Real node handoff

`build-handoff.mjs` requires a concrete Figma `node-id` and rejects file-only URLs. The HTML input must already have been generated from `get_design_context` or the matching `.fig` export.

See `docs/reports/figma-to-html-workstream-2026-07-13.md` for the two-lane contract and node pilot runbook.
