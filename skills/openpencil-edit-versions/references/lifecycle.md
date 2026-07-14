# Edit-version lifecycle

## Lifecycle

`Production -> Draft -> Variant -> In Review -> Preferred -> Change Set -> Approved -> Implementing -> Verified -> Applied -> History`

`Preferred` is a design decision, not permission to modify production.

## Required version record

- stable ID, kind, name, status
- document, page, route, source node, owner/source evidence
- base revision and parent version
- original HTML, CSS, JavaScript, viewport, token values, and patch list
- tokens, responsive states, and structural changes
- canvas position and grouping
- preview status and capture metadata
- intent, notes, comments, creator, and timestamps
- related flow and change-set IDs

## Minimum acceptance checks

1. Edit production through a branch.
2. Select another object and return; edits persist.
3. Reopen a saved version; the same patch and preview return.
4. Compare at least two versions with production.
5. Reset a property, a container, and a whole draft independently.
6. Marking Preferred does not change production.
7. Applying requires an approved, verified change set.

## HTML-board realization

- A branch starts as an exact copy of `{ boardId, revision, schemaVersion }`; the new board begins at revision 1 and retains its origin reference.
- Keep protected production above and the editable branch below at equal width. A connector and visible status label must make the relationship obvious without reading the inspector.
- Review advances the branch revision and records both feedback wanted and what is not being evaluated.
- Comments attach to an exact revision in sidecar metadata. Adding a comment must not advance the design revision, and a compact native marker stays visually anchored to the board.
- Preferred advances the workflow revision but grants no source permission. Creating a change set then freezes the exact Preferred revision as its source and records acceptance criteria.
- Before creating the change set, attach one or more declared repository-relative source targets to that exact Preferred revision. Source targets are undoable sidecar metadata: they neither advance the HTML design revision nor claim that the target was resolved in a repository.
- Workspace readiness may produce a copyable implementation-request packet containing the exact source revision, canonical HTML/CSS/JS, source targets, artifact identity, and acceptance criteria. The packet remains proposal-only, reports the source unchanged, and requires a visible diff plus explicit authorization before any source mutation.
- A handoff is proposal-only until a separately approved, workspace-checked, tested, and real-app-verified source change exists. Before verification its receipt says `sourceUnchanged: true`; only complete verification evidence may change that receipt to `sourceApplicationStatus: verified` and `sourceUnchanged: false`.
- Branch, flow, comment, review, Preferred, change-set, approval, readiness, and verification transitions must survive undo and redo without changing identifiers.
- Protected Production, Change Set, Approved, and Verified boards cannot be edited directly. Start a new exact-revision branch instead.
