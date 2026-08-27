# Work Map sub-bot folder shelf — design QA

## Evidence

- Source visual truth: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-sub-bot-folders/source-expanded.png` — the annotated live Board context with Smylr Clinic Rollout expanded.
- Rendered implementation: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-sub-bot-folders/final-collapsed-folder.png` — the same Board after closing Smylr Clinic Rollout into Dental Chart's shelf.
- Full-view comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-sub-bot-folders/source-vs-final.png`.
- Focused comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-sub-bot-folders/source-vs-final-focus.png`.
- Viewport: 771 × 822 CSS px at device pixel ratio 2. Both browser screenshots are 771 × 822 pixels from the same capture surface, so no density normalization was required.
- State: the source is intentionally the expanded problem state and the implementation is the requested collapsed target state. Surrounding Board, parent Bot, sidebars, theme, zoom, and content are otherwise unchanged.

## Full-view and focused comparison

The full comparison shows that closing the sub-bot removes its large spatial workspace and all child content while leaving the parent Dental Chart space intact. The closed representation is a compact tile inside the readable bottom edge of Dental Chart, not a new sidebar tree or floating dashboard. The focused comparison confirms the original frame area returns to the normal dotted Board and the tile remains readable beside the open Work Map sidebar.

## Findings

No actionable P0, P1, or P2 issue remains.

- Fonts and typography: the tile uses the existing 11px Board-label hierarchy with a 9px muted parent/content summary; the name remains the first readable line.
- Spacing and layout rhythm: closed siblings pack left-to-right in 228 × 48 tiles, wrap upward, stay 16px inside the readable parent boundary, and preserve an 8px gap.
- Colors and visual tokens: the tile reuses the existing chrome, border, component-accent, hover, focus, and muted tokens. Its directory shortcut is hover/focus-only.
- Image quality and assets: the existing Lucide stacked-panels and chevron icons are used; no raster, custom SVG, placeholder, or CSS-drawn icon was introduced.
- Copy and content: the tile names `Smylr Clinic Rollout`, its parent `Dental Chart`, and the live `4 objects · 2 chats` summary.
- Interaction: the whole tile reopens the workspace, reopening restores the exact prior frame position, closing folds it away again, hidden children do not receive clicks, and no new console warning or error appeared during the final open/close cycle.

## Comparison history

1. P1: the first shelf placement used the parent's absolute left edge and landed beneath the open Work Map sidebar. Fix: pack against the readable intersection of the parent and canvas.
2. P1: the first collapsed presentation left a large opaque empty rectangle where the sub-bot had been. Fix: move the frame and its descendants only in the presentation layer while preserving authoritative geometry, allowing the normal Board grid to remain visible.
3. Post-fix evidence: the final full and focused comparisons show one visible compact tile, no residual frame cover, and no hidden child content.

## Validation

- Focused layout unit tests: 4 passed, 0 failed.
- Focused browser interaction test: 1 passed, 0 failed.
- Targeted lint: passed.
- Vue type check reached only existing unrelated automation-bridge and demo/variant errors; no changed Work Map file was reported.

final result: passed

# Work Map project frame cleanup — design QA

## Evidence

