---
title: CLI Reference
description: Complete reference for all openpencil commands, options, and flags.
---

# CLI Reference

File inspection, export, and `eval` commands accept a `.fig` file. Live and persisted Board
automation uses the exact-target `openpencil board` namespace instead of unguarded file omission.

## info

Show document info — pages, node counts, fonts, file size.

```sh
openpencil info [file] [--json]
```

| Option   | Description    |
| -------- | -------------- |
| `--json` | Output as JSON |

## tree

Print the node hierarchy.

```sh
openpencil tree [file] [options]
```

| Option    | Description                     |
| --------- | ------------------------------- |
| `--page`  | Page name (default: first page) |
| `--depth` | Max depth (default: unlimited)  |
| `--json`  | Output as JSON                  |

## find

Search nodes by name or type.

```sh
openpencil find [file] [options]
```

| Option    | Description                                               |
| --------- | --------------------------------------------------------- |
| `--name`  | Node name (partial match, case-insensitive)               |
| `--type`  | Node type: `FRAME`, `TEXT`, `RECTANGLE`, `INSTANCE`, etc. |
| `--page`  | Page name (default: all pages)                            |
| `--limit` | Max results (default: 100)                                |
| `--json`  | Output as JSON                                            |

## node

Show detailed properties of a node.

```sh
openpencil node [file] --id <id> [--json]
```

| Option   | Description                         |
| -------- | ----------------------------------- |
| `--id`   | **Required.** Node ID (e.g. `1:23`) |
| `--json` | Output as JSON                      |

## pages

List all pages in the document.

```sh
openpencil pages [file] [--json]
```

| Option   | Description    |
| -------- | -------------- |
| `--json` | Output as JSON |

## variables

List design variables and collections.

```sh
openpencil variables [file] [options]
```

| Option         | Description                                           |
| -------------- | ----------------------------------------------------- |
| `--collection` | Filter by collection name                             |
| `--type`       | Filter by type: `COLOR`, `FLOAT`, `STRING`, `BOOLEAN` |
| `--json`       | Output as JSON                                        |

## export

Export to PNG, JPG, WEBP, SVG, JSX, HTML, or `.fig`.

```sh
openpencil export [file] [options]
```

| Option        | Alias | Description                                                 |
| ------------- | ----- | ----------------------------------------------------------- |
| `--format`    | `-f`  | `png` (default), `jpg`, `webp`, `svg`, `jsx`, `html`, `fig` |
| `--output`    | `-o`  | Output file path (default: `<name>.<format>`)               |
| `--scale`     | `-s`  | Export scale (default: 1)                                   |
| `--quality`   | `-q`  | Quality 0–100, JPG/WEBP only (default: 90)                  |
| `--page`      |       | Page name (default: first page)                             |
| `--node`      |       | Node ID to export (default: all top-level nodes)            |
| `--style`     |       | JSX style: `openpencil` (default), `tailwind`               |
| `--html`      |       | HTML mode: `fragment` (default), `standalone`               |
| `--css`       |       | HTML CSS output: `inline` (default), `tailwind`             |
| `--assets`    |       | Standalone HTML assets: `inline` (default), `external`      |
| `--fonts`     |       | Standalone HTML font output: `assets`, `none` (default)     |
| `--thumbnail` |       | Export page thumbnail instead of full render                |
| `--width`     |       | Thumbnail width (default: 1920)                             |
| `--height`    |       | Thumbnail height (default: 1080)                            |

## import

Import HTML/CSS/Tailwind into an editable OpenPencil document.

```sh
openpencil import page.html [options]
```

| Option            | Alias | Description                                      |
| ----------------- | ----- | ------------------------------------------------ |
| `--format`        | `-f`  | Output format: `fig` (default), `json`           |
| `--output`        | `-o`  | Output file path (default: `<name>.<format>`)    |
| `--css`           |       | CSS file to apply before conversion              |
| `--css-text`      |       | Inline CSS text to apply before conversion       |
| `--tailwind`      |       | Tailwind utility candidates to compile and apply |
| `--tailwind-file` |       | File containing Tailwind utility candidates      |
| `--page-name`     |       | Scene graph page name (default: `DOM/CSS`)       |
| `--json`          |       | Print a machine-readable summary                 |

Examples:

```sh
openpencil import card.html --css card.css -o card.fig
openpencil import card.html --tailwind "flex flex-col gap-3 w-80 p-6 rounded-xl bg-white" -o card.fig
```

