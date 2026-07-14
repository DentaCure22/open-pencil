# Narrated Intent Trace and Copy Context

Status: product concept and implementation plan  
Scope: OpenPencil native toolbar, live canvas interaction, local voice transcription, visual intent annotation, editable session context, and manual Codex handoff

## Product statement

OpenPencil should let a person narrate what they are thinking while they select, inspect, edit, draw on, move through, and capture the real application canvas. Every meaningful action is synchronized against one session clock so the narration remains attached to the exact component, area, state, and change it referred to.

The result is an editable **Narrated Session**. Before sharing anything, the user can correct transcript text, remove irrelevant context, restore removed items, and preview the exact context packet. The first handoff is **Copy Context**, which places a readable, structured brief on the clipboard for the user to paste into Codex. There is no direct **Send to Agent** action in the first version.

## Locked product decisions

1. **Copy Context replaces Send to Agent.** The user remains in control of when and where context is pasted.
2. **Narrated Session is editable.** Transcript segments and captured events can be corrected, excluded, restored, or annotated before copying.
3. **The source trace and copied context are separate.** Cleaning the context draft never silently reverses a canvas edit or destroys the original recording ledger.
4. **All capture streams share one monotonic session clock.** Speech, selections, edits, gestures, screenshots, and viewport changes can be reconstructed in order.
5. **Semantic location is primary.** Stable node ID, component/container path, route, frame, and canvas object identity matter more than raw pointer coordinates.
6. **Coordinates remain supporting evidence.** Bounds, pointer position, canvas transform, viewport, and zoom help explain spatial intent when layout changes.
7. **Screenshots are evidence anchors, not continuous video.** They are captured at meaningful moments to keep sessions useful and lightweight.
8. **Ink and Focus are recording-aware tools.** Their visual marks may be temporary, but their trace entries and evidence remain available in Narrated Session.
9. **Raw audio is optional and local by default.** The transcript and trace can survive without retaining the audio recording.
10. **Patient and sensitive information must be protected.** Sensitive fields are masked or excluded before copied context leaves the local session.

## Product model

The feature is a narrated intent layer over the existing OpenPencil canvas and history system.

```text
Narration track       what the user said
Semantic action track what the user selected or changed
Gesture track         what the user pointed at, drew, or moved
Viewport track        what portion of the canvas the user was viewing
Evidence track        screenshots and before/after state
                       |
                       v
              Editable Narrated Session
                       |
                       v
                  Copy Context
                       |
                       v
               Manual paste into Codex
```

`Cmd+C` / the C tool captures a precise semantic target. Narrated Trace captures a sequence of those targets and actions over time, together with the spoken reason behind them.

## Native toolbar integration

The feature extends the original bottom toolbar rather than replacing it.

Required controls:

- **Trace** — microphone control for record, pause, resume, and stop.
- **Ink** — freehand visual intent annotation.
- **Focus** — temporary fading pointer ring that creates a persistent evidence marker.
- Existing C selection, shape, screenshot, move, and interaction tools remain intact and become trace-aware.

Active recording state:

```text
[C] [Shape] [Screenshot] [Ink] [Focus]   [red dot] [waveform] 02:14 [Pause] [Stop]
```

Recording must always have an unmistakable visual indicator. Stopping the recording opens or focuses Narrated Session; it does not send or copy anything automatically.

## Capture contract by action

| User action | Trace information |
| --- | --- |
| C-tool selection | Timestamp, stable node ID, component/container path, route, frame, bounds, active mode, and selected state |
| Property or token edit | Target, property, token, before value, after value, edit source, and related undo entry |
| Shape creation | Type, geometry, style, layer position, underlying semantic targets, and creation time |
| Shape move or resize | Start and end geometry, target, parent/container, and resulting layout |
| Screenshot | Image reference, region, semantic targets in frame, viewport transform, route, and timestamp |
| Element drag | Target, start position, end position, parent change if any, and final state |
| Undo or redo | Referenced trace event and resulting state |
| Canvas pan or zoom | Compressed viewport keyframes rather than every raw pointer event |
| Live-app interaction | Semantic control, action, route, resulting app state, and bridge receipt when available |
| Navigation or state change | Previous route/state, next route/state, frame identity, and timestamp |