- Source visual truth: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/fluid-project-territory/live-normal-frame.png` — the prior filled normal Frame.
- Revised implementation screenshot: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/fluid-project-territory/live-dashed-frame.png`.
- Side-by-side comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/fluid-project-territory/filled-vs-dashed-frame.png` — filled source on the left, transparent dashed result on the right.
- Viewport and state: both captures are 1280 × 720 CSS px with the exact Dental Chart project Frame fitted and resting without selection, detach, or acceptance decoration. The shared app changed from light to dark between captures; geometry and boundary styling were therefore also verified directly in the live DOM. A focused browser regression separately covers title/edge drag, double-click focus, and the title-to-sidebar handoff.

## Comparison history

1. The previous implementation used large asymmetric radii around the whole perimeter, which read as a permanent bubble.
2. The normal uniform radius remains, but the project surface no longer paints any background behind its Board contents.
3. The boundary is now always dashed, with a zoom-compensated one-screen-pixel stroke so its dash rhythm remains visible while fitted or zoomed. Edge insets and directional corner stretch still respond during a move, then settle back after release.

## Findings

No actionable P0, P1, or P2 difference remains for the requested cleanup. The current resting silhouette reads as a transparent project boundary rather than a filled panel; the top-line project name remains legible, its adjacent sidebar action appears only on hover or keyboard focus, and the dashed stroke stays quiet against the Board grid.

## Code-side validation

- Resting geometry resolves to one uniform `32px` radius for the live large Frame; a smaller representative Frame resolves to a uniform `18px` radius.
- Drag overflow, direction bias, and movement are the only sources of asymmetric insets or corner stretch.
- The live DOM reports one project overlay, dashed border, transparent `rgba(0, 0, 0, 0)` background, `32px` radius, the label `Dental Chart`, its `Open Dental Chart directory in sidebar` action, and no detach-ready state.
- The inline border width resolves from the current zoom so the transformed result stays approximately one CSS pixel on screen.
- The radial accent, blur, selection/acceptance shadows, status dot, and helper copy are gone.
- Child-object hit testing remains available inside the Frame; only the visible title and a 12px edge corridor claim project-frame movement. The focused browser fixture places a real Code Object flush against the Frame's top edge, proving the higher project-chrome layer receives hover and press while the Code Object still owns interior clicks.
- Focused geometry and detach tests: 3 passed, 0 failed. The focused browser regression also passed the title drag, edge drag, double-click focus, closed-sidebar reopen, Work Map switch, and exact-directory expansion path. Targeted lint and diff checks passed.
- The live app compiled without an error overlay for the final capture.

## Required fidelity surfaces

- Fonts and typography: the project name keeps the prior compact typography; one panel icon appears directly beside it on hover or keyboard focus without creating a second label row.
- Spacing and layout rhythm: the comparison shows a conventional rectangular boundary with uniform resting corners.
- Colors and visual tokens: a quiet dashed theme-token border is the only project-region paint; the surface background is fully transparent.
- Image quality and asset fidelity: real Board children remain unchanged; no new or substituted assets.
- Copy and content: `Dental Chart` remains the project label; the icon has the explicit accessible name `Open Dental Chart directory in sidebar`.

## Implementation checklist

- [x] Remove the permanent blob/bubble contour from the resting geometry.
- [x] Remove the project-region background, keep the flat name seam, and use a visible dashed boundary.
- [x] Preserve fluid stretch as a movement-only cue.
- [x] Preserve movement, membership, destination adoption, detach, and Undo behavior.
- [x] Make the title and dashed edge easy Frame selection and movement targets without blocking child objects.
- [x] Match normal-object double-click focus and add the exact-directory sidebar action.
- [x] Run focused tests and targeted lint.
- [x] Capture and compare the revised live resting state.

## Follow-up polish

- None required for the requested interaction cleanup.

final result: passed

# Inbox briefing single-line header — design QA

## Evidence

- Source visual truth: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-code-object/structured-code-object-after.png`.
- Revised implementation: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-header-cleanup/after.png`.
- Full-view comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-header-cleanup/before-vs-after-full.png`.
- Focused header comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-header-cleanup/before-vs-after-header.png`.
- Source and implementation are 1280 × 720 pixels at a 1280 × 720 CSS viewport and device scale factor 2. No density normalization was needed because both browser captures share the same dimensions and density.
- State: dark theme, Work Map open, Inbox expanded, and the same completed briefing open in the right Object panel.

## Findings

No actionable P0, P1, or P2 difference remains for the requested header cleanup.

- Fonts and typography: the linked briefing title remains the only header label and keeps the existing 12px product type treatment; the redundant uppercase eyebrow is gone.
- Spacing and layout rhythm: the header is one quiet 40px row, with no document-icon slot and no bottom divider.
- Colors and visual tokens: the existing surface and muted Message action remain unchanged.
- Image quality and assets: no image asset changed; the redundant document icon was removed as requested.
- Copy and content: `Morning Email Check Assistant briefing` and `Message` are preserved exactly.
- Interaction checked: opening the briefing from its Inbox receipt still reveals the same Code Object and Message action.
- Focused checks passed: 5 tests, 0 failures.

## Comparison history

- Earlier P2: the header repeated `Briefing`, showed a document icon, and separated itself from the Object with a divider.
- Fix: reduced the component header to the linked title plus Message action and removed the icon and divider classes.
- Post-fix evidence: the focused comparison shows one title line with the Object content beginning directly beneath it.

## Follow-up polish

- None required for this requested slice.

final result: passed

# Bot chat reactions and linked scheduled results — design QA

## Evidence

- Existing transcript baseline: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/bot-chat-reactions/chat-keyboard-open.png`.
- Reaction picker: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/bot-chat-reactions/reaction-picker.png`.
- Selected reaction: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/bot-chat-reactions/reaction-love-selected.png`.
- Scheduled-result bar with its existing Object surface: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/bot-chat-reactions/scheduled-linked-result-visible.png`.
- Viewport: 1440 × 900 CSS pixels, dark theme, live Work Map conversations.

## Findings

No actionable P0, P1, or P2 difference remains for this slice.

- Reactions stay quiet until a message is hovered or focused. The picker uses the app's existing popover primitive and existing Lucide icon set.
- Like, Love, and Smile are stored as semantic reaction events with actor, channel, timestamp, and stable structured conversation/message identity. The selected reaction renders as a small count pill and survives reload.
- A scheduled briefing reuses `AiBoardChanges` as a direct linked-result variant rather than adding a parallel card system. One click opens the existing read-only Object surface.
- Existing activity, approval, file-change, generated-media, Board-change, Todo, and Plan surfaces remain unchanged.
- The Bot setup context now asks for short, natural texting rhythm while preserving structured approvals, results, code, and handoffs.

## Validation

- Live picker opened through pointer interaction; all three reactions were accessible as named buttons.
- Love was selected, rendered with a count of one, survived a full page reload, and was then removed so no test reaction was left in user state.
- The scheduled result appeared twice at the two matching scheduled-run chapters. Closing the Object panel and selecting the visible linked bar reopened the exact briefing.
- Browser console errors after the final interactions: none.
- Focused reaction, Inbox-link, and Bot-setup tests: 7 passed, 0 failed. Targeted formatting, lint, and diff checks passed for the new reaction and linked-result files.

final result: passed

# Inbox briefing click and hover controls — design QA

## Evidence

- User-captured briefing Object: `/var/folders/3p/1nb1q9rs4876lqrmh50kh6700000gn/T/TemporaryItems/NSIRD_screencaptureui_dXHvAW/Screenshot 2026-08-26 at 10.56.56 PM.png`.
- Rendered receipt-to-Object result: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-click-hover/receipt-object-after.png`.
- Combined source and implementation review: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-click-hover/source-vs-implementation.png`.
- Final structured Code Object: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-code-object/structured-code-object-after.png`.
- Final raw-prose versus structured-Code-Object review: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-code-object/source-vs-structured-code-object.png`.
- Rest and scheduled-row hover comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/inbox-briefing-click-hover/rest-vs-hover.png`.

