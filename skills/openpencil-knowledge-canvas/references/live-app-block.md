# Live App Block contract

A Live App Block is the first-class representation of a real application route and scenario inside a knowledge workspace.

## Required identity

- stable block ID
- application and environment
- route and scenario or fixture
- viewport and responsive state
- source/base revision
- live container root and selected container when known
- owner/source evidence when known
- preview patch or version references
- runtime state, last successful handshake, and error state
- current capture, capture time, and capture provenance

## Runtime model

Use one shared live runtime by default.

1. Selecting or explicitly activating a Live App Block docks the shared runtime into that block.
2. The runtime navigates to its route, restores its scenario, and replays isolated preview patches.
3. The previously active block returns to its last verified capture or lightweight preview.
4. Only the active block may claim `Live`; inactive states use labels such as `Captured`, `Preview`, `Stale`, `Loading`, `Auth required`, or `Unavailable`.

Do not create a separate full runtime for every visible state unless a verified use case requires simultaneous execution and the resource/security cost is accepted.

## Truth labels

- `Live` — the runtime is healthy and attached to this block now.
- `Captured` — source-backed evidence from a known route/scenario and time.
- `Preview` — isolated changes are rendered but have not changed production source.
- `Stale` — the capture or preview predates the current source/base revision.
- `Illustrative preview` — reconstructed or simplified content without a healthy real runtime.
- `Auth required` or `Unavailable` — the runtime cannot hydrate; never replace this state with an unlabeled mock.

## Editing safety

- Board geometry, annotations, and document content affect the workspace only.
- Live-preview edits must be immediate, undoable, revision-aware, and isolated from source.
- Saving a draft persists workspace metadata and preview patches; it does not write source.
- Production changes require owner/source evidence, an explicit proposed diff, review, approval, verification, and a separate apply/merge authorization.
- Never claim a scene-graph change altered the live application DOM or source component.

## Evidence and privacy

- Record capture provenance and runtime health with each snapshot.
- Mask configured sensitive fields in portable evidence and exports.
- Do not silently upload captures, session data, or application content.
- When a capture is unavailable, preserve the block identity and show the truthful runtime state.

## Interaction with graphs and documents

- In a flow, a Live App Block is a state node with typed transitions.
- In an App Atlas, it is a discovered screen/state node with confidence and review metadata.
- In a document, it is an embed referenced by the surrounding explanation.
- In Review, it is a source-backed artifact tied to an exact revision and comparison target.
