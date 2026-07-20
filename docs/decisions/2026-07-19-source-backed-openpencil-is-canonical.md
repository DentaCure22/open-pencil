# Source-backed OpenPencil is the canonical project

- **Status:** Accepted
- **Date:** 2026-07-19
- **Approved by:** Omar in the active Codex task

## Context

The OpenPencil experience running inside Smylr at
`http://localhost:3000/open-pencil/` is sourced from the Vue 3, CanvasKit, and
Yoga application that previously lived at:

`/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base`

The repository at `/Users/omar/Documents/Open Pencil` instead contained the
React/TSX replacement plan, experiments, prototypes, and mockup lanes. That
split made the project folder disagree with the product the user identified as
the real OpenPencil work.

The user explicitly resolved the conflict with: “this openpencil work is our
main project” and “store the rest.” This is the approval required to supersede
the earlier React-replacement decision.

## Decision

1. `/Users/omar/Documents/Open Pencil` is now the canonical home of the
   source-backed Vue/CanvasKit OpenPencil application.
2. The prior React/TSX replacement, legacy evidence, Excalidraw experiments,
   mockups, generated artifacts, dependencies, and dirty/untracked work are
   stored intact at:

   `/Users/omar/Documents/Open Pencil Stored/2026-07-19-react-replacement-and-prototypes`
3. The existing `.git` directory remains at the canonical project root. No
   commit, staging operation, or history rewrite was performed as part of this
   move.
4. The former Smylr source path is a symlink to the canonical project root so
   the integrated startup path continues to resolve without maintaining a
   second source copy.

## Superseded boundary

This decision supersedes the stored React master plan’s settled choice that the
React/TSX replacement is the main product and the Vue application is frozen
legacy evidence. That plan remains available in the stored tree for provenance,
but it is no longer the implementation contract for the canonical root.

Affected boundaries include the former canonical-root map, Vue legacy guard,
React-only runtime requirement, migration phases, and exit evidence tied to the
React replacement. Future work should follow the application architecture and
commands documented by the source-backed project now at the root.

## Alternatives considered

- **Keep the React replacement at the root:** rejected because it did not match
  the user-identified real product or the live integrated OpenPencil route.
- **Copy the source-backed application and keep two writable copies:** rejected
  because duplicate sources would reintroduce path and runtime drift.
- **Delete the prior work:** rejected because it would discard dirty,
  untracked, and experimental evidence that may still be useful.

## Consequences and recovery

- Bun and the source-backed package scripts are now the root development
  workflow.
- Git currently represents a deliberate whole-tree project replacement. A
  future commit should be reviewed and created intentionally; this decision
  does not authorize publishing it.
- To reverse the storage operation, stop the runtime, move the current source
  tree out of the root while leaving `.git` in place, then move the contents of
  the stored directory back into the root.
- No stored file was deleted or compressed, so individual artifacts can also be
  recovered directly.

## Required verification

- The root package identifies the source-backed OpenPencil application.
- The former Smylr source path resolves to the root.
- The root architecture check is executed and its current baseline findings are
  recorded; the storage move must not introduce path-resolution failures.
- The integrated Smylr route loads the OpenPencil shell and its embedded dental
  chart state after restart.

## Validation note

`bun run check:arch` resolves and runs from the promoted root, but the current
source baseline reports 17 errors and 21 warnings. The findings concern existing
domain-folder naming, package-internal imports, property-panel boundaries, and
native Vue `title` attributes. They are application cleanup debt, not failures
caused by moving or linking the project, and were not changed under this
repository-storage decision.