## Findings

- The selected Inbox receipt opens its exact chat message and the same run's read-only briefing in the right Object panel.
- The briefing is a preset-backed, read-only Code Object with a structured title, summary, sections, and items. It keeps the compact `Briefing` header and `Message` return action and does not require a Board placement.
- The stale `Botso briefing` label now follows the current renamed chat and Inbox title; the rendered implementation shows `Morning Email Check Assistant briefing` in the panel header.
- The schedule briefing control is absent at rest, becomes interactive on row hover or keyboard focus, and preserves its accent color when briefing creation is enabled.
- Older receipts without a briefing remain message-only instead of inventing a missing Object.
- Focused report parsing, Code Object materialization, navigation, UI, right-panel, routine presentation, and scheduler checks passed: 36 tests, 0 failures.

## Visual QA result

The combined review confirms the requested content has been upgraded from the user capture's dense prose into a legible Code Object hierarchy. Legacy Markdown markers are normalized before rendering. Theme differences reflect the two captured app themes. The hover comparison confirms the requested quiet resting state and visible action state without shifting the row.

final result: passed

# Work Map Inbox ordering — design QA

## Evidence

- Selected reference: the user-marked 874 × 822 Work Map screenshot with Inbox below the Bot directories and the instruction to return it to the top.
- Corrected live capture: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-inbox-top/live.png`.
- State compared: dark Work Map, Inbox expanded, Dental Chart expanded, and the same surrounding Board workspace.

## Findings

Inbox now sits immediately below the Work map header and before every Bot directory. The existing count, receipt rows, disclosure motion, hover actions, spacing, typography, and icons are unchanged. No P0, P1, or P2 visual issue remains.

## Validation

- Live DOM order: `Inbox → Dental Chart → Work Map → work work → Smylr Clinic Rollout → Misc chats`.
- Focused regression and Work Map contract: 10 passed, 0 failed.
- The original Inbox behavior remains intact; only template order changed.

final result: passed

# Work Map Bot identity and inline jobs — design QA

## Evidence

- Original annotated-state capture: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/before.png`
- Latest pre-alignment source state: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/inline-jobs.png`
- Final resting state: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/aligned-avatar.jpg`
- Final project-hover state: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/project-hover.jpg`
- Final inline-jobs state: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/inline-jobs-aligned.jpg`
- Full source/final comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/inline-jobs-comparison.jpg`
- Focused source/final comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/inline-jobs-focus-comparison.jpg`
- Interaction-state comparison: `/Users/omar/Developer/Open Pencil Local 2026-08-26/.artifacts/work-map-bot-ux/interaction-comparison.jpg`
- CSS viewport: 894 × 822 px at device pixel ratio 2.2.
- Source and implementation rasters: 895 × 822/823 px; the source was normalized by one vertical pixel to match the browser's fractional viewport rasterization.
- States: Dental Chart expanded; Bot jobs closed, project actions hovered, and Bot jobs expanded inline.

## Combined comparison evidence

The pre-alignment and final inline-jobs states were normalized to the same 895 × 823 raster and reviewed together. The project Bot moved from a nested tree branch to the same leading row edge as Todo and In motion. Its connector line is gone, its avatar is visibly larger, and the jobs card still opens directly below the Bot without introducing a modal or dashboard-like chrome.

The original annotated state and final resting state were also reviewed together. The project-level Bots header and row-level cadence/date/time were removed. The Bot identity remains scannable through a distinct raster avatar and title, while schedule details remain available only inside the jobs disclosure.

## Findings

No actionable P0, P1, or P2 difference remains for the requested Work Map changes.

- Typography and copy: Bot rows show only the Bot title. Cadence and time appear inside the corresponding job item.
- Spacing and hierarchy: the project Bot, Todo, and In motion rows share the same row x-coordinate. The Bot avatar container and both status-icon containers share the same x-coordinate.
- Avatar scale: the Bot avatar renders at 28 × 24 px; Todo and In motion icons render at 18 × 18 px.
- Assets and motion: seven real raster Bot variants are wired to stable persisted assignments. Idle motion waits a random 20–60 seconds between plays, pauses in hidden tabs, and respects reduced-motion preferences.
- Jobs behavior: the disclosure opens inline, contains the Bot's prompt and cadence, supports run/delete/add actions, and creates no dialog.
- Project actions: hover reveals Board, directory, Bot, and chat actions. The requested three creation actions are ordered directory → Bot → chat and use equal 24 px controls.
- Color and visual language: existing Work Map tokens, muted hierarchy, hover treatment, radii, and icon library remain unchanged.

## Browser and validation record