## board

Use the compact persisted index when a Board or object ID is unknown:

```sh
openpencil board search "pricing decisions" --limit 10 --json
openpencil board create --name "Agent Sandbox" --request-id "create-agent-sandbox" --json
```

| Command         | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `board search`  | Find an unknown persisted Board or object compactly            |
| `board create`  | Create a Board when the user explicitly requests a new one    |
| `board build`   | Apply one complete semantic plan as one guarded transaction   |
| `board present` | Reveal a saved result when the user requests visual placement |

Use the exact target returned by `board search`, `board create`, or a previous durable receipt. Send
one `board-build-request/v1` through `--request`:

```sh
openpencil board build --request '{
  "contract": "board-build-request/v1",
  "target": {
    "workspace_id": "workspace-id",
    "content_document_id": "content-document-id",
    "document_id": "document-id",
    "page_id": "board-page-id"
  },
  "request_id": "build-status-card",
  "intent": "Build one status card",
  "plan": {
    "contract": "board-build-plan/v1",
    "artifacts": [{
      "alias": "status",
      "recipe": {
        "kind": "native_card",
        "title": "Status",
        "body": "Ready",
        "placement": { "target": { "kind": "auto" } }
      }
    }],
    "connections": []
  }
}' --release-summary --json
```

The request has exactly four top-level responsibilities: its contract, persisted target, stable
request ID and intent, and one `board-build-plan/v1`. The plan may describe artifacts, semantic
composition, object operations, and connections as one atomic outcome. Placement is an optional
semantic hint, never authority.

`board build` accepts exactly one of `--request` or `--request-file`. Use `--request-file` only when
the JSON is too large for practical shell quoting. Add `--latest-gesture` or one exact
`--gesture-id` when Trace should provide read-only context for the plan.

Runtime IDs, context tokens, expected revisions, fresh-context handshakes, fingerprints, retries,
authority preparation, persistence, and Undo are implementation details handled internally. They do
not belong in the public request. Diagnostic and compatibility commands may remain available to
OpenPencil itself, but they are not normal agent-facing Board UX.

`board present` is optional and read-only. Use it only when the user asks to reveal the saved result
in a connected editor; a successful `board build` receipt is the durable mutation boundary.

## eval

Execute JavaScript with the Figma Plugin API.

```sh
openpencil eval <file> [options]
```

`eval` is file-only. It never mutates the live Board; persist file changes with `--write` or
`--output`.

| Option     | Alias | Description                          |
| ---------- | ----- | ------------------------------------ |
| `--code`   | `-c`  | JavaScript code to execute           |
| `--stdin`  |       | Read code from stdin                 |
| `--write`  | `-w`  | Write changes back to the input file |
| `--output` | `-o`  | Write to a different file            |
| `--json`   |       | Output as JSON                       |
| `--quiet`  | `-q`  | Suppress output                      |

## analyze colors

Analyze color palette usage across the document.

```sh
openpencil analyze colors [file] [options]
```

| Option        | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| `--limit`     | Max colors to show (default: 30)                                     |
| `--threshold` | Distance threshold for clustering similar colors, 0–50 (default: 15) |
| `--similar`   | Show similar color clusters                                          |
| `--json`      | Output as JSON                                                       |

## analyze typography

Analyze font family, size, and weight distribution.

```sh
openpencil analyze typography [file] [options]
```

| Option       | Description                                                     |
| ------------ | --------------------------------------------------------------- |
| `--group-by` | Group by: `family`, `size`, `weight` (default: show all styles) |
| `--limit`    | Max styles to show (default: 30)                                |
| `--json`     | Output as JSON                                                  |

## analyze spacing

Analyze gap and padding values across auto-layout frames.

```sh
openpencil analyze spacing [file] [options]
```

| Option   | Description                                  |
| -------- | -------------------------------------------- |
| `--grid` | Base grid size to check against (default: 8) |
| `--json` | Output as JSON                               |

## analyze clusters

Find repeated node patterns — potential components.

```sh
openpencil analyze clusters [file] [options]
```

| Option        | Description                                  |
| ------------- | -------------------------------------------- |
| `--limit`     | Max clusters to show (default: 20)           |
| `--min-size`  | Min node size in px (default: 30)            |
| `--min-count` | Min instances to form a cluster (default: 2) |
| `--json`      | Output as JSON                               |
