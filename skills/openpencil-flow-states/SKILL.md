---
name: openpencil-flow-states
description: Build and organize guided OpenPencil user-flow boards where real production states run horizontally and safe edit versions branch vertically from each state. Use when a user asks to map a journey, create connected screen states, add loading/error/success states, explore alternate designs for individual steps, or make a board that visually teaches the user how the flow and its versions work.
---

# OpenPencil Flow States

Build two related structures on one board: the user journey across the canvas and the edit-version branches underneath each journey state.

Use `$openpencil-design-director` before drawing to choose the Overview, Focus, and Compare projections. A flow may span separate top-level sections; do not force detailed screens, knowledge content, and review content into one mega-board.

## Mandatory guide-first rule

Before creating or rearranging flow states, place a polished guide section on the board. The guide must teach the model at a glance:

- horizontal direction = journey progression
- vertical direction = drafts and alternate designs
- production/reference states remain protected
- the selected frame becomes live; inactive states may remain lightweight previews
- review and change-set status are explicit

Do not leave the user with an unlabeled cluster of frames. The guide is part of the product experience, not disposable documentation.

The result must look like a professional product-flow review board. Correct state metadata alone is not enough.

## Workflow

1. Resolve scope.
   - Identify the owning Page/Workspace, source route, start state, end state, and key success/error paths.
   - Inspect existing frames, connectors, versions, and user-created layout before adding anything.

2. Create the visual guide.
   - Add a concise title and one-sentence purpose.
   - Add a legend: `Flow goes across` and `Versions branch down`.
   - Include a miniature three-state example with one alternate branch.
   - Add a `Start here` cue on the source/reference state.
   - Use native tokens, readable hierarchy, restrained color, generous spacing, and no wordy custom panel.
   - Keep the guide to roughly the top 15-22% of the visible composition so it teaches without overpowering the screens.

3. Lay out the production journey.
   - Place real linked screen/state frames left to right.
   - When a state is an HTML board, link the exact board revision rather than a mutable latest-state alias or a lossy reconstruction.
   - Use named transitions and directional connectors.
   - Keep state names concrete: `Current`, `Exam Setup`, `Active Charting`, `Review`.
   - Add modal/loading/empty/error/success as states owned by their triggering step unless they are canonical pages.
   - Use one consistent state-card width, header band, preview viewport, padding system, and baseline alignment.
   - Preserve recognizable product content, density, navigation, and hierarchy inside every state preview.
   - Use transition labels only where they add information; keep connectors orthogonal, short, and free of crossings.

4. Add edit versions to each state.
   - Use `$openpencil-edit-versions` for every Draft or Alternate.
   - Place versions in a vertical stack beneath their source state.
   - Preserve parent/source/version identity and avoid disconnected copies.

5. Add decision status.
   - Use compact pills for Draft, Alternate, Preferred, In Review, Approved, and Archived.
   - Mark preferred variants without removing other useful directions.
   - Use one restrained semantic palette: neutral production, blue current/flow, violet draft/alternate, amber review/loading, green approved/success, gray archived.

6. Make the board navigable.
   - Page folders expand without unexpectedly changing the canvas.
   - `Current` fits the full production-plus-flow composition.
   - Selecting a specific state focuses that frame.
   - Keep connectors, frame headers, Layers, and inspector selection synchronized.

7. Run the visual refinement pass.
   - Inspect the board at fit-to-board zoom and again at a readable screen-review zoom.
   - Check hierarchy, alignment, padding rhythm, screen fidelity, connector routing, status contrast, label truncation, and unused space.
   - Run overlap/color/type/spacing analysis when available.
   - Export the guide and primary flow composition, inspect the images, and revise at least once before completion.

8. Verify the flow.
   - Walk every connector from start to finish.
   - Activate each state and confirm the real container hierarchy is selectable.
   - Reopen version branches and confirm their edits persist.
   - Resolve every HTML-board revision reference and flag stale or missing snapshots before review.
   - Check guide readability at the default fit-to-board zoom.
   - If the live runtime is unavailable, label every substitute screen `Illustrative preview` and report that limitation.

## Tool fallback

Use `$openpencil-agent-bridge` for semantic board commands. If only stock scene-graph tools are available, they may create the guide visuals, but do not claim that frames are real live states until route, scenario, and workspace identities are attached.

## Completion report

Report the guide created, flow states, transitions, per-state versions, preferred/review status, navigation checks, and missing runtime or source-bridge capability.

Read [references/board-guide-spec.md](references/board-guide-spec.md) and [../openpencil-agent-bridge/references/visual-quality.md](../openpencil-agent-bridge/references/visual-quality.md) before designing the guide or laying out a flow.