- Live Bot-row text: `Morning Email Check Assistant`; no cadence, date, or time is present in the closed row.
- Live expanded content includes the routine prompt and `Daily · Aug 27, 8:00 AM`; dialog count is zero.
- Current live Bot variants are distinct (`1` and `0`). Backend tests prove least-used allocation and persisted migration across all seven variants.
- Live alignment: project Bot, Todo, and In motion rows begin at x = 32.90 px; Bot avatar and status-icon containers begin at x = 40.89 px.
- Live hover action x positions: directory 206.29 px, Bot 230.29 px, chat 254.29 px.
- Focused unit contracts: 23 passed, 0 failed across Work Map UI and persistence.
- Focused browser tests: 2 passed, covering inline Bot jobs/avatar geometry and project-hover action order.
- Targeted lint passed. The full Vue type check reports only existing missing automation-bridge modules and existing demo/variant API errors; none reference the changed Work Map files.
- Live browser console check returned no errors after reload.

## Implementation checklist

- [x] Remove cadence and time from Bot rows.
- [x] Replace the scheduling popup with an inline jobs disclosure.
- [x] Remove the nested project Bots label.
- [x] Add stable seven-variant Bot avatars with intermittent idle motion.
- [x] Add project-hover Bot creation between directory and chat.
- [x] Remove the Bot branch line and align the row with status rows.
- [x] Make the Bot avatar visibly larger than Todo and In motion icons.
- [x] Verify source/final comparisons, live DOM geometry, interaction states, unit contracts, and focused browser behavior.

## Follow-up polish

- None required for the requested changes.

final result: passed

# Work Map standalone-chat cleanup — design QA

> Superseded by the later user correction that restores standalone conversations under a single **Misc chats** section while keeping every project section limited to Bots, Todo, and In motion. Current rendered evidence: `/Users/omar/Documents/Open Pencil/artifacts/product-design/work-map-misc-restored.png`.

## Evidence

- Source visual truth: `/Users/omar/Documents/Open Pencil/artifacts/product-design/work-map-chat-source.png`
- Normalized source: `/Users/omar/Documents/Open Pencil/artifacts/product-design/work-map-chat-source-normalized.png`
- Rendered implementation: `/Users/omar/Documents/Open Pencil/artifacts/product-design/work-map-chat-free-after.png`
- Focused source region: `/Users/omar/Documents/Open Pencil/artifacts/product-design/work-map-chat-source-sidebar.png`
- Focused implementation region: `/Users/omar/Documents/Open Pencil/artifacts/product-design/work-map-chat-free-after-sidebar.png`
- CSS viewport: 890 × 821 px
- Source pixels: 1280 × 1181 px; normalized to 890 × 821 px to match the CSS viewport.
- Implementation pixels: 890 × 821 px at device scale factor 1.
- Focused region: the leftmost 295 × 821 px Work Map sidebar in both normalized images.
- State: dark Work Map; Dental Chart and its Work Map child expanded; no search, hover, focus, or active drag state.

## Full-view comparison evidence

The full-view pair was reviewed together after matching the source and implementation to the same 890 × 821 raster size. The requested change is visible and isolated: the six standalone Dental Chart chat rows and their annotation overlay are absent, so project content begins directly with Bots, Todo, and In motion. The sidebar shell, project order, typography, status colors, icons, row geometry, and surrounding editor composition remain consistent. The additional lower project content is the expected result of removing the loose rows rather than a density change.

The implementation canvas contains an unrelated Smylr-runtime-unavailable band behind the translucent sidebar. It is board-background state, not Work Map content, and was excluded from the sidebar fidelity judgment.

## Focused region comparison evidence

The 295 × 821 sidebar crops were reviewed together at 1:1. The focused comparison makes the hierarchy readable enough to verify the important details: Dental Chart now flows directly into Bots, Todo, and In motion; the previous loose chat labels, status dots, and fallback Misc surface do not appear. Existing label sizes, weights, indentation, guide rails, icons, and empty-state copy remain internally consistent.

## Findings

No actionable P0, P1, or P2 differences remain for the requested Work Map cleanup.

- Fonts and typography: unchanged system UI family, weights, label scale, line height, truncation, and hierarchy.
- Spacing and layout rhythm: the removed chat block closes cleanly; categorized groups occupy the released space without gaps, overlap, clipping, or extra chrome.
- Colors and visual tokens: sidebar, muted text, status accents, guide rails, and hover-neutral resting state remain consistent with the source.
- Image quality and asset fidelity: project tray rasters and interface icons remain sharp at the rendered size; no assets were replaced or approximated.
- Copy and content: standalone chat titles are gone; only Bots and categorized Todo/In motion work appear under projects, with existing empty-state copy preserved.
- Accessibility and behavior: the Work Map navigation remains semantic; live DOM checks found zero loose chat rows, zero raw thread test nodes, and zero Misc row. Focused browser tests cover categorized-row interaction and standalone-chat absence.

## Open questions

- None for this change. The board background's unavailable Smylr runtime is an environment issue outside the Work Map projection.

## Comparison history

- Pass 1: compared the normalized browser-comment source and rendered implementation in one full-view input, then compared matching 295 × 821 sidebar crops in one focused input. No P0/P1/P2 finding was identified, so no visual correction iteration was required.

## Browser and validation record

- Primary interaction tested: returned from a selected conversation to the Work Map.
- Rendered hierarchy readback: Dental Chart → Bots → Todo → In motion; Work Map → Bots → Todo → In motion.
- Absence checks: `Remove Board Layers Header` count 0; raw thread-row count 0; Misc-row count 0.
- Console checked: one existing local-authority fetch error from narrated-trace history was present; it did not affect the Work Map hierarchy or this implementation.

## Implementation checklist