The event collector should collapse repeated hover noise and high-frequency pointer movement. It should preserve meaningful dwell, selection, drag start/end, intentional gestures, edits, and state transitions.

## Ink tool

Ink communicates intent that is difficult to express through selection alone.

Supported first-version marks:

- Freehand line
- Circle
- Arrow
- Underline
- Strike-through

Each stroke records:

- Timestamp and duration
- Vector path in canvas coordinates
- Current viewport transform and zoom
- Bounding box
- Semantic targets beneath or intersected by the stroke
- Nearby transcript segment
- Optional cropped screenshot

Ink lives in the session annotation layer by default. It does not silently modify the production page. A later action may convert a selected ink mark into a persistent canvas shape.

## Focus tool

Focus is the fast, temporary pointing tool.

### Interaction

1. Activate Focus from the bottom toolbar.
2. Hover, press, or circle over the relevant region.
3. A visible ring or soft spotlight follows the gesture.
4. On release or dwell completion, the ring fades from the canvas.
5. A persistent **Focus Capture** is added to Narrated Session at that timestamp.

### Focus Capture contents

- Cropped screenshot of the focused region
- Gesture path and bounds
- Stable IDs and semantic paths for intersected components
- Current selection
- Route, frame, viewport, zoom, and canvas coordinates
- Relevant tokens and computed layout information when available
- Nearby transcript text
- Timestamp and duration

The fading visual keeps the canvas uncluttered. The persistent timeline entry preserves what the user meant by phrases such as “this gap,” “right here,” or “this whole section.”

## Screenshot policy

Compact event metadata is recorded continuously. Visual captures occur only at useful anchors:

- Explicit screenshot action
- Completed Focus gesture
- C-tool selection held long enough to indicate attention
- Committed edit or move
- Before/after comparison requested
- Major route or application-state transition
- Manual timeline marker

Duplicate or nearly identical captures should be deduplicated. Captures should be cropped to the relevant region when possible, with an optional wider context image when spatial relationships matter.

## Narrated Session editor

Narrated Session is both the review surface and the context-cleaning surface.

### Timeline row types

- Transcript segment
- Semantic selection
- Edit receipt
- Canvas movement
- Shape event
- Ink annotation
- Focus Capture
- Screenshot
- Navigation or application-state transition
- Undo or redo
- User note

### Quick editing

Every row supports the smallest useful controls:

- **Include / Exclude** toggle
- **Remove from Context** on hover
- **Undo removal** immediately after removal
- **Restore** from a compact Removed section
- Inline transcript correction
- Add a short clarification note
- Expand details for IDs, paths, coordinates, tokens, and before/after values

Bulk actions:

- Select multiple rows
- Include selected
- Exclude selected
- Remove selected from copied context
- Restore selected
- Remove obvious noise

Timeline order remains chronological. The user may exclude, correct, merge, or annotate entries, but arbitrary reordering is avoided because it could misrepresent what happened.

### Source trace versus context draft

The system maintains two related records:

1. **Source trace** — append-only local event ledger used for recovery and replay.
2. **Context draft** — editable projection of the source trace used by Copy Context.

Removing a context row changes only the context draft. It does not:

- Undo the corresponding canvas edit
- Delete a shape or annotation from the canvas
- Rewrite the original event time
- Permanently erase the source event without a separate explicit destructive action

This separation lets the user clean the handoff aggressively without corrupting the recorded history.

## Copy Context

The primary action at the bottom of Narrated Session is:

```text
Copy Context (12 included)
```

It copies a readable Markdown brief optimized for manual paste into Codex. The clipboard output includes only entries currently marked Included.

### Clipboard structure

