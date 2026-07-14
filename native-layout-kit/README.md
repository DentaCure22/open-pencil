# OpenPencil Native Layout Kit

This kit gives the agent a constrained external design grammar without turning OpenPencil into a screenshot importer.

The bridge is:

1. Author a small HTML/CSS composition using the kit tokens.
2. Inline any real product capture needed for review evidence.
3. Import the composition with OpenPencil's CLI.
4. Open or merge the resulting `.fig` document and continue editing native frames and text.

The chosen grammar combines three ideas:

- Tailwind/CSS as a deterministic token and layout interface.
- Carbon's 8 px geometric rhythm and limited spacing scale.
- Radix Themes' separation of layout responsibility from content and interaction.

It deliberately does not copy another product's branding, component names, or dashboard templates.

## Build the proof board

From the OpenPencil source checkout:

```sh
bun run open-pencil import \
  "/Users/omar/Documents/Open Pencil/artifacts/native-layout-kit/flow-review.inline.html" \
  --css "/Users/omar/Documents/Open Pencil/native-layout-kit/tokens.css" \
  --page-name "Flow review" \
  -o "/Users/omar/Documents/Open Pencil/artifacts/native-layout-kit/flow-review.fig"
```

Generate the inlined HTML first:

```sh
bun "/Users/omar/Documents/Open Pencil/native-layout-kit/build.mjs"
```

Run the structural quality gate:

```sh
bun "/Users/omar/Documents/Open Pencil/native-layout-kit/audit.mjs" \
  "/Users/omar/Documents/Open Pencil/artifacts/native-layout-kit/flow-review.json"
```

See [design-quality-metric.md](./design-quality-metric.md) for the constraints the board is expected to satisfy.