- [x] Remove standalone chat projection from project entries.
- [x] Remove the fallback Misc chat surface and pagination.
- [x] Keep Bots and categorized Todo/In motion content intact.
- [x] Verify unit contracts, focused browser behavior, rendered DOM, and visual evidence.

## Follow-up polish

- None required for the requested cleanup.

final result: passed

# Agent turn Board changes — design QA

## Evidence

- Selected collapsed concept: `/Users/omar/Documents/Open Pencil/artifacts/product-design/turn-board-changes-collapsed.png`
- Selected expanded concept: `/Users/omar/Documents/Open Pencil/artifacts/product-design/turn-board-changes-expanded.png`
- Browser-rendered collapsed implementation: `/Users/omar/Documents/Open Pencil/artifacts/product-design/turn-board-changes-collapsed-implementation.png`
- Browser-rendered expanded implementation: `/Users/omar/Documents/Open Pencil/artifacts/product-design/turn-board-changes-expanded-implementation.png`
- Combined collapsed comparison: `/Users/omar/Documents/Open Pencil/artifacts/product-design/turn-board-changes-collapsed-comparison.png`
- Combined expanded comparison: `/Users/omar/Documents/Open Pencil/artifacts/product-design/turn-board-changes-expanded-comparison.png`
- Browser viewport: 782 × 821 px.
- State: dark agent conversation, three completed Board changes, no selected object row.

## Combined comparison evidence

The selected concept and browser-rendered implementation were normalized to the same 782 × 821 viewport and reviewed together in one image for each state. The implementation keeps the chosen hierarchy: a quiet one-line `3 Board changes` disclosure between the settled work row and the final answer, followed by an unboxed, compact list only when expanded. The list retains restrained type icons, plain object names, and right-aligned Created or Edited labels.

The source mock was generated at a different aspect ratio, so its left conversation panel occupies a smaller percentage after normalization. The implementation keeps the live OpenPencil conversation width from the user-marked 782 × 821 screen rather than copying that generation artifact. Typography, row density, muted colors, and the absence of card chrome match the selected direction.

Inline Board links are an intentional addition from the user's follow-up. They use the existing accent-link language and do not introduce a second card, badge strip, object ID, or persistent selected-row treatment.

## Findings

No actionable P0, P1, or P2 visual difference remains for the selected collapsed and expanded states.

- Typography: existing agent-chat type scale, weight, and line height are preserved.
- Spacing: 32 px disclosure and object rows keep the result compact and readable.
- Color: the resting state remains neutral; accent is reserved for clickable object names and keyboard focus.
- Icons: the disclosure uses Layers; rows use Text, Image, Frame, or fallback Object icons from the existing Lucide set.
- Accessibility: the disclosure exposes `aria-expanded` and `aria-controls`; Escape collapses it and restores focus. Every row and inline reference has a specific Board-navigation label.
- Behavior: successful `board_apply` receipts determine the objects. Hover highlights a visible object; click switches to the owning page when needed, selects the object, and reveals it within editor insets.

## Browser and validation record

- Collapsed browser state: one `3 Board changes Show` control; zero object rows.
- Expanded browser state: one expanded disclosure and three `Show … on Board` rows with Created or Edited labels.
- Keyboard check: Escape changed `aria-expanded` to `false` and removed all three rows.
- Focused contracts: 22 tests passed across receipt parsing, turn grouping, first-mention text linking, and page-switch/select/reveal navigation.
- Type checks: root Vue application and `packages/vue` both passed.
- The visual fixture imports the production `AiBoardChanges` component and application theme. Its surrounding prompt, response, and composer are representative chat context used only to capture the two selected states.

## Implementation checklist

- [x] Default to the collapsed state selected in concept 1.
- [x] Expand inline to the simple object list selected in concept 2.
- [x] Keep Created and Edited semantics without IDs or thumbnails.
- [x] Link changed object names in the final response automatically.
- [x] Highlight on hover and select/reveal on click.
- [x] Preserve file-change behavior and existing chat chronology.
- [x] Verify browser states, keyboard behavior, focused contracts, and combined visual evidence.

final result: passed

# Work Map standard tree endpoint — design QA

## Evidence

- User-marked source visual: `/var/folders/3p/1nb1q9rs4876lqrmh50kh6700000gn/T/TemporaryItems/NSIRD_screencaptureui_bBasYa/Screenshot 2026-08-26 at 3.01.10 PM.png`
- Same-state pre-fix crop: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-tree-terminal-stem-before.png`
- Rendered implementation: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-standard-tree-final-full.png`
- Focused implementation crop: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-standard-tree-final-focus.png`
- Pixel inspection crop: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-standard-tree-final-elbow-zoom.png`
- Reference implementations: Quasar `QTree.sass`, ILSpy `TreeLines.cs`, and Lichess `_tree.scss` at the source revisions recorded in the comparison history below.
- CSS viewport: 782 × 821 px at device pixel ratio 2.
- Source pixels: 86 × 204 px.
- Implementation pixels: 782 × 821 px; focused crop 38 × 98 px; nearest-neighbor elbow inspection 384 × 416 px.
- State: dark Work Map with Dental Chart expanded and three populated In motion rows visible.

## Full-view comparison evidence

The live Work Map was captured after a fresh reload. Project order, icons, labels, row heights, task truncation, status indicators, and dark-mode hierarchy contrast remain unchanged. The only visible change is connector construction: each row now owns its trunk segment, adjacent 32 px rows meet edge to edge, and the terminal row is shortened before the rounded turn.