```markdown
# OpenPencil Narrated Context

## Intent
Increase breathing room in the patient header, preserve its shadow, and align the action row.

## Relevant targets
- DentalChart / PatientRecord / HeaderCard
- DentalChart / PatientRecord / ActionRow

## Timeline
- 00:12 — “This card needs more breathing room.”
- 00:13 — Selected HeaderCard.
- 00:16 — Changed padding from space-3 to space-5.
- 00:21 — Focused the gap between HeaderCard and ActionRow. Evidence: <local capture reference>
- 00:27 — Drew an arrow from HeaderCard toward the gap.
- 00:31 — Moved ActionRow down 24 px.

## Exact changes
- HeaderCard.padding: space-3 -> space-5
- ActionRow.y: 482 -> 506

## Evidence
- Focus capture: <local path or attachment reference>
- Before/after capture: <local path or attachment reference>
```

The copied brief also contains a local session-bundle reference when available so Codex can inspect structured JSON and evidence files from the shared workspace. Copying does not start an agent task or transmit data by itself.

### Copy preview

Before copying, the user can open **Preview Context** to see the exact Markdown that will reach the clipboard. The preview should show:

- Included event count
- Excluded event count
- Evidence count
- Approximate text size
- Sensitive-field warnings
- Missing or unavailable evidence references

## Suggested data model

```ts
type TraceSession = {
  id: string
  startedAt: string
  durationMs: number
  sourceEvents: TraceEvent[]
  contextDraft: ContextDraft
  evidence: EvidenceArtifact[]
}

type TraceEvent = {
  id: string
  atMs: number
  durationMs?: number
  kind:
    | 'transcript'
    | 'selection'
    | 'edit'
    | 'shape'
    | 'ink'
    | 'focus'
    | 'screenshot'
    | 'viewport'
    | 'navigation'
    | 'undo'
    | 'redo'
    | 'note'
  target?: SemanticTarget
  action?: ActionReceipt
  viewport?: ViewportState
  evidenceIds?: string[]
}

type ContextDraftEntry = {
  sourceEventId: string
  included: boolean
  editedText?: string
  note?: string
  mergedSourceEventIds?: string[]
}

type SemanticTarget = {
  stableId: string
  path: string[]
  route?: string
  frameId?: string
  canvasObjectId?: string
  bounds?: { x: number; y: number; width: number; height: number }
}
```

The implementation should reuse OpenPencil's existing selection, undo/history, screenshot, and semantic bridge events instead of creating a separate competing history system.

## Privacy and local-data rules

- Use Chrome on-device speech recognition when available.
- Do not require a Google Cloud API key for the local path.
- Keep raw audio off by default.
- Store captures locally until the user explicitly copies or attaches context.
- Mask password, authentication, financial, and configured patient-identity fields.
- Show a warning when an included screenshot may contain sensitive information.
- Let the user remove or recrop an evidence artifact before copying.
- Copying context should never silently upload audio, screenshots, or trace data.

## Non-goals for the first version

- Directly sending a task to Codex or another agent
- Automatically executing the narrated request
- Continuous video or full-screen recording
- Logging every raw mousemove event
- Replacing OpenPencil's native toolbar, selection model, or undo history
- Permanently modifying production with Ink or Focus annotations
- Multi-user collaborative recording
- Perfect word-level transcript timestamps

## Implementation plan

### Phase 1: Session clock and source trace

1. Define `TraceSession`, `TraceEvent`, semantic target, evidence, and context-draft contracts.
2. Add a single monotonic clock shared by transcription and editor events.
3. Create an append-only local source-event ledger.
4. Subscribe to native selection, edit, shape, screenshot, viewport, navigation, and undo/redo events.
5. Add event coalescing for pointer movement, pan, zoom, and repeated selection noise.

Acceptance criteria:

- A recorded selection and edit appear in correct chronological order.
- Every semantic event resolves to a stable target when one is available.
- Stopping and reopening a local session preserves its source trace.

### Phase 2: Trace recording controls and transcription

1. Add Trace to the native bottom toolbar.
2. Implement record, pause, resume, stop, elapsed timer, and unmistakable active state.
3. Integrate Chrome on-device `SpeechRecognition` with language-pack availability and installation handling.
4. Automatically recover recognition when the browser ends a continuous segment while the session remains active.
5. Store segment-level transcript timing and editable text.
6. Keep raw audio retention optional and disabled by default.