## Focused region comparison evidence

The user-marked source and the final terminal elbow were opened together. The source shows the unwanted straight stem continuing into the final turn. In the final pixel enlargement, the trunk ends exactly where the 6 px curve starts, the curve reaches the 12 px horizontal branch, and no connector pixel appears below the horizontal branch.

Computed geometry confirms the visible result. The first two populated rows each own a full 32 px trunk. The final row owns a 10 px trunk, followed by a rounded elbow at `top: 10px` with `height: 6px`; the branch baseline remains centered at 16 px.

## Findings

No actionable P0, P1, or P2 difference remains for the requested endpoint.

- Fonts and typography: unchanged.
- Spacing and layout rhythm: 32 px populated rows, 28 px placeholder rows, 12 px branch reach, and 6 px curve radius are preserved.
- Colors and visual tokens: the existing `work-map-tree` token remains `rgb(56, 56, 62)` in dark mode.
- Image quality and asset fidelity: no image or icon asset changed; the focused raster verifies the native browser stroke.
- Copy and content: unchanged.
- Accessibility and behavior: semantic rows, keyboard handling, drag behavior, empty states, and menus are unchanged; only decorative pseudo-elements changed.

## Comparison history

- Earlier implementation: a lane-owned shared spine continued to the final branch while the branch itself carried a half-row left border. Moving the shared spine upward did not remove the straight terminal segment painted by the branch.
- Reference pass: Quasar's tree connector puts the branch on the row, ILSpy explicitly shortens the last child's vertical to its elbow, and Lichess shortens the final branch element instead of masking the overflow.
- Final implementation: replaced the shared spine with edge-to-edge row-owned trunk segments. Non-terminal rows run full height; the last row stops at the start of its rounded elbow. The post-fix crop shows no terminal stem.

Reference source URLs:

- `https://github.com/quasarframework/quasar/blob/29a1657f/ui/src/components/tree/QTree.sass`
- `https://github.com/icsharpcode/ILSpy/blob/b153291c/ILSpy/Controls/TreeLines.cs`
- `https://github.com/lichess-org/lila/blob/38c207e6/ui/lib/css/tree/_tree.scss`

## Browser and validation record

- Primary visual state: Dental Chart → In motion → three contiguous task rows.
- Populated geometry: row heights 32/32/32 px; trunk heights 32/32/10 px; elbow top 10 px; elbow height 6 px; radius 6 px.
- Focused connector contract: 1 test passed, 0 failed, 13 assertions.
- Adjacent Work Map view tests passed. The broader shared UI-contract file still has one unrelated pre-existing assertion for an inline `create_bot` operation that has moved out of this component.
- Console review: concurrent app work still emits existing Vue setup/toolbar warnings and unrelated `attachments`/scheduler errors; no connector-specific runtime error appeared and the Work Map remained rendered and interactive.

## Implementation checklist

- [x] Use the established row-owned tree connector pattern.
- [x] Keep non-terminal trunk segments continuous across row boundaries.
- [x] Stop the last trunk at the beginning of the rounded elbow.
- [x] Preserve curved branches, empty placeholders, and dark-mode contrast.
- [x] Verify source evidence, primary reference implementations, computed geometry, live pixels, and the focused contract.

## Follow-up polish

- None required for this correction.

final result: passed

# Work Map continuous tree terminal — design QA

## Evidence

- Source visual truth: `/var/folders/3p/1nb1q9rs4876lqrmh50kh6700000gn/T/TemporaryItems/NSIRD_screencaptureui_bBasYa/Screenshot 2026-08-26 at 3.01.10 PM.png`
- Rendered implementation: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-solid-tree-v6-no-tail-full.png`
- Focused implementation crop: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-solid-tree-v6-no-tail-focus.png`
- Pixel inspection crop: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-solid-tree-v6-no-tail-pixel-zoom.png`
- CSS viewport: 890 × 821 px at device pixel ratio 2.
- Source pixels: 86 × 204 px.
- Implementation pixels: 890 × 821 px; focused crop 62 × 136 px.
- State: dark Work Map with Dental Chart expanded and three populated In motion rows visible.

## Full-view comparison evidence

The final browser render was reviewed against the supplied close-up after a fresh reload. The project hierarchy, task labels, and lane spacing remain unchanged. The adjustment is isolated to the populated-lane endpoint: the shared vertical spine now stops one CSS pixel above the final branch baseline, and the final row's curved border completes the connection.

## Focused region comparison evidence

The focused crop and a nearest-neighbor pixel enlargement were reviewed together. The vertical stroke remains continuous through all three row junctions, every task receives one rounded elbow, and the last elbow is the visible endpoint. There is no vertical stroke below the last horizontal branch. The computed dark-mode connector color is `rgb(56, 56, 62)`, preserving the stronger contrast requested in the prior pass.

## Findings

No actionable P0, P1, or P2 differences remain for the requested connector endpoint.

- Fonts and typography: untouched.
- Spacing and layout rhythm: the 32 px task rows and 12 px elbow reach are unchanged.
- Colors and visual tokens: the dedicated theme-aware Work Map tree token remains legible in dark mode.
- Image quality and asset fidelity: no raster or icon asset changed; the connector is rendered at native browser resolution.
- Copy and content: task names and empty-state placeholders are unchanged.
- Accessibility and behavior: semantic Work Map rows and interactions are unchanged; only decorative pseudo-element geometry changed.

## Comparison history

- Earlier pass: replaced individually joined vertical fragments with one lane-owned continuous spine and increased dark-mode contrast.
- Final pass: moved the populated-lane endpoint from the final row midpoint to one CSS pixel above it, allowing the final curved branch to finish the tree without a downward tail.

## Browser and validation record

- Live geometry: lane 96 px high; shared spine `top: 0`, `bottom: 17px`, height 79 px; branch height 16 px with a 6 px bottom-left radius.
- Rendered readback: Work Map visible, final task visible, dark theme active, viewport 890 × 821, DPR 2.
- Local surfaces: editor returned HTTP 200 at port 1420; Work Map authority responded at port 7602.
- Focused connector contract: 1 test passed, 0 failed, 12 assertions.
- Console review: existing Vue warnings about `AgentTerminalOverlays` and toolbar attribute inheritance remain; no connector-specific runtime error appeared.

## Implementation checklist

- [x] Keep one continuous vertical spine through populated task lanes.
- [x] Preserve a rounded branch to every task and empty-state placeholder.
- [x] Stop the populated spine at the final curve with no terminal stem.
- [x] Preserve dark-mode contrast and the existing Work Map hierarchy.
- [x] Verify source contract, computed geometry, live pixels, and local surface availability.

## Follow-up polish

- None required for this correction.

final result: passed

# Work Map bot header animation — design QA

## Evidence

- Selected source master: `/Users/omar/Documents/Open Pencil/src/assets/work-map-bots/comparison-original-neutral/source/original-selected-master.png`
- Production animation: `/Users/omar/Documents/Open Pencil/src/assets/work-map-bots/comparison-original-neutral/original.webp`
- Reduced-motion still: `/Users/omar/Documents/Open Pencil/src/assets/work-map-bots/comparison-original-neutral/frames/original-01.png`
- Focused source/render comparison: `/Users/omar/Documents/Open Pencil/.git/bot-preview/design-qa-comparison.png`
- Full OpenPencil preview: `http://127.0.0.1:1421/`
- Full editor viewport: 1280 × 720 px.
- Rendered slot: 22 × 18 CSS px; source raster 180 × 144 px.
- State: light Work Map with the global Bots row visible.

## Full-view comparison evidence

The selected original robot is rendered in the production Work Map header rather than approximated with a vector icon. The full editor preview shows the bot at the left of `Bots`, aligned to the existing 32 px row without changing the text baseline, row height, sidebar width, or surrounding spacing.

The component resolves to the exact production WebP. Browser readback reported a complete 180 × 144 image rendered at 22 × 18 CSS px with no cropping or stretching. The transparent edges remain clean against the light sidebar.

## Motion comparison evidence

The animation was sampled in the mounted editor ten times at 220 ms intervals. Six distinct full-screen hashes were observed. A focused Work Map crop sampled over the same running page produced four distinct visual states, confirming that the production asset is advancing rather than displaying a static first frame.

The focused combined comparison places the original open-eye and blink frames next to the rendered 22 × 18 states. The body silhouette, navy visor, cyan eye, and hover-disc proportions remain faithful after downscaling. The blink reads as a small character action without causing layout motion.

## Findings

No actionable P0, P1, or P2 visual difference remains for the selected bot animation.

- Asset fidelity: the approved original robot is used directly.
- Spacing and alignment: the icon stays within the existing header rhythm at 22 × 18 px.
- Transparency: the WebP and PNG fallback retain alpha; no checkerboard or baked background is present.
- Motion: the loop changes frames in the live editor without shifting the row.
- Accessibility: the decorative image has an empty alt value and `aria-hidden`; reduced-motion users receive the still PNG.
- Scope: both the global Bots header and project Bots header use the shared component.

## Browser and validation record

- Full OpenPencil shell mounted successfully in an isolated preview copy of the current worktree.
- Live readback: one visible global bot icon, 22 × 18 px, complete, natural size 180 × 144, exact `original.webp` source.
- Motion readback: six unique full-screen states across ten samples; four unique focused Work Map states.
- Focused Work Map contract: 7 tests passed, 0 failed, 246 assertions.
- The isolated preview intentionally disables the local Work Map authority. Its authentication warnings are preview-only and do not affect the rendered header or animation.
- Earlier dependency errors in the same browser log came from the discarded shared-install attempt; the clean preview mounted after dependency optimization.

## Implementation checklist

- [x] Preserve the selected original robot artwork.
- [x] Use a transparent animated raster rather than a recreated icon.
- [x] Add a still fallback for reduced-motion preferences.
- [x] Replace both global and project Bots header icons.
- [x] Verify exact source, rendered dimensions, full editor placement, and live frame changes.

## Follow-up polish

- None required for the original bot animation. The remaining five approved bot families can reuse this component contract when their matching animation sheets are ready.

final result: passed

# Work Map bot interaction restraint — design QA

## Evidence