Acceptance criteria:

- Narration appears incrementally during recording.
- Pause stops transcript and trace capture without ending the session.
- Resume continues on the same session clock.
- Stop opens Narrated Session without sending or copying anything.

### Phase 3: Trace-aware native tools

1. Connect C-tool selection to semantic trace events.
2. Record edit receipts with property/token before and after values.
3. Record shape creation, move, resize, and deletion.
4. Record explicit screenshots and evidence metadata.
5. Record compressed viewport and element movement keyframes.
6. Link undo/redo events to the actions they affect.

Acceptance criteria:

- “This” in a nearby transcript segment can resolve to the corresponding selected object.
- Edit events preserve exact before/after state.
- Canvas movement provides useful context without flooding the timeline.

### Phase 4: Ink and Focus

1. Add Ink to the native bottom toolbar and session annotation layer.
2. Store vector strokes, bounds, intersected targets, and transcript proximity.
3. Add Focus with fading ring/spotlight behavior.
4. Generate a Focus Capture on gesture completion.
5. Crop, deduplicate, and persist evidence artifacts locally.
6. Keep visual fade state separate from trace persistence.

Acceptance criteria:

- A Focus ring disappears visually while its timeline marker and evidence remain.
- Ink strokes retain correct canvas coordinates through pan and zoom.
- The trace identifies meaningful semantic targets beneath each gesture.

### Phase 5: Editable Narrated Session

1. Build chronological timeline rows for every supported event kind.
2. Add include/exclude, remove, undo removal, restore, inline correction, and clarification notes.
3. Add bulk cleanup actions and a Removed section.
4. Keep the source trace immutable while editing the context draft.
5. Add filters for Speech, Selections, Changes, Gestures, Evidence, Navigation, and Removed.
6. Add click-to-return behavior for selectable targets and saved viewport states.

Acceptance criteria:

- Removing a context row does not alter the canvas or source trace.
- Removed entries can be restored.
- Transcript correction changes copied text while retaining the original locally.
- Timeline order remains truthful and chronological.

### Phase 6: Preview Context and Copy Context

1. Generate concise Markdown from included context-draft entries.
2. Group targets, exact changes, narration, and evidence without losing timestamps.
3. Add Preview Context showing the exact clipboard payload.
4. Add `Copy Context (N included)` and a copied-state confirmation.
5. Include local structured-session and evidence references where accessible.
6. Add sensitive-content checks and missing-evidence warnings.

Acceptance criteria:

- Pasting into Codex produces a self-contained, readable request.
- Excluded entries never appear in the clipboard payload.
- Corrected transcript text appears instead of the original transcription.
- Copying performs no network request and starts no agent task.

### Phase 7: Verification and hardening

1. Test against the real live application frame in Frame, Select, and Interact modes.
2. Verify stable selection identity through canvas movement and route changes.
3. Measure long-session memory, storage, screenshot, and transcript behavior.
4. Test language-pack absence, microphone denial, recognition interruption, and unavailable evidence.
5. Test sensitive-field masking and screenshot recropping.
6. Verify that ordinary OpenPencil work remains unchanged when Trace is inactive.

## First shippable slice

The smallest useful release is:

1. Trace record/pause/stop in the native toolbar.
2. Local segment-level transcription.
3. C selections, edits, screenshots, and viewport changes on one timeline.
4. Editable Narrated Session with include/exclude, remove, restore, and transcript correction.
5. Preview Context.
6. Copy Context as readable Markdown for manual paste into Codex.

Ink and Focus can follow immediately after the trace and context-draft architecture is proven, but their event types and evidence model should be included in the initial data contract so the idea does not drift.

## Success definition

The feature succeeds when a user can speak naturally while working, point to “this” or “that,” make several changes across the canvas, clean the resulting session in seconds, copy it into Codex, and have the agent accurately understand:

- What the user was trying to accomplish
- Which exact components and areas they meant
- What they changed themselves
- What visual evidence supports the request
- What remains for the agent to do