- Source visual truth: Browser Comment 1 marker screenshot attached to the current request, targeting the global Bots image with `nothing here please`. The annotation channel did not provide a filesystem path for that attachment.
- Reproducible pre-change capture: `/Users/omar/Documents/Open Pencil/.git/bot-preview/open.png`
- Full OpenPencil implementation: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-bot-global-empty.png`
- Same-viewport before/after comparison: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-bot-before-after-comparison.png`
- Project idle state: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-bot-project-idle.png`
- Project hover state: `/Users/omar/Documents/Open Pencil/.artifacts/design-qa/work-map-bot-project-hover-comparison.png`
- Comparison viewport: 1280 × 720 px at device pixel ratio 1.
- Full editor viewport: 891 × 822 px.
- Rendered character slot: 22 × 18 CSS px.
- State: global Bots at rest with no visible character; project Bots character at rest and during hover wake-up.

## Full-view comparison evidence

The live OpenPencil capture matches the annotation: the global Bots row contains no `picture` or `img`. An empty 22 × 18 alignment slot preserves the existing text baseline and keeps `Bots` aligned with the neighboring Work Map rows without leaving a visible mark.

The same-viewport comparison shows the earlier global character, the revised empty global row, and the retained project character together. The change is isolated to the requested image position; row height, label position, type scale, panel density, and surrounding hierarchy do not move.

## Focused interaction evidence

The project character resolves to `original-01.png` at rest. Moving the pointer onto that character switches only that instance to `original.webp`. After 1.3 seconds it automatically returns to `original-01.png`, even while the page remains open. The adjacent comparison character remains static throughout, proving the WebP is not running globally in the background.

The focused comparison is sufficient for this change because the affected asset is 22 × 18 px and would be too small to judge reliably from the full editor alone.

## Findings

No actionable P0, P1, or P2 difference remains for the requested restraint.

- Fonts and typography: unchanged; Bots labels retain the existing 11.5–12 px hierarchy and weight.
- Spacing and layout rhythm: the removed global image keeps its alignment footprint, avoiding a label jump.
- Colors and visual tokens: unchanged; no new surface or state color was introduced.
- Image quality and asset fidelity: the approved raster remains untouched and appears only in project context.
- Copy and content: `Bots`, `No global bots`, and project labels are unchanged.
- Interaction: the character is a still PNG at rest, wakes on pointer enter or click, and settles after 1.3 seconds.
- Accessibility: the character remains decorative and reduced-motion users continue to receive the still PNG.

## Comparison history

- Earlier implementation: the approved WebP appeared in the global Bots header and looped continuously wherever the shared component was mounted.
- User correction: remove the character from the annotated global slot and keep characters static until interaction.
- Final implementation: global header uses a non-visible alignment spacer; project header uses the still frame by default and temporarily mounts the animated WebP only after pointer or click interaction.
- Post-fix evidence: full-editor selector readback found zero global pictures and zero global images; focused readback observed PNG → WebP → PNG for the interacted project character.

## Browser and validation record

- Full editor global readback: zero `picture` elements and zero `img` elements in `work-map-global-bots`.
- Project idle readback: `original-01.png` at 22 × 18 px.
- Project interaction readback: only the hovered instance changed to `original.webp`; both instances returned to `original-01.png` after the wake-up window.
- Focused interaction fixture console: zero errors.
- Full isolated editor continues to report its expected local-authority preview warnings; no bot component error appeared.
- Focused Work Map contract: 7 tests passed, 0 failed, 250 assertions.

## Implementation checklist

- [x] Remove the visible character from the global Bots row.
- [x] Preserve global label alignment without a placeholder graphic.
- [x] Default project characters to the approved still PNG.
- [x] Trigger a short wake-up animation on pointer enter or click.
- [x] Settle back to the still frame automatically.
- [x] Verify the global row, idle state, interaction state, console, and focused contract.

## Follow-up polish

- Future bot statuses can trigger the same short wake-up method, but should not reintroduce a permanent ambient loop.

final result: passed

## Latest report

The **Work Map bot interaction restraint** report above is the current authority. It covers the empty global Bots slot and the project character’s still → wake-up → still behavior.

final result: passed

# Work Map approved Bot family sizing — design QA

## Evidence

- User reference: `/var/folders/3p/1nb1q9rs4876lqrmh50kh6700000gn/T/TemporaryItems/NSIRD_screencaptureui_TZkZBd/Screenshot 2026-08-26 at 10.47.07 PM.png`.
- Exact-size approved-family preview: `/Users/omar/Developer/Open Pencil Local 2026-08-26/src/assets/work-map-bots/approved-family/approved-family-actual-size-dark.png`.
- Implementation uses the original plus the five explicitly approved siblings; the rejected deep-blue character and earlier placeholder variants are not referenced.

## Findings

- The six transparent rest assets are optically normalized inside the same 180 × 144 frame with safe edge padding, so tall, wide, and round characters read with comparable visual weight without clipping.
- Bot artwork is raised slightly with a 1.08 visual scale while retaining the fixed aligned row slot and the breathing room before its name.
- Parent Bot names use 14px type. Nested section headers use 12px; child work/chat labels use 11–11.5px; scheduled metadata uses 9px.
- Child icons remain at their existing 17–18px sizes. Only avatar artwork and typography changed.
- Asset integrity passed for all five exact source hashes, 40 true-alpha PNG frames, and five animated WebPs with eight frames apiece.
- Focused Work Map projection, UI-contract, and persistence checks passed: 31 tests, 0 failures. The separate Inbox-interaction check currently has one unrelated shared-worktree assertion mismatch in scheduled-row hover styling.

## Fidelity result

No P0, P1, or P2 issue remains in the normalized assets or sizing contract. A fresh live localhost capture could not be attached in this run because the browser-control URL policy rejected the local page; the current user-visible app remains the final pixel-feedback surface.

final result: passed
